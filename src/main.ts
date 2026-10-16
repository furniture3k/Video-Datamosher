import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { isDesktop } from './lib/platform';
import { startI18n } from './lib/i18n.svelte';

startI18n();

// Behave like an app, not a web page: no browser right-click menu (the timeline and media
// panel have their own), no pinch-zooming the interface, no dropping a file to navigate away.
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || !!t.closest('.selectable'));
window.addEventListener('contextmenu', (e) => {
  if (!typing(e.target)) e.preventDefault();
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
// Safari's own pinch gesture would zoom the whole interface
document.addEventListener('gesturestart', (e) => e.preventDefault());
// In the desktop app the window is the editor: page zoom, reload and print would only break it.
// (In a browser tab those stay the browser's.)
if (isDesktop) window.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false });
if (isDesktop) window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  // reload, print, find, save-page and the browser's own zoom are not part of the editor
  if (e.key === 'F5' || (mod && ['r', 'p', 'f', 'g', 'u', 'j'].includes(e.key.toLowerCase()) && !e.altKey) || (mod && e.key === '0')) {
    if (!typing(e.target) || e.key === 'F5' || e.key.toLowerCase() === 'r') e.preventDefault();
  }
});

const target = document.getElementById('app')!;
target.innerHTML = ''; // remove the boot screen
const app = mount(App, { target });
(window as unknown as { __moshpitMounted: boolean }).__moshpitMounted = true;
document.getElementById('boot-error')?.remove();
document.body.removeAttribute('style'); // boot-screen colours; the theme takes over now
export default app;

// Installable web app: keep the app on the device so it opens offline (not in the desktop app or dev server).
if (import.meta.env.PROD && !isDesktop && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('offline support unavailable:', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) store.toast('moshpit was updated. Reload to use the new version.', 'info', 15000, { label: 'Reload', run: () => location.reload() });
  });
}

// Debug handle (handy in the browser console and for automated tests)
import { store } from './lib/store.svelte';
import { ffmpeg } from './lib/ffmpeg';
import { mediaState } from './lib/mediastate.svelte';
import * as edit from './lib/edit';
(window as unknown as Record<string, unknown>).__moshpit = { store, ffmpeg, mediaState, edit };
import * as mosh from './engine/mosh';
import * as renderer from './lib/renderer';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { mosh, renderer });
import * as flow from './lib/flow';
import * as glmod from './lib/gl';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { flow, gl: glmod });
import * as timeline from './engine/timeline';
import * as media from './lib/media';
import * as captions from './lib/captions.svelte';
import * as motion from './lib/motion.svelte';
import * as segment from './lib/segment';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { timeline, media, captions, motion, segment });
import * as report from './lib/report';
import * as incoming from './lib/incoming';
import * as recovery from './lib/recovery';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { report, incoming, recovery });
import * as starters from './lib/starters.svelte';
import * as projectsMod from './lib/projects.svelte';
import * as projectIndex from './lib/projectindex';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { starters, projects: projectsMod, projectIndex });
import * as projectio from './lib/projectio.svelte';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { projectio });

// media kept in IndexedDB by older versions moves to the file system (OPFS) once the app is idle
import * as storage from './lib/storage';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { storage });
setTimeout(() => {
  storage
    .moveFilesToDisk()
    .then((n) => n && console.info(`moved ${n} media files to the file system`))
    .catch((e) => console.warn('moving media files', e));
}, 8000);
import * as maps from './lib/maps';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { maps });
import { EFFECTS } from './engine/effects';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { effects: EFFECTS });
import * as text from './lib/text';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { text });
import * as commands from './lib/commands.svelte';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { commands });
import * as controlsMod from './lib/controls.svelte';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { controls: controlsMod });
controlsMod.startControls().catch((e) => console.warn('controls', e));
import * as scriptsMod from './lib/scripts.svelte';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { scripts: scriptsMod });
