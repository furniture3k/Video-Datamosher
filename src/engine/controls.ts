// MIDI and OSC controls: turning a message into a control key and a 0..1 value, and a 0..1 value
// into a setting's value. No browser APIs here (see src/lib/controls.svelte.ts for those).
import type { ParamDef } from './effects';
import type { ParamValue } from './types';

/** A MIDI message as a control key and a value 0..1 (null for messages that don't control). */
export function midiControl(data: ArrayLike<number>): { key: string; value: number } | null {
  if (data.length < 3) return null;
  const kind = data[0] & 0xf0;
  const ch = (data[0] & 0x0f) + 1;
  // knobs and faders
  if (kind === 0xb0) return { key: `cc:${ch}:${data[1]}`, value: data[2] / 127 };
  // pads and keys: velocity on press (note-offs and zero-velocity note-ons are let go)
  if (kind === 0x90 && data[2] > 0) return { key: `note:${ch}:${data[1]}`, value: data[2] / 127 };
  // pitch bend: 14 bits
  if (kind === 0xe0) return { key: `bend:${ch}`, value: ((data[2] << 7) | data[1]) / 16383 };
  return null;
}

/** An OSC value as 0..1: most apps send 0..1; whole numbers above 1 are taken as MIDI-style 0..127. */
export function oscValue(v: number): number {
  if (!isFinite(v)) return 0;
  if (v > 1 && Number.isInteger(v)) return Math.min(1, v / 127);
  return Math.max(0, Math.min(1, v));
}

/** What a setting becomes for a control at 0..1. Pads (notes) flip switches instead of setting them. */
export function controlValue(def: ParamDef, v: number, current: ParamValue, key: string): ParamValue {
  if (def.type === 'number' || def.type === 'int') {
    // log sliders follow the slider, not the number
    const raw = def.log && def.min >= 0 ? Math.exp(v * Math.log(def.max + 1)) - 1 : def.min + v * (def.max - def.min);
    const step = def.type === 'int' ? 1 : (def.step ?? 0.01);
    return +Math.max(def.min, Math.min(def.max, Math.round(raw / step) * step)).toFixed(4);
  }
  if (def.type === 'bool') return key.startsWith('note:') ? !current : v >= 0.5;
  if (def.type === 'select') {
    if (key.startsWith('note:')) {
      const i = def.options.findIndex((o) => o.value === current);
      return def.options[(i + 1) % def.options.length].value;
    }
    return def.options[Math.min(def.options.length - 1, Math.floor(v * def.options.length))].value;
  }
  return current;
}

/** How a control key reads to people: "CC 21 (ch 1)", "Note C4", "OSC /fader1". */
export function controlLabel(key: string): string {
  const [kind, a, b] = key.split(':');
  if (kind === 'cc') return `CC ${b}${a !== '1' ? ` (ch ${a})` : ''}`;
  if (kind === 'note') {
    const n = +b;
    return `Note ${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][n % 12]}${Math.floor(n / 12) - 1}${a !== '1' ? ` (ch ${a})` : ''}`;
  }
  if (kind === 'bend') return `Pitch bend${a !== '1' ? ` (ch ${a})` : ''}`;
  if (kind === 'osc') return `OSC ${key.slice(4)}`;
  return key;
}
