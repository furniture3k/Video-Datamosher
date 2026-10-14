// Native FFmpeg engine. The frontend (src/lib/ffmpeg-native.ts) writes job inputs into a work
// folder, runs FFmpeg there with streamed log lines, and reads the outputs back.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

pub struct Engine {
    root: PathBuf,
    ffmpeg: PathBuf,
    jobs: Arc<Mutex<HashMap<String, Child>>>,
}

#[derive(Serialize)]
pub struct Info {
    version: String,
    path: String,
}

impl Engine {
    pub fn new() -> std::io::Result<Self> {
        let root = std::env::temp_dir().join(format!("moshpit-{}", std::process::id()));
        fs::create_dir_all(&root)?;
        Ok(Self { root, ffmpeg: find_ffmpeg(), jobs: Default::default() })
    }

    /// Resolve a path inside the work folder, refusing anything that could escape it.
    fn path(&self, rel: &str) -> Result<PathBuf, String> {
        let p = Path::new(rel);
        if rel.is_empty() || !p.components().all(|c| matches!(c, Component::Normal(_))) {
            return Err(format!("invalid path: {rel}"));
        }
        Ok(self.root.join(p))
    }

    fn command(&self) -> Command {
        #[allow(unused_mut)]
        let mut cmd = Command::new(&self.ffmpeg);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        cmd
    }

    pub fn cleanup(&self) {
        if let Ok(mut jobs) = self.jobs.lock() {
            for (_, child) in jobs.iter_mut() {
                let _ = child.kill();
            }
        }
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// The bundled FFmpeg sits next to the app's executable; `MOSHPIT_FFMPEG` overrides it, and the
/// one on PATH is the fallback (handy for `npm run desktop` during development).
fn find_ffmpeg() -> PathBuf {
    if let Some(p) = std::env::var_os("MOSHPIT_FFMPEG") {
        return p.into();
    }
    let name = if cfg!(windows) { "moshpit-ffmpeg.exe" } else { "moshpit-ffmpeg" };
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
        let p = dir.join(name);
        if p.exists() {
            return p;
        }
    }
    "ffmpeg".into()
}

fn header(req: &Request<'_>, name: &str) -> Result<String, String> {
    let v = req.headers().get(name).ok_or(format!("missing {name}"))?;
    let v = v.to_str().map_err(|e| e.to_string())?;
    Ok(percent_decode_str(v).decode_utf8_lossy().into_owned())
}

#[tauri::command]
pub async fn engine_info(state: State<'_, Engine>) -> Result<Info, String> {
    let out = state
        .command()
        .arg("-version")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("{} not found: {e}", state.ffmpeg.display()))?;
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(Info {
        version: text.lines().next().unwrap_or("ffmpeg").to_string(),
        path: state.ffmpeg.display().to_string(),
    })
}

/// Raw request body = bytes; headers `x-path` (relative, URI-encoded) and `x-offset`.
#[tauri::command]
pub async fn engine_write(state: State<'_, Engine>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let path = state.path(&header(&request, "x-path")?)?;
    let offset: u64 = header(&request, "x-offset")?.parse().map_err(|_| "bad offset")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut f = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(offset == 0)
        .open(&path)
        .map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    f.write_all(data).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn engine_read(state: State<'_, Engine>, path: String) -> Result<Response, String> {
    let path = state.path(&path)?;
    fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn engine_remove(state: State<'_, Engine>, path: String) -> Result<(), String> {
    let path = state.path(&path)?;
    match fs::remove_file(&path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Run FFmpeg in the work folder `dir`. Log lines (split on \r and \n, so progress updates
/// arrive as they happen) are streamed in batches; resolves with the exit code.
#[tauri::command]
pub async fn engine_run(
    state: State<'_, Engine>,
    job: String,
    dir: String,
    args: Vec<String>,
    on_log: Channel<Vec<String>>,
) -> Result<i32, String> {
    let cwd = state.path(&dir)?;
    fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    let mut child = state
        .command()
        .args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", state.ffmpeg.display()))?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    state.jobs.lock().unwrap().insert(job.clone(), child);
    let jobs = state.jobs.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut buf = [0u8; 16384];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            let n = match stderr.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            pending.extend_from_slice(&buf[..n]);
            let mut lines = Vec::new();
            while let Some(i) = pending.iter().position(|&b| b == b'\n' || b == b'\r') {
                let line: Vec<u8> = pending.drain(..=i).collect();
                let line = String::from_utf8_lossy(&line[..line.len() - 1]).trim_end().to_string();
                if !line.is_empty() {
                    lines.push(line);
                }
            }
            if !lines.is_empty() {
                let _ = on_log.send(lines);
            }
        }
        if !pending.is_empty() {
            let _ = on_log.send(vec![String::from_utf8_lossy(&pending).into_owned()]);
        }
        let child = jobs.lock().unwrap().remove(&job);
        match child {
            Some(mut c) => c.wait().map(|s| s.code().unwrap_or(-1)).map_err(|e| e.to_string()),
            None => Ok(-1),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn engine_kill(state: State<'_, Engine>, job: String) -> Result<(), String> {
    if let Some(child) = state.jobs.lock().unwrap().get_mut(&job) {
        let _ = child.kill();
    }
    Ok(())
}

/// Save bytes with the native Save dialog (the webview can't download files itself).
/// Raw body = file contents; header `x-name` = suggested file name. Resolves with the
/// chosen path, or null when the dialog was cancelled.
#[tauri::command]
pub async fn save_file(app: AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let name = header(&request, "x-name")?;
    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Some(ext) = Path::new(&name).extension().and_then(|e| e.to_str()) {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    let Some(path) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}
