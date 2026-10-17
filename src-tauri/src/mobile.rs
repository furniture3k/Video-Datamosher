// What the Android app needs from the native side: a place to save exports. The webview can't
// download files, so the page hands the bytes over and they're written to Downloads.

use std::path::PathBuf;
use tauri::ipc::Request;
use tauri::{AppHandle, Manager};

/// A file name that's safe to use, and free in `dir` ("mosh.mp4", "mosh (2).mp4"…).
pub fn free_name(dir: &std::path::Path, name: &str) -> PathBuf {
    let clean: String = name.chars().map(|c| if c.is_alphanumeric() || "._- ()".contains(c) { c } else { '_' }).collect();
    let clean = if clean.trim().is_empty() || clean.starts_with('.') { format!("mosh{clean}") } else { clean };
    let (stem, ext) = match clean.rfind('.') {
        Some(i) if i > 0 => (clean[..i].to_string(), clean[i..].to_string()),
        _ => (clean.clone(), String::new()),
    };
    let mut p = dir.join(&clean);
    let mut n = 2;
    while p.exists() {
        p = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    p
}

/// Save the request's body (raw bytes) to Downloads under the name in the `name` header.
/// Returns where it went. Async, so writing a large export doesn't freeze the window.
#[tauri::command]
pub async fn save_download(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else { return Err("expected the file's bytes".into()) };
    let name = request.headers().get("name").and_then(|v| v.to_str().ok()).unwrap_or("mosh");
    let name = percent_encoding::percent_decode_str(name).decode_utf8_lossy().to_string();
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = free_name(&dir, &name);
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_safe_and_free() {
        let dir = std::env::temp_dir().join(format!("moshpit-dl-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(free_name(&dir, "my mosh.mp4").file_name().unwrap(), "my mosh.mp4");
        std::fs::write(dir.join("my mosh.mp4"), b"x").unwrap();
        assert_eq!(free_name(&dir, "my mosh.mp4").file_name().unwrap(), "my mosh (2).mp4");
        // no way out of Downloads, and no hidden files
        assert_eq!(free_name(&dir, "../../etc/passwd").file_name().unwrap(), "mosh.._.._etc_passwd");
        assert_eq!(free_name(&dir, "../../etc/passwd").parent().unwrap(), dir.as_path());
        assert_eq!(free_name(&dir, "").file_name().unwrap(), "mosh");
        std::fs::remove_dir_all(&dir).ok();
    }
}
