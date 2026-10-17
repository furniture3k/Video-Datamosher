// Hardware controls: MIDI knobs, faders and pads (Web MIDI, in Chrome and Edge, and in the desktop
// app where its webview has it) and OSC (desktop app: a UDP port, for TouchOSC, Max, Pure Data…).
// Right-click a setting to learn a control; the mapping is kept in the project. Moving the control
// moves the setting, live, in the editor and in Live mode.
import { store } from './store.svelte';
import { localGet, localSet } from './storage';
import { isDesktop } from './platform';
import { EFFECTS } from '../engine/effects';
import { midiControl, oscValue, controlValue, controlLabel } from '../engine/controls';
import type { ControlMap } from '../engine/types';

type MidiInput = { name?: string | null; onmidimessage: ((e: { data: Uint8Array }) => void) | null };
type MidiAccess = { inputs: Map<string, MidiInput>; onstatechange: (() => void) | null };

export const controls = $state({
  /** MIDI: not asked yet, on, refused, or not in this browser */
  midi: 'off' as 'off' | 'on' | 'denied' | 'unsupported',
  inputs: [] as string[],
  /** OSC port being listened on (desktop), or 0 */
  osc: 0,
  /** the setting waiting for a control to be moved */
  learning: null as { effectId: string; param: string } | null,
  /** the last control moved (for showing activity) */
  last: '',
});

const hasMidi = () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

/** Ask for MIDI and listen to every input (also ones plugged in later). */
export async function enableMidi(): Promise<boolean> {
  if (controls.midi === 'on') return true;
  if (!hasMidi()) {
    controls.midi = 'unsupported';
    return false;
  }
  try {
    const access = (await (navigator as unknown as { requestMIDIAccess(o?: object): Promise<MidiAccess> }).requestMIDIAccess({ sysex: false })) as MidiAccess;
    const attach = () => {
      controls.inputs = [];
      for (const input of access.inputs.values()) {
        input.onmidimessage = (e) => {
          const c = midiControl(e.data);
          if (c) received(c.key, c.value);
        };
        controls.inputs.push(input.name || 'MIDI input');
      }
    };
    attach();
    access.onstatechange = attach;
    controls.midi = 'on';
    localSet('midi', true);
    return true;
  } catch {
    controls.midi = 'denied';
    return false;
  }
}

/** Listen for OSC on a UDP port (desktop app); 0 stops. */
export async function setOscPort(port: number): Promise<boolean> {
  if (!isDesktop) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    await invoke('osc_listen', { port });
    controls.osc = port;
    localSet('oscPort', port);
    return true;
  } catch (e) {
    store.toast(`Could not listen for OSC on port ${port}: ${(e as Error)?.message ?? e}`, 'error', 6000);
    controls.osc = 0;
    return false;
  }
}

let started = false;
/** At start-up: MIDI again if it was on before (no prompt once allowed), and the OSC listener. */
export async function startControls() {
  if (started) return;
  started = true;
  if (localGet('midi', false) && hasMidi()) {
    // only when already granted: never a permission prompt without a click
    const st = await navigator.permissions?.query({ name: 'midi' as PermissionName }).catch(() => null);
    if (st?.state === 'granted') await enableMidi();
  }
  if (isDesktop) {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<{ address: string; value: number }>('osc', (e) => received('osc:' + e.payload.address, oscValue(e.payload.value)));
    const port = localGet('oscPort', 0);
    if (port) await setOscPort(port);
  }
}

/** Wait for the next control moved and map it to this setting. */
export async function learn(effectId: string, param: string) {
  if (controls.midi !== 'on' && !controls.osc) {
    const ok = await enableMidi();
    if (!ok && !isDesktop) {
      store.toast(controls.midi === 'unsupported' ? 'This browser has no MIDI (Chrome and Edge do). The desktop app also takes OSC.' : 'MIDI was not allowed.', 'error', 6000);
      return;
    }
  }
  controls.learning = { effectId, param };
  store.toast('Move a knob, fader or pad (or send an OSC message) to control this setting.', 'info', 6000);
}

export const mappingFor = (effectId: string, param: string): ControlMap | undefined => store.project.controls?.find((c) => c.effectId === effectId && c.param === param);

export function forget(effectId: string, param: string) {
  store.edit((p) => (p.controls = (p.controls ?? []).filter((c) => !(c.effectId === effectId && c.param === param))));
}

// values arrive faster than the screen draws: the latest per control is applied once a frame
const pending = new Map<string, number>();
let frame = 0;

function received(key: string, value: number) {
  controls.last = controlLabel(key);
  const l = controls.learning;
  if (l) {
    controls.learning = null;
    store.edit((p) => {
      // one control per setting, and one setting per control
      p.controls = [...(p.controls ?? []).filter((c) => c.key !== key && !(c.effectId === l.effectId && c.param === l.param)), { key, ...l }];
    });
    store.toast(`${controlLabel(key)} now moves this setting. Right-click it again to forget.`, 'ok', 5000);
    return;
  }
  if (!store.project.controls?.some((c) => c.key === key)) return;
  pending.set(key, value);
  frame ||= requestAnimationFrame(apply);
}

function apply() {
  frame = 0;
  const maps = store.project.controls ?? [];
  const moves = [...pending];
  pending.clear();
  store.edit((p) => {
    for (const [key, v] of moves)
      for (const m of maps.filter((x) => x.key === key)) {
        const e = p.effects.find((x) => x.id === m.effectId);
        const def = e && EFFECTS[e.type]?.params.find((d) => d.key === m.param);
        if (!e || !def || e.auto[m.param]) continue;
        e.params[m.param] = controlValue(def, v, e.params[m.param], key);
      }
  }, 'controls');
}

/** Test hook: a control message, as if from a device. */
export const simulate = received;
