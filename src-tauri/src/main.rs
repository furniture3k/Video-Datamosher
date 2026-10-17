// moshpit desktop: the web app in a native window, with a native FFmpeg instead of ffmpeg.wasm.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    moshpit_lib::run()
}
