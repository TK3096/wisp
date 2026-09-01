mod persistence;
mod sidecar;

use persistence::{delete_record, persist_record};
use uuid::Uuid;

use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{TrayIcon, TrayIconBuilder},
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use sidecar::SidecarProcess;

#[allow(dead_code)]
#[derive(Clone, serde::Deserialize)]
struct CharacterItem {
    id: u32,
    label: String,
}

struct AppTray(TrayIcon);
struct CharacterList(Mutex<Vec<CharacterItem>>);
#[derive(Default)]
struct PersistenceLock(Mutex<()>);

fn build_tray_menu<R: tauri::Runtime>(
    manager: &impl tauri::Manager<R>,
    items: &[CharacterItem],
    gestures_on: bool,
) -> tauri::Result<Menu<R>> {
    let spawn_item = MenuItem::with_id(manager, "spawn", "Spawn", true, None::<&str>)?;
    let despawn_submenu = build_despawn_submenu(manager, items)?;
    let sep = PredefinedMenuItem::separator(manager)?;
    let gestures_item = CheckMenuItem::with_id(
        manager,
        "gestures",
        "Gestures",
        true,
        gestures_on,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(manager, "quit", "Quit", true, None::<&str>)?;
    #[cfg(debug_assertions)]
    let (debug_sep, toggle_cognition_debug, next_debug_character) = (
        PredefinedMenuItem::separator(manager)?,
        MenuItem::with_id(
            manager,
            "toggle-cognition-debug",
            "Toggle Cognition Debug",
            true,
            None::<&str>,
        )?,
        MenuItem::with_id(
            manager,
            "select-next-cognition-debug",
            "Next Debug Character",
            true,
            None::<&str>,
        )?,
    );

    let delight_submenu = build_feedback_submenu(manager, items, "delight", "Delight")?;
    let dismiss_submenu = build_feedback_submenu(manager, items, "dismiss", "Dismiss")?;
    let mut menu_items: Vec<&dyn IsMenuItem<R>> = vec![
        &spawn_item,
        &despawn_submenu,
        &delight_submenu,
        &dismiss_submenu,
        &sep,
    ];

    #[cfg(debug_assertions)]
    {
        menu_items.push(&toggle_cognition_debug);
        menu_items.push(&next_debug_character);
        menu_items.push(&debug_sep);
    }

    menu_items.push(&gestures_item);
    menu_items.push(&quit_item);
    Menu::with_items(manager, &menu_items)
}

fn build_despawn_submenu<R: tauri::Runtime>(
    manager: &impl tauri::Manager<R>,
    items: &[CharacterItem],
) -> tauri::Result<Submenu<R>> {
    let submenu = Submenu::with_id(manager, "despawn", "Despawn", true)?;
    if items.is_empty() {
        let none_item = MenuItem::with_id(manager, "despawn_none", "(none)", false, None::<&str>)?;
        submenu.append(&none_item)?;
    } else {
        let all_item = MenuItem::with_id(manager, "despawn_all", "All", true, None::<&str>)?;
        submenu.append(&all_item)?;
        let sep = PredefinedMenuItem::separator(manager)?;
        submenu.append(&sep)?;
        for item in items {
            let char_item = MenuItem::with_id(
                manager,
                format!("despawn:{}", item.id),
                &item.label,
                true,
                None::<&str>,
            )?;
            submenu.append(&char_item)?;
        }
    }
    Ok(submenu)
}

fn build_feedback_submenu<R: tauri::Runtime>(
    manager: &impl tauri::Manager<R>,
    items: &[CharacterItem],
    action: &str,
    label: &str,
) -> tauri::Result<Submenu<R>> {
    let submenu = Submenu::with_id(manager, action, label, true)?;
    if items.is_empty() {
        let none_item = MenuItem::with_id(
            manager,
            format!("{action}_none"),
            "(none)",
            false,
            None::<&str>,
        )?;
        submenu.append(&none_item)?;
    } else {
        for item in items {
            let char_item = MenuItem::with_id(
                manager,
                format!("{action}:{}", item.id),
                &item.label,
                true,
                None::<&str>,
            )?;
            submenu.append(&char_item)?;
        }
    }
    Ok(submenu)
}

fn rebuild_tray(app: &tauri::AppHandle, gestures_on: bool) {
    let tray = app.state::<AppTray>();
    let chars = app.state::<CharacterList>();
    let items = chars.0.lock().unwrap().clone();
    if let Ok(menu) = build_tray_menu(app, &items, gestures_on) {
        let _ = tray.0.set_menu(Some(menu));
    }
}

#[tauri::command]
fn update_character_list(
    items: Vec<CharacterItem>,
    app: tauri::AppHandle,
    tray: tauri::State<AppTray>,
    sidecar: tauri::State<SidecarProcess>,
    char_list: tauri::State<CharacterList>,
) -> Result<(), String> {
    *char_list.0.lock().unwrap() = items.clone();
    let menu = build_tray_menu(&app, &items, sidecar.is_running()).map_err(|e| e.to_string())?;
    tray.0.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn create_character_identity() -> Result<String, String> {
    Ok(Uuid::now_v7().to_string())
}

#[tauri::command]
fn persist_character_record(
    app: tauri::AppHandle,
    lock: tauri::State<PersistenceLock>,
    record: serde_json::Value,
) -> Result<(), String> {
    let _serialization_guard = lock.0.lock().unwrap();
    let root = persistence_root(&app)?;
    persist_record(&root, &record)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_character_record(
    app: tauri::AppHandle,
    lock: tauri::State<PersistenceLock>,
    character_id: String,
) -> Result<(), String> {
    let _serialization_guard = lock.0.lock().unwrap();
    let root = persistence_root(&app)?;
    delete_record(&root, &character_id).map_err(|error| error.to_string())
}

fn persistence_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(base.join("characters").join("v1"))
}

#[tauri::command]
fn exit_after_flush(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .setup(|app| {
            app.manage(SidecarProcess::new());
            app.manage(CharacterList(Mutex::new(vec![])));
            app.manage(PersistenceLock::default());

            let window = app.get_webview_window("main").unwrap();

            if let Some(monitor) = window.primary_monitor()? {
                let size = monitor.size();
                let pos = monitor.position();
                window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                    width: size.width,
                    height: size.height,
                }))?;
                window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: pos.x,
                    y: pos.y,
                }))?;
            }

            window.set_ignore_cursor_events(true)?;

            let menu = build_tray_menu(app, &[], false)?;

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "spawn" => {
                        let _ = app.emit("spawn", ());
                    }
                    "despawn_all" => {
                        let _ = app.emit("despawn-all", ());
                    }
                    "quit" => {
                        let _ = app.emit("graceful-shutdown", ());
                        let shutdown_app = app.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_secs(2));
                            shutdown_app.state::<SidecarProcess>().stop();
                            shutdown_app.exit(0);
                        });
                    }
                    "gestures" => {
                        let sidecar = app.state::<SidecarProcess>();
                        if sidecar.is_running() {
                            sidecar.stop();
                            rebuild_tray(app, false);
                        } else {
                            let app2 = app.clone();
                            let result = sidecar.start(app.clone(), move || {
                                rebuild_tray(&app2, false);
                            });
                            if let Err(e) = result {
                                eprintln!("[sidecar] failed to start: {e}");
                                rebuild_tray(app, false);
                            } else {
                                rebuild_tray(app, true);
                            }
                        }
                    }
                    #[cfg(debug_assertions)]
                    "toggle-cognition-debug" => {
                        let _ = app.emit("toggle-cognition-debug", ());
                    }
                    #[cfg(debug_assertions)]
                    "select-next-cognition-debug" => {
                        let _ = app.emit("select-next-cognition-debug", ());
                    }
                    id if id.starts_with("despawn:") => {
                        if let Ok(n) = id["despawn:".len()..].parse::<u32>() {
                            let _ = app.emit("despawn-one", n);
                        }
                    }
                    id if id.starts_with("delight:") => {
                        if let Ok(n) = id["delight:".len()..].parse::<u32>() {
                            let _ = app.emit("delight-one", n);
                        }
                    }
                    id if id.starts_with("dismiss:") => {
                        if let Ok(n) = id["dismiss:".len()..].parse::<u32>() {
                            let _ = app.emit("dismiss-one", n);
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            app.manage(AppTray(tray));

            #[cfg(target_os = "macos")]
            let modifier = Modifiers::SUPER | Modifiers::SHIFT;
            #[cfg(not(target_os = "macos"))]
            let modifier = Modifiers::CONTROL | Modifiers::SHIFT;
            let shortcut = Shortcut::new(Some(modifier), Code::KeyW);
            app.global_shortcut()
                .on_shortcut(shortcut, move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = app.emit("spawn", ());
                    }
                })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            update_character_list,
            create_character_identity,
            persist_character_record,
            delete_character_record,
            exit_after_flush
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                app.state::<SidecarProcess>().stop();
            }
        });
}
