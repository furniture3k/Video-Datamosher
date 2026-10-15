import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const target = document.getElementById('app')!;
target.innerHTML = ''; // remove the boot screen
const app = mount(App, { target });
(window as unknown as { __moshpitMounted: boolean }).__moshpitMounted = true;
document.getElementById('boot-error')?.remove();
document.body.removeAttribute('style'); // boot-screen colours; the theme takes over now
export default app;

// Installable web app: keep the app on the device so it opens offline (not in the desktop app or dev server).
import { isDesktop } from './lib/platform';
if (import.meta.env.PROD && !isDesktop && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('offline support unavailable:', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) store.toast('moshpit was updated. Reload to use the new version.', 'info', 8000);
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
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { timeline, media, captions, motion });
