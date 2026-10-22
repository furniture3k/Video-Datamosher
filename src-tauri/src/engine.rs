// Native FFmpeg engine. The frontend (src/lib/ffmpeg-native.ts) writes job inputs into a work
// folder, runs FFmpeg there with streamed log lines, and reads the outputs back.

use std::collections::{HashMap, HashSet};
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
    /// Held for the app's lifetime; tells other instances this work folder is in use.
    _lock: fs::File,
    ffmpeg: PathBuf,
    jobs: Arc<Mutex<HashMap<String, Child>>>,
    /// Jobs cancelled before their process was started: killed as soon as it is.
    killed: Mutex<HashSet<String>>,
}

#[derive(Serialize)]
pub struct Info {
    version: String,
    path: String,
}

impl Engine {
    pub fn new() -> std::io::Result<Self> {
        let tmp = std::env::temp_dir();
        remove_stale(&tmp);
        let root = tmp.join(format!("moshpit-{}", std::process::id()));
        fs::create_dir_all(&root)?;
        let lock = fs::File::create(root.join(".lock"))?;
        lock.try_lock().map_err(|e| std::io::Error::other(e.to_string()))?;
        Ok(Self { root, _lock: lock, ffmpeg: find_ffmpeg(), jobs: Default::default(), killed: Default::default() })
    }

    /// Resolve a path inside the work folder, refusing anything that could escape it.
    fn path(&self, rel: &str) -> Result<PathBuf, String> {
        safe_join(&self.root, rel)
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
            for child in jobs.values_mut() {
                let _ = child.kill();
                // a process still holding its files open keeps them from being deleted (Windows)
                let _ = child.wait();
            }
        }
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if rel.is_empty() || !p.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("invalid path: {rel}"));
    }
    Ok(root.join(p))
}

/// Work folders left behind by instances that crashed or were killed: their lock is free.
fn remove_stale(tmp: &Path) {
    let Ok(entries) = fs::read_dir(tmp) else { return };
    for e in entries.flatten() {
        let name = e.file_name();
        let path = e.path();
        // only work folders (moshpit-<process id>), never anything else that happens to start with "moshpit-"
        let name = name.to_string_lossy();
        let ours = name.strip_prefix("moshpit-").is_some_and(|id| !id.is_empty() && id.bytes().all(|c| c.is_ascii_digit()));
        if !ours || !path.is_dir() {
            continue;
        }
        let free = match fs::OpenOptions::new().write(true).open(path.join(".lock")) {
            Ok(f) => f.try_lock().is_ok(),
            // no lock file: an older version's folder, or (if recent) one still starting up
            Err(_) => fs::metadata(&path)
                .and_then(|m| m.modified())
                .is_ok_and(|t| t.elapsed().is_ok_and(|age| age.as_secs() > 3600)),
        };
        if free {
            let _ = fs::remove_dir_all(&path);
        }
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
    write_at(&path, offset, data)
}

fn write_at(path: &Path, offset: u64, data: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut f = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(offset == 0)
        .open(path)
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
    {
        // (the jobs lock is held while looking, as engine_kill does, so a kill can't slip in between)
        let mut jobs = state.jobs.lock().unwrap();
        // cancelled while it was starting: engine_kill found nothing to kill yet
        if state.killed.lock().unwrap().remove(&job) {
            let _ = child.kill();
        }
        jobs.insert(job.clone(), child);
    }
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
    let mut jobs = state.jobs.lock().unwrap();
    match jobs.get_mut(&job) {
        Some(child) => {
            let _ = child.kill();
        }
        // not started yet (or already finished): engine_run kills it if it starts
        None => {
            let mut killed = state.killed.lock().unwrap();
            // job names are never reused (see ffmpeg-native.ts), so this only grows with kills that came too late
            if killed.len() > 64 {
                killed.clear();
            }
            killed.insert(job);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- disk-backed moshing
// Long exports keep frame data on disk: the frontend gets each frame's position and first bytes,
// runs the effect stack on that, and has the moshed AVI assembled here from file ranges.

#[derive(Serialize, Default)]
pub struct AviScan {
    avih: Vec<u8>,
    strh: Vec<u8>,
    strf: Vec<u8>,
    /// per video frame: [offset of the payload, length, keyframe flag from idx1]
    frames: Vec<(u64, u32, bool)>,
}

fn fourcc(b: &[u8]) -> [u8; 4] {
    [b[0], b[1], b[2], b[3]]
}

/// Walk the RIFF tree (including OpenDML 'AVIX' extensions of files over 1 GB) reading only
/// chunk headers; collect the first video stream's headers and frame chunk positions.
pub fn scan_avi(path: &Path) -> std::io::Result<AviScan> {
    let mut f = std::io::BufReader::new(fs::File::open(path)?);
    let len = f.get_ref().metadata()?.len();
    let mut out = AviScan::default();
    let mut stream: i32 = -1;
    let mut video: i32 = -1;
    let mut first_movi: Option<u64> = None;
    let mut chunk_at: Vec<u64> = Vec::new();
    let mut idx1: Vec<u8> = Vec::new();
    // stack of (end offset, inside movi)
    let mut stack: Vec<(u64, bool)> = vec![(len, false)];
    let mut p: u64 = 0;
    let mut hdr = [0u8; 12];
    while let Some(&(end, in_movi)) = stack.last() {
        if p + 8 > end {
            stack.pop();
            p = end;
            continue;
        }
        f.seek(SeekFrom::Start(p))?;
        f.read_exact(&mut hdr[..8])?;
        let id = fourcc(&hdr);
        let mut size = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]) as u64;
        let body = p + 8;
        if body + size > len {
            size = len.saturating_sub(body); // truncated file
        }
        let next = body + size + (size & 1);
        match &id {
            b"RIFF" | b"LIST" => {
                f.read_exact(&mut hdr[8..12])?;
                let kind = fourcc(&hdr[8..]);
                if &kind == b"movi" && first_movi.is_none() {
                    first_movi = Some(body);
                }
                if &kind == b"strl" {
                    stream += 1;
                }
                stack.push((body + size, in_movi || &kind == b"movi"));
                p = body + 4;
                continue;
            }
            b"avih" => {
                out.avih = vec![0; size as usize];
                f.read_exact(&mut out.avih)?;
            }
            b"strh" => {
                let mut b = vec![0; size as usize];
                f.read_exact(&mut b)?;
                if b.len() >= 4 && &b[..4] == b"vids" && video < 0 {
                    video = stream;
                    out.strh = b;
                }
            }
            b"strf" if stream == video && out.strf.is_empty() => {
                out.strf = vec![0; size as usize];
                f.read_exact(&mut out.strf)?;
            }
            b"idx1" => {
                idx1 = vec![0; size as usize];
                f.read_exact(&mut idx1)?;
            }
            _ if in_movi && size > 0 && id[0].is_ascii_digit() && id[1].is_ascii_digit() && (&id[2..] == b"dc" || &id[2..] == b"db") => {
                let n = ((id[0] - b'0') * 10 + (id[1] - b'0')) as i32;
                if n == video {
                    out.frames.push((body, size as u32, false));
                    chunk_at.push(p);
                }
            }
            _ => {}
        }
        p = next;
    }
    if out.avih.is_empty() || out.strh.is_empty() || out.strf.is_empty() {
        return Err(std::io::Error::other("Not a usable AVI (missing video stream headers)"));
    }
    // keyframe flags from idx1 (offsets relative to 'movi' or absolute)
    if let Some(movi) = first_movi {
        let by_offset: HashMap<u64, usize> = chunk_at.iter().enumerate().map(|(i, &o)| (o, i)).collect();
        for e in idx1.chunks_exact(16) {
            let flags = u32::from_le_bytes([e[4], e[5], e[6], e[7]]);
            let off = u32::from_le_bytes([e[8], e[9], e[10], e[11]]) as u64;
            if let Some(&i) = by_offset.get(&(off + movi)).or_else(|| by_offset.get(&off)) {
                out.frames[i].2 = flags & 0x10 != 0;
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn avi_scan(state: State<'_, Engine>, path: String) -> Result<AviScan, String> {
    let path = state.path(&path)?;
    tauri::async_runtime::spawn_blocking(move || scan_avi(&path)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

/// Read several byte ranges of a file, concatenated.
#[tauri::command]
pub async fn engine_read_ranges(state: State<'_, Engine>, path: String, ranges: Vec<(u64, u32)>) -> Result<Response, String> {
    let path = state.path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut f = fs::File::open(&path)?;
        let mut out = Vec::with_capacity(ranges.iter().map(|r| r.1 as usize).sum());
        for (off, len) in ranges {
            let start = out.len();
            out.resize(start + len as usize, 0);
            f.seek(SeekFrom::Start(off))?;
            f.read_exact(&mut out[start..])?;
        }
        Ok::<_, std::io::Error>(Response::new(out))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
struct Assembly {
    dst: String,
    files: Vec<String>,
    /// [0, offset in the inline bytes, length] or [1, file index, offset, length]
    pieces: Vec<Vec<u64>>,
}

/// Write a file from pieces: inline bytes sent with the request and ranges of other files.
/// Raw body = u32 (LE) length of a JSON `Assembly`, the JSON, then the inline bytes.
#[tauri::command]
pub async fn engine_assemble(state: State<'_, Engine>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("expected raw bytes".into());
    };
    if body.len() < 4 {
        return Err("empty request".into());
    }
    let n = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
    let json = body.get(4..4 + n).ok_or("bad request")?;
    let a: Assembly = serde_json::from_slice(json).map_err(|e| e.to_string())?;
    let inline = body[4 + n..].to_vec();
    let dst = state.path(&a.dst)?;
    let files = a.files.iter().map(|p| state.path(p)).collect::<Result<Vec<_>, _>>()?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let io = |e: std::io::Error| e.to_string();
        if let Some(dir) = dst.parent() {
            fs::create_dir_all(dir).map_err(io)?;
        }
        let mut out = std::io::BufWriter::with_capacity(1 << 20, fs::File::create(&dst).map_err(io)?);
        let mut srcs: Vec<Option<fs::File>> = files.iter().map(|_| None).collect();
        let mut buf = vec![0u8; 1 << 20];
        for p in &a.pieces {
            match p.as_slice() {
                [0, off, len] => {
                    let end = off.checked_add(*len).ok_or("inline range out of bounds")?;
                    let r = inline.get(*off as usize..end as usize).ok_or("inline range out of bounds")?;
                    out.write_all(r).map_err(io)?;
                }
                [1, file, off, len] => {
                    let i = *file as usize;
                    let path = files.get(i).ok_or("bad file index")?;
                    if srcs[i].is_none() {
                        srcs[i] = Some(fs::File::open(path).map_err(io)?);
                    }
                    let f = srcs[i].as_mut().unwrap();
                    f.seek(SeekFrom::Start(*off)).map_err(io)?;
                    let mut left = *len as usize;
                    while left > 0 {
                        let k = left.min(buf.len());
                        f.read_exact(&mut buf[..k]).map_err(io)?;
                        out.write_all(&buf[..k]).map_err(io)?;
                        left -= k;
                    }
                }
                _ => return Err("bad piece".into()),
            }
        }
        out.flush().map_err(io)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn engine_move(state: State<'_, Engine>, from: String, to: String) -> Result<(), String> {
    let to = state.path(&to)?;
    if let Some(dir) = to.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::rename(state.path(&from)?, to).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn engine_size(state: State<'_, Engine>, path: String) -> Result<Option<u64>, String> {
    Ok(fs::metadata(state.path(&path)?).ok().map(|m| m.len()))
}

/// Native Save dialog for a file in the work folder (an export); the file is moved to the chosen
/// place, so multi-gigabyte exports never pass through the webview. Resolves with the chosen path,
/// or null when the dialog was cancelled (the file stays, so saving can be retried).
#[tauri::command]
pub async fn save_path(app: AppHandle, state: State<'_, Engine>, path: String, name: String) -> Result<Option<String>, String> {
    let src = state.path(&path)?;
    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Some(ext) = Path::new(&name).extension().and_then(|e| e.to_str()) {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    let Some(dest) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let dest = dest.into_path().map_err(|e| e.to_string())?;
    let shown = dest.display().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        // rename is instant on the same disk; across disks it fails, so copy instead
        if fs::rename(&src, &dest).is_err() {
            if let Err(e) = fs::copy(&src, &dest) {
                // (disk full, say): no half-written file left behind; the export stays, so saving can be retried
                let _ = fs::remove_file(&dest);
                return Err(e);
            }
            let _ = fs::remove_file(&src);
        }
        Ok::<_, std::io::Error>(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    Ok(Some(shown))
}

/// Show a saved file in Finder / Explorer / the file manager.
#[tauri::command]
pub async fn reveal(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_stay_inside_the_work_folder() {
        let root = Path::new("/work");
        assert_eq!(safe_join(root, "main/a.avi").unwrap(), root.join("main/a.avi"));
        for bad in ["", "../x", "main/../../x", "/etc/passwd", "./x"] {
            assert!(safe_join(root, bad).is_err(), "{bad} should be refused");
        }
        #[cfg(windows)]
        for bad in ["C:\\x", "\\\\server\\share\\x", "..\\x"] {
            assert!(safe_join(root, bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn stale_folders_are_removed_but_live_ones_kept() {
        let tmp = std::env::temp_dir().join(format!("moshpit-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let live = tmp.join("moshpit-1");
        let dead = tmp.join("moshpit-2");
        let other = tmp.join("unrelated");
        let lookalike = tmp.join("moshpit-exports");
        for d in [&live, &dead, &other, &lookalike] {
            fs::create_dir_all(d).unwrap();
        }
        let held = fs::File::create(live.join(".lock")).unwrap();
        held.try_lock().unwrap();
        fs::File::create(dead.join(".lock")).unwrap();
        fs::File::create(lookalike.join(".lock")).unwrap();
        remove_stale(&tmp);
        assert!(live.exists());
        assert!(!dead.exists());
        assert!(other.exists());
        assert!(lookalike.exists());
        drop(held);
        let _ = fs::remove_dir_all(&tmp);
    }
}
