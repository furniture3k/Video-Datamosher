// The smoke test the release workflow runs on every installer it builds: MOSHPIT_SMOKE_TEST=1 opens
// the app, checks in the page that the editor, sound, video and FFmpeg work (smoke.js), prints what
// it found and quits: exit code 0 when everything worked, 1 when a check failed, 2 when the page never
// reported (it hung or crashed), 3 when the webview's page process died.
// MOSHPIT_SMOKE_TEST=network also requires a download through the webview's network stack to work.
use std::time::Duration;

const VAR: &str = "MOSHPIT_SMOKE_TEST";
/// How long the page has to report before the test fails.
const TIMEOUT: Duration = Duration::from_secs(150);

pub fn enabled() -> bool {
    std::env::var_os(VAR).is_some()
}

/// The script run in the page once it has loaded.
pub fn script() -> String {
    let network = std::env::var(VAR).is_ok_and(|v| v == "network");
    // a file the online features load (MOSHPIT_SMOKE_URL to try another)
    let url = std::env::var("MOSHPIT_SMOKE_URL").unwrap_or_else(|_| "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/package.json".into());
    let url = serde_json::to_string(&url).unwrap_or_default();
    format!("window.__MOSHPIT_SMOKE_NETWORK = {network}; window.__MOSHPIT_SMOKE_URL = {url};\n{}", include_str!("smoke.js"))
}

/// Fails the test if the page hasn't reported in time.
pub fn start() {
    eprintln!("moshpit smoke test: started");
    std::thread::spawn(|| {
        std::thread::sleep(TIMEOUT);
        eprintln!("moshpit smoke test: FAILED, the page did not report in {}s (hung or crashed)", TIMEOUT.as_secs());
        std::process::exit(2);
    });
}

/// The webview's page process died.
#[cfg(target_os = "linux")]
pub fn page_died(reason: &str) {
    eprintln!("moshpit smoke test: FAILED, the page process died ({reason})");
    std::process::exit(3);
}

/// What the page found.
#[tauri::command]
pub fn smoke_report(app: tauri::AppHandle, ok: bool, report: String) {
    if !enabled() {
        return;
    }
    println!("{report}");
    eprintln!("moshpit smoke test: {}", if ok { "passed" } else { "FAILED" });
    app.exit(if ok { 0 } else { 1 });
}
