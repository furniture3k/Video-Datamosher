// moshpit as a library: the desktop app (main.rs) and the Android app both start here.
#[cfg(desktop)]
mod engine;
mod mobile;
#[cfg(desktop)]
mod opened;
mod osc;
#[cfg(target_os = "linux")]
mod proxy;
#[cfg(desktop)]
mod smoke;

#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(desktop)]
use tauri::webview::{NewWindowResponse, PageLoadEvent, PermissionKind, PermissionResponse};
#[cfg(desktop)]
use tauri::{Emitter, Manager, Url, WebviewWindowBuilder};
#[cfg(desktop)]
use tauri_plugin_opener::OpenerExt;

/// The app's own pages; anything else (links to GitHub, docs) opens in the system browser.
#[cfg(desktop)]
fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "blob" | "data" | "about" => true,
        "http" | "https" => matches!(url.host_str(), Some("tauri.localhost")) || (cfg!(dev) && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))),
        _ => false,
    }
}

/// The main window is closing: waiting for the page to save (see `close_ready`).
#[cfg(desktop)]
static CLOSING: AtomicBool = AtomicBool::new(false);

/// How long a closing window waits for the page to save before it closes anyway (a page that has
/// hung or crashed can't hold the window open).
#[cfg(desktop)]
const SAVE_ON_CLOSE: std::time::Duration = std::time::Duration::from_millis(2500);

/// The page has saved the open project: the window can close now.
#[cfg(desktop)]
#[tauri::command]
fn close_ready(window: tauri::Window) {
    let _ = window.destroy();
}

/// The desktop app: the editor in a native window, with the native FFmpeg.
#[cfg(desktop)]
pub fn run() {
    // NVIDIA's proprietary driver can't allocate WebKitGTK's DMA-BUF buffers, so the page
    // crashes or stays blank: render without them there (set before any thread starts)
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() && std::path::Path::new("/proc/driver/nvidia").exists() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    tauri::Builder::default()
        // closing the window: the page saves the edit its autosave hasn't written yet (the webview
        // gives it no reliable unload event), then says so with close_ready
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if CLOSING.swap(true, Ordering::SeqCst) {
                    return;
                }
                let _ = window.emit("save-before-close", ());
                let w = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(SAVE_ON_CLOSE);
                    let _ = w.destroy();
                });
            }
        })
        // opening a file with moshpit while it runs hands the file to the open window
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| opened::deliver(app, opened::from_args(args.into_iter().skip(1)))))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(engine::Engine::new()?);
            let opened = opened::Opened::default();
            opened.add(opened::from_args(std::env::args().skip(1)));
            app.manage(opened);
            let config = app.config().app.windows.first().cloned().ok_or("no window config")?;
            let opener = app.handle().clone();
            let opener2 = app.handle().clone();
            let window = WebviewWindowBuilder::from_config(app, &config)?
                .on_navigation(move |url| {
                    if is_app_url(url) {
                        return true;
                    }
                    let _ = opener.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                .on_new_window(move |url, _| {
                    let _ = opener2.opener().open_url(url.as_str(), None::<&str>);
                    NewWindowResponse::Deny
                })
                // Record and Live mode use the camera, microphone and screen
                .on_permission_request(|_, kind| match kind {
                    PermissionKind::Camera | PermissionKind::Microphone | PermissionKind::DisplayCapture => PermissionResponse::Allow,
                    _ => PermissionResponse::Default,
                })
                .on_page_load(|window, payload| {
                    if smoke::enabled() && payload.event() == PageLoadEvent::Finished {
                        let _ = window.eval(smoke::script());
                    }
                })
                .build()?;
            if smoke::enabled() {
                smoke::start();
            }
            #[cfg(target_os = "linux")]
            window.with_webview(|w| {
                use webkit2gtk::{SettingsExt, WebViewExt};
                if let Some(s) = w.inner().settings() {
                    s.set_enable_media_stream(true);
                    s.set_enable_mediasource(true);
                }
                proxy::apply(&w.inner());
                if smoke::enabled() {
                    w.inner().connect_web_process_terminated(|_, reason| smoke::page_died(&format!("{reason:?}")));
                }
            })?;
            // on a screen smaller than the window (1440×900 on a 1366×768 laptop) it would be cut
            // off past the screen's edges: fill the screen instead
            if let Ok(Some(monitor)) = window.current_monitor() {
                let area = monitor.work_area().size;
                // a screen smaller than the smallest window (a 1366×768 laptop at 150% is 910×512 in
                // the app's pixels): let the window be as small as the screen, so it all shows
                let scale = monitor.scale_factor();
                let (aw, ah) = (area.width as f64 / scale, area.height as f64 / scale);
                if let (Some(mw), Some(mh)) = (config.min_width, config.min_height) {
                    if mw > aw || mh > ah {
                        let _ = window.set_min_size(Some(tauri::LogicalSize::new(mw.min(aw), mh.min(ah))));
                    }
                }
                if let Ok(size) = window.outer_size() {
                    if size.width > area.width || size.height > area.height {
                        let _ = window.maximize();
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine::engine_info,
            engine::engine_write,
            engine::engine_read,
            engine::engine_remove,
            engine::engine_run,
            engine::engine_kill,
            engine::engine_size,
            engine::engine_move,
            engine::avi_scan,
            engine::engine_read_ranges,
            engine::engine_assemble,
            engine::save_path,
            engine::reveal,
            opened::opened_files,
            opened::read_opened_file,
            close_ready,
            smoke::smoke_report,
            osc::osc_listen,
            mobile::save_download,
        ])
        .build(tauri::generate_context!())
        .expect("error while building moshpit")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => app.state::<engine::Engine>().cleanup(),
            // macOS: "Open With", or a file dropped on the Dock icon
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            tauri::RunEvent::Opened { urls } => opened::deliver(app, urls.iter().filter_map(|u| u.to_file_path().ok()).collect()),
            _ => {}
        });
}

/// The Android app (experimental): the editor in the system webview with the browser's video
/// engine (ffmpeg.wasm), so none of the desktop's native FFmpeg, file opening or single-window
/// handling. Exports are saved to Downloads.
#[cfg(mobile)]
#[tauri::mobile_entry_point]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![osc::osc_listen, mobile::save_download])
        .run(tauri::generate_context!())
        .expect("error while running moshpit");
}
