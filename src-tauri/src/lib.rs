use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
                window.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition { x: pos.x, y: pos.y },
                ))?;
            }

            // Allow all mouse events to pass through the overlay
            window.set_ignore_cursor_events(true)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
