// moshpit desktop: the web app in a native window, with a native FFmpeg instead of ffmpeg.wasm.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(engine::Engine::new()?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine::engine_info,
            engine::engine_write,
            engine::engine_read,
            engine::engine_remove,
            engine::engine_run,
            engine::engine_kill,
            engine::save_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building moshpit")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<engine::Engine>().cleanup();
            }
        });
}
