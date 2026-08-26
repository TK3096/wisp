use serde::Serialize;
use std::env;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Clone, Debug, PartialEq, Serialize)]
struct GestureEvent {
    gesture: &'static str,
    confidence: f64,
}

fn parse_gesture_event(value: &serde_json::Value) -> Result<GestureEvent, String> {
    let invalid = "gesture event must contain openPalm and confidence in [0, 1]";

    if value.get("gesture").and_then(|gesture| gesture.as_str()) != Some("openPalm") {
        return Err(invalid.to_string());
    }

    let confidence = value
        .get("confidence")
        .and_then(|confidence| confidence.as_f64())
        .ok_or_else(|| invalid.to_string())?;
    if !confidence.is_finite() || !(0.0..=1.0).contains(&confidence) {
        return Err(invalid.to_string());
    }

    Ok(GestureEvent {
        gesture: "openPalm",
        confidence,
    })
}

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

    /// Start the sidecar. `on_crash` is called (on a background thread) if the
    /// process exits unexpectedly so callers can revert UI state.
    pub fn start<R, F>(&self, app: AppHandle<R>, on_crash: F) -> Result<(), String>
    where
        R: Runtime + 'static,
        F: Fn() + Send + 'static,
    {
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
            let mut error_received = false;
            for line in reader.lines().flatten() {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                    match val.get("event").and_then(|v| v.as_str()).unwrap_or("") {
                        "gesture" => match parse_gesture_event(&val) {
                            Ok(gesture) => {
                                let _ = app.emit("gesture", gesture);
                                // Gesture observation and spawn policy remain separate
                                // frontend events; cognition never receives a spawn command.
                                let _ = app.emit("spawn", ());
                            }
                            Err(error) => {
                                eprintln!("[sidecar] dropped malformed gesture: {error}");
                            }
                        },
                        "error" => {
                            let kind = val
                                .get("kind")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown");
                            let msg = val.get("message").and_then(|v| v.as_str()).unwrap_or("");
                            eprintln!("[sidecar] error kind={kind} message={msg}");
                            // Revert the UI immediately; process will exit after this.
                            if !error_received {
                                error_received = true;
                                on_crash();
                            }
                        }
                        "ready" => eprintln!("[sidecar] ready"),
                        _ => {}
                    }
                }
            }
            // stdout EOF — process has exited
            *child_arc.lock().unwrap() = None;
            if expected_exit.load(Ordering::SeqCst) {
                eprintln!("[sidecar] stopped");
            } else if error_received {
                eprintln!("[sidecar] exited after error");
            } else {
                eprintln!("[sidecar] crashed unexpectedly — re-toggle to retry");
                on_crash();
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::parse_gesture_event;

    #[test]
    fn parses_a_bounded_open_palm_gesture() {
        let event = parse_gesture_event(&json!({
            "event": "gesture",
            "gesture": "openPalm",
            "confidence": 0.87
        }))
        .expect("valid gesture");

        assert_eq!(event.gesture, "openPalm");
        assert_eq!(event.confidence, 0.87);
    }

    #[test]
    fn rejects_malformed_or_unbounded_gestures() {
        for payload in [
            json!({"event": "gesture", "gesture": "closedFist", "confidence": 0.8}),
            json!({"event": "gesture", "gesture": "openPalm", "confidence": -0.1}),
            json!({"event": "gesture", "gesture": "openPalm", "confidence": 1.1}),
            json!({"event": "gesture", "gesture": "openPalm"}),
        ] {
            assert!(parse_gesture_event(&payload).is_err());
        }
    }
}
