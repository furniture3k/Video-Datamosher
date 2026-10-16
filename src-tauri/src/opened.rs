// Files the desktop app is asked to open: on its command line ("Open with", dragging a file onto
// the app's icon), from a second launch while it runs, or by macOS while it runs. The page drains
// them with `opened_files` and reads each one with `read_opened_file`, which only reads files that
// arrived this way (the page can't use it to read anything else on disk).
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct Opened {
    pending: Mutex<Vec<String>>,
    allowed: Mutex<HashSet<PathBuf>>,
}

impl Opened {
    /// Queue files for the page; returns how many were added.
    pub fn add(&self, paths: impl IntoIterator<Item = PathBuf>) -> usize {
        let mut pending = self.pending.lock().unwrap();
        let mut allowed = self.allowed.lock().unwrap();
        let mut n = 0;
        for p in paths {
            let Ok(p) = p.canonicalize() else { continue };
            if !p.is_file() {
                continue;
            }
            pending.push(p.to_string_lossy().into_owned());
            allowed.insert(p);
            n += 1;
        }
        n
    }
}

/// File paths among command-line arguments (flags and anything that isn't a file are skipped).
pub fn from_args<I: IntoIterator<Item = String>>(args: I) -> Vec<PathBuf> {
    args.into_iter().filter(|a| !a.starts_with('-')).map(PathBuf::from).filter(|p| p.is_file()).collect()
}

/// Files that arrive while the app runs: queue them and tell the page to collect them.
pub fn deliver(app: &AppHandle, paths: Vec<PathBuf>) {
    if app.state::<Opened>().add(paths) > 0 {
        let _ = app.emit("opened-files", ());
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn opened_files(state: State<'_, Opened>) -> Vec<String> {
    std::mem::take(&mut *state.pending.lock().unwrap())
}

#[tauri::command]
pub async fn read_opened_file(state: State<'_, Opened>, path: String) -> Result<Response, String> {
    let p = PathBuf::from(&path).canonicalize().map_err(|e| e.to_string())?;
    if !state.allowed.lock().unwrap().contains(&p) {
        return Err("moshpit wasn't asked to open this file".into());
    }
    std::fs::read(&p).map(Response::new).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_existing_files_are_taken() {
        let dir = std::env::temp_dir().join(format!("moshpit-opened-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("clip.mp4");
        std::fs::write(&f, b"x").unwrap();
        let args = vec!["--flag".to_string(), f.to_string_lossy().into_owned(), dir.join("missing.mp4").to_string_lossy().into_owned(), dir.to_string_lossy().into_owned()];
        let paths = from_args(args);
        assert_eq!(paths, vec![f.clone()]);
        let o = Opened::default();
        assert_eq!(o.add(paths), 1);
        assert!(o.allowed.lock().unwrap().contains(&f.canonicalize().unwrap()));
        assert_eq!(o.pending.lock().unwrap().len(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
