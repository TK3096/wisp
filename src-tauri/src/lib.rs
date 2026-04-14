use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{TrayIcon, TrayIconBuilder},
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

// Fields are deserialized from JS; `id` and `label` are used directly in Phase 2.
#[allow(dead_code)]
#[derive(serde::Deserialize)]
struct CharacterItem {
    id: u32,
    label: String,
}

/// Holds the tray icon so `update_character_list` can swap the menu.
struct AppTray(TrayIcon);

fn build_tray_menu<R: tauri::Runtime>(
    manager: &impl tauri::Manager<R>,
    items: &[CharacterItem],
) -> tauri::Result<Menu<R>> {
    let spawn_item = MenuItem::with_id(manager, "spawn", "Spawn", true, None::<&str>)?;
    let despawn_submenu = build_despawn_submenu(manager, items)?;
    let quit_item = MenuItem::with_id(manager, "quit", "Quit", true, None::<&str>)?;
    Menu::with_items(manager, &[&spawn_item, &despawn_submenu, &quit_item])
}

fn build_despawn_submenu<R: tauri::Runtime>(
    manager: &impl tauri::Manager<R>,
    items: &[CharacterItem],
) -> tauri::Result<Submenu<R>> {
    let submenu = Submenu::with_id(manager, "despawn", "Despawn", true)?;
    if items.is_empty() {
        let none_item =
            MenuItem::with_id(manager, "despawn_none", "(none)", false, None::<&str>)?;
        submenu.append(&none_item)?;
    } else {
        let all_item =
            MenuItem::with_id(manager, "despawn_all", "All", true, None::<&str>)?;
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

#[tauri::command]
fn update_character_list(
    items: Vec<CharacterItem>,
    app: tauri::AppHandle,
    tray: tauri::State<AppTray>,
) -> Result<(), String> {
    let menu = build_tray_menu(&app, &items).map_err(|e| e.to_string())?;
    tray.0.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            // Size the window to cover the primary monitor's work area
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

            // Allow all mouse events to pass through the overlay
            window.set_ignore_cursor_events(true)?;

            // Build initial menu: no characters alive → Despawn ▸ shows (none)
            let menu = build_tray_menu(app, &[])?;

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
                        app.exit(0);
                    }
                    // Phase 2: per-character despawn items use "despawn:{id}" IDs
                    id if id.starts_with("despawn:") => {
                        if let Ok(n) = id["despawn:".len()..].parse::<u32>() {
                            let _ = app.emit("despawn-one", n);
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            app.manage(AppTray(tray));

            // Global hotkey: Cmd+Shift+W (macOS) / Ctrl+Shift+W (other) → spawn
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
        .invoke_handler(tauri::generate_handler![update_character_list])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
