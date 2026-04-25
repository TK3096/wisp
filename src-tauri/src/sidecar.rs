use std::env;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime};

pub struct SidecarProcess {
    child: Arc<Mutex<Option<std::process::Child>>>,
    expected_exit: Arc<AtomicBool>,
}

impl SidecarProcess {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            expected_exit: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_running(&self) -> bool {
        self.child.lock().unwrap().is_some()
    }

    pub fn start<R: Runtime + 'static>(&self, app: AppHandle<R>) -> Result<(), String> {
        if self.is_running() {
            return Ok(());
        }

        let dir = sidecar_dir();
        let python = dir.join(".venv/bin/python");
        let script = dir.join("main.py");

        if !python.exists() {
            return Err(format!(
                "Python venv not found at {:?}. Run: python3.12 -m venv src-sidecar/.venv && src-sidecar/.venv/bin/pip install -r src-sidecar/requirements.txt",
                python
            ));
        }
        if !script.exists() {
            return Err(format!("main.py not found at {:?}", script));
        }

        let mut child = std::process::Command::new(&python)
            .arg(&script)
            .env("PYTHONUNBUFFERED", "1")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .map_err(|e| e.to_string())?;

        let stdout = child.stdout.take().expect("piped stdout");
        *self.child.lock().unwrap() = Some(child);
        self.expected_exit.store(false, Ordering::SeqCst);

        let child_arc = Arc::clone(&self.child);
        let expected_exit = Arc::clone(&self.expected_exit);

        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                    match val.get("event").and_then(|v| v.as_str()).unwrap_or("") {
                        "spawn" => { let _ = app.emit("spawn", ()); }
                        "error" => {
                            let kind = val.get("kind").and_then(|v| v.as_str()).unwrap_or("unknown");
                            let msg = val.get("message").and_then(|v| v.as_str()).unwrap_or("");
                            eprintln!("[sidecar] error kind={kind} message={msg}");
                            let _ = app.emit("sidecar-error", kind.to_string());
                        }
                        "ready" => eprintln!("[sidecar] ready"),
                        _ => {}
                    }
                }
            }
            // stdout closed — process exited
            *child_arc.lock().unwrap() = None;
            if expected_exit.load(Ordering::SeqCst) {
                eprintln!("[sidecar] stopped");
            } else {
                eprintln!("[sidecar] crashed — re-toggle to retry");
                let _ = app.emit("sidecar-crashed", ());
            }
        });

        Ok(())
    }

    pub fn stop(&self) {
        self.expected_exit.store(true, Ordering::SeqCst);
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

fn sidecar_dir() -> PathBuf {
    if let Ok(dir) = env::var("WISP_SIDECAR_DIR") {
        return PathBuf::from(dir);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src-sidecar")
}
