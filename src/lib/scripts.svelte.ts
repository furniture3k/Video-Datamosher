// Running Script effects safely. The code runs in a Web Worker inside a sandboxed, hidden iframe:
// - the iframe has an opaque origin (sandbox without allow-same-origin): no access to the editor,
//   its storage or your files;
// - its Content-Security-Policy allows no network at all (no fetch, no import(), no WebSocket),
//   and the worker inherits it; the worker also removes those APIs before the code runs;
// - each run gets a time limit, after which the worker is stopped.
// Code that arrived from somewhere else (a recipe, a share code, a project file) is shown and must
// be allowed once before it runs; code typed in the editor counts as allowed.
import { store } from './store.svelte';
import { localGet, localSet } from './storage';
import { hashText, checkPlan, plans, planKey, SCRIPT_EXAMPLES, type ScriptFrame } from '../engine/effects/script';
import type { EffectInstance } from '../engine/types';

/** Milliseconds a script may take for one run. */
export const TIME_LIMIT = 3000;

export const scripts = $state({
  /** effect id → the last error, shown under its code */
  errors: {} as Record<string, string>,
  /** code waiting to be allowed (the dialog shows it) */
  consent: null as null | { code: string; name: string },
});

// ---------- which code may run ----------

const approved = new Set<string>(localGet<string[]>('approvedScripts', []));
/** The examples that come with the app can always run. */
const builtIn = new Set(SCRIPT_EXAMPLES.map((x) => hashText(x.code)));
export const isApproved = (code: string) => builtIn.has(hashText(code)) || approved.has(hashText(code));
export function approve(code: string) {
  approved.add(hashText(code));
  // the newest few hundred are remembered
  localSet('approvedScripts', [...approved].slice(-300));
}
/** The answer to the consent dialog. */
export function answerConsent(run: boolean) {
  const c = scripts.consent;
  scripts.consent = null;
  if (c && run) {
    approve(c.code);
    store.scheduleRender(50);
  }
}

// ---------- the sandbox ----------

/** Runs in the worker: lock the network away, then answer each request. */
const WORKER = `
'use strict';
for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'Request', 'Response']) {
  try { delete self[k]; } catch (e) {}
  let p = self;
  while ((p = Object.getPrototypeOf(p))) { try { delete p[k]; } catch (e) {} }
  try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch (e) {}
}
const rngOf = (seed) => { let a = seed >>> 0 || 0x12345678; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const post = self.postMessage.bind(self);
self.onmessage = (e) => {
  const { id, code, frames, ctx } = e.data;
  try {
    const fn = new Function('frames', 'ctx', code + '\\n;return typeof mosh === "function" ? mosh(frames, ctx) : undefined;');
    const plan = fn(frames, { ...ctx, random: rngOf(ctx.seed) });
    post({ id, plan: JSON.parse(JSON.stringify(plan ?? null)) });
  } catch (err) {
    post({ id, error: String((err && err.message) || err) });
  }
};`;

const SANDBOX = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:">
<script>
const url = URL.createObjectURL(new Blob([${JSON.stringify(WORKER)}], { type: 'text/javascript' }));
let w = null;
const start = () => {
  w = new Worker(url);
  w.onmessage = (e) => parent.postMessage(e.data, '*');
  w.onerror = (e) => { e.preventDefault(); parent.postMessage({ id: -1, error: e.message || 'the script crashed' }, '*'); };
};
onmessage = (e) => {
  if (e.source !== parent) return;
  if (e.data && e.data.restart) { if (w) w.terminate(); w = null; return; }
  if (!w) start();
  w.postMessage(e.data);
};
parent.postMessage({ ready: true }, '*');
</script>`;

let frame: HTMLIFrameElement | null = null;
let ready: Promise<void> | null = null;
let nextId = 1;
const waiting = new Map<number, (r: { plan?: unknown; error?: string }) => void>();

function sandbox(): Promise<HTMLIFrameElement> {
  if (frame && ready) return ready.then(() => frame!);
  frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  frame.srcdoc = SANDBOX;
  const f = frame;
  ready = new Promise((res) => {
    const on = (e: MessageEvent) => {
      if (e.source !== f.contentWindow) return;
      if (e.data?.ready) return res();
      const r = e.data as { id: number; plan?: unknown; error?: string };
      // a crash says no id: it belongs to whatever was running
      const id = r.id === -1 ? [...waiting.keys()][0] : r.id;
      waiting.get(id)?.(r);
      waiting.delete(id);
    };
    window.addEventListener('message', on);
  });
  document.body.appendChild(f);
  return ready.then(() => f);
}

/** Run a script on these frames, in the sandbox; resolves with its answer or an error. */
export async function runScript(code: string, input: ScriptFrame[], ctx: Record<string, unknown>, ms = TIME_LIMIT): Promise<{ plan?: unknown; error?: string }> {
  const f = await sandbox();
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      // a script that runs forever: stop its worker (the next run starts a new one)
      f.contentWindow?.postMessage({ restart: true }, '*');
      resolve({ error: `took longer than ${ms / 1000} s (an endless loop?)` });
    }, ms);
    waiting.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    f.contentWindow?.postMessage({ id, code, frames: input, ctx }, '*');
  });
}

/**
 * The `run` for prepareScripts: asks before running code that isn't allowed yet, runs it, checks
 * the answer and keeps it (errors are kept too, so a broken script isn't run again and again).
 */
export async function planScript(e: EffectInstance, input: ScriptFrame[], fps: number, total: number) {
  const code = String(e.data?.code ?? '');
  const key = planKey(e, input);
  if (!isApproved(code)) {
    scripts.consent ??= { code, name: String(e.data?.name ?? 'A script') };
    return;
  }
  const r = await runScript(code, input, { fps, total, start: e.start, end: e.end, seed: e.seed, amount: Number(e.params.amount ?? 0.5) });
  let error = r.error;
  if (!error)
    try {
      plans.set(key, checkPlan(r.plan, input.length));
    } catch (err) {
      error = (err as Error).message;
    }
  if (error) plans.set(key, { error });
  scripts.errors = { ...scripts.errors, [e.id]: error ?? '' };
  if (plans.size > 200) plans.delete(plans.keys().next().value!);
}
