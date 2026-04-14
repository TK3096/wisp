use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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

            // System tray: Spawn / Despawn All / Quit
            let spawn_item = MenuItem::with_id(app, "spawn", "Spawn", true, None::<&str>)?;
            let despawn_item =
                MenuItem::with_id(app, "despawn_all", "Despawn All", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&spawn_item, &despawn_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
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
                    _ => {}
                })
                .build(app)?;

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

            // TEMPORARY (Phase 1 scaffold): Cmd+Shift+J / Ctrl+Shift+J → jump all characters.
            // Removed in Phase 2 when ambient scheduling takes over.
            let jump_shortcut = Shortcut::new(Some(modifier), Code::KeyJ);
            app.global_shortcut()
                .on_shortcut(jump_shortcut, move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = app.emit("jump-all", ());
                    }
                })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
