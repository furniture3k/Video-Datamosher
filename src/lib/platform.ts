import { limits, MAX_OUTPUT_FRAMES_DESKTOP } from '../engine/mosh';

// Which shell the app is running in. The desktop app (Tauri) injects __TAURI_INTERNALS__ before any script runs.
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Native FFmpeg has no wasm memory ceiling, so the desktop app allows much longer output.
if (isDesktop) limits.maxOutputFrames = MAX_OUTPUT_FRAMES_DESKTOP;
