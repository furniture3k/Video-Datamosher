import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });
export default app;

// Debug handle (handy in the browser console and for automated tests)
import { store } from './lib/store.svelte';
import { ffmpeg } from './lib/ffmpeg';
(window as unknown as Record<string, unknown>).__moshpit = { store, ffmpeg };
import * as mosh from './engine/mosh';
import * as renderer from './lib/renderer';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { mosh, renderer });
import * as flow from './lib/flow';
import * as glmod from './lib/gl';
Object.assign((window as unknown as { __moshpit: object }).__moshpit, { flow, gl: glmod });
