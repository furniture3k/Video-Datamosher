import { limits, MAX_OUTPUT_FRAMES_DESKTOP } from '../engine/mosh';

// Which shell the app is running in. The Tauri apps inject __TAURI_INTERNALS__ before any script runs.
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
/** The Android app (experimental): the browser's video engine, saving to Downloads. */
export const isAndroidApp = isTauri && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
/** The desktop app: native FFmpeg, native Save dialogs, files on disk. */
export const isDesktop = isTauri && !isAndroidApp;

/**
 * A phone or tablet, or a computer with little memory: caches of decoded frames are kept smaller
 * there (mobile browsers close a tab that uses too much, iPhones at around a gigabyte).
 */
export const lowMemory =
  typeof navigator !== 'undefined' &&
  !isDesktop &&
  (((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 4 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)));

// Native FFmpeg has no wasm memory ceiling, so the desktop app allows much longer output.
if (isDesktop) limits.maxOutputFrames = MAX_OUTPUT_FRAMES_DESKTOP;
