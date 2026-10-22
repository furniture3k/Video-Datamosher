// Files arriving from outside the app: dropped on the window, opened with moshpit from the
// system ("Open with", double-click), shared to it from another app, or passed to the desktop app.
import { addFiles, mimeOf } from './media';
import { loadProjectFile, openRecipeFile } from './projectio.svelte';
import { store } from './store.svelte';
import { isDesktop } from './platform';
import { startProject } from './projects.svelte';
import { openRecipe } from './starters.svelte';

const isRecipe = (f: File) => /\.moshrecipe$/i.test(f.name);
const isProject = (f: File) => !isRecipe(f) && (/\.json$/i.test(f.name) || f.type === 'application/json');

/** Project files are opened, recipes put on the project; everything else goes into the media library. */
export async function openFiles(files: File[]) {
  const recipes = files.filter(isRecipe);
  const projects = files.filter(isProject);
  const media = files.filter((f) => !isProject(f) && !isRecipe(f));
  // a project replaces the timeline, so open it first and add media to it after
  if (projects.length) await loadProjectFile(projects[0]);
  if (projects.length > 1) store.toast('Opened the first project; one at a time.', 'info');
  // from the home screen, media starts a new project; in the editor it joins the open one
  if (!projects.length && media.length && store.ui.home) await startProject();
  if (media.length) await addFiles(media);
  // last, so it lands on the media that came with it
  if (recipes.length) await openRecipeFile(recipes[0]);
}

/** The cache the service worker puts shared files in (see scripts/sw.js). */
const SHARE_CACHE = 'moshpit-share';

type LaunchParams = { files: { getFile(): Promise<File> }[] };
type LaunchWindow = { launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void } };

/** Start listening for files from the system (call once at start-up, after the project is restored). */
export async function listenForIncoming() {
  // a recipe link (the gallery on the website): app/#recipe=MOSH:…
  const m = /^#recipe=(.+)$/.exec(location.hash);
  if (m) {
    history.replaceState(null, '', location.pathname + location.search);
    const code = decodeURIComponent(m[1]);
    openRecipe(code).catch((e) => store.toast('That recipe link is broken: ' + ((e as Error)?.message ?? e), 'error', 6000));
  }

  // installed web app: "Open with moshpit" and double-clicked files (file_handlers in the manifest)
  (window as unknown as LaunchWindow).launchQueue?.setConsumer(async (p) => {
    if (!p.files?.length) return;
    try {
      await openFiles(await Promise.all(p.files.map((h) => h.getFile())));
    } catch (e) {
      store.toast('Could not open the file: ' + ((e as Error)?.message ?? e), 'error', 6000);
    }
  });

  // shared from another app (share_target): the service worker stashed the files
  if (new URLSearchParams(location.search).has('shared') && 'caches' in window) {
    history.replaceState(null, '', location.pathname);
    try {
      const cache = await caches.open(SHARE_CACHE);
      const keys = await cache.keys();
      const files: File[] = [];
      for (const k of keys) {
        const r = await cache.match(k);
        if (!r) continue;
        const name = decodeURIComponent(new URL(k.url).searchParams.get('name') || 'shared');
        // (the service worker files a share with no type as application/octet-stream)
        const ct = r.headers.get('content-type') || '';
        files.push(new File([await r.blob()], name, { type: ct && ct !== 'application/octet-stream' ? ct : mimeOf(name) }));
        await cache.delete(k);
      }
      if (files.length) openFiles(files);
      else store.toast('Nothing came through from the share. Try again, or import the file instead.', 'error', 6000);
    } catch (e) {
      console.warn('shared files', e);
    }
  }

  // desktop app: files the app was opened with, and files opened while it runs
  if (isDesktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');
    const take = async () => {
      const paths = await invoke<string[]>('opened_files').catch(() => [] as string[]);
      const files: File[] = [];
      for (const p of paths) {
        try {
          const bytes = await invoke<ArrayBuffer>('read_opened_file', { path: p });
          const name = p.split(/[\\/]/).pop() || 'file';
          files.push(new File([bytes], name, { type: mimeOf(name) }));
        } catch (e) {
          store.toast(`Could not open ${p}: ${(e as Error)?.message ?? e}`, 'error');
        }
      }
      if (files.length) openFiles(files);
    };
    listen('opened-files', () => take());
    take();
  }
}
