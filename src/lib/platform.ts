// Which shell the app is running in. The desktop app (Tauri) injects __TAURI_INTERNALS__ before any script runs.
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
