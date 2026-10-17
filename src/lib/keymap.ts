// Which keys run which command: the defaults from commandlist.ts, with any you changed in
// Help → Keyboard shortcuts (kept in this browser).
import { COMMANDS } from './commandlist';
import { localGet, localSet } from './storage';

const KEY = 'keymap';
type Overrides = Record<string, string[]>;

export const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

/**
 * The combo a key press stands for, in the same form as the command list: "Mod+Shift+Z", "Alt+T",
 * "Space", "?", "F9". Shift is part of letters and named keys, but not of punctuation, which shift
 * already changes ("?" not "Shift+/"). Alt uses the physical key (Alt changes the character on a Mac).
 */
export function comboOf(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  let key = e.key;
  if (e.altKey && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (e.altKey && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  // a letter from a non-Latin layout (Cyrillic, Greek, kana…): the shortcut is the key's place
  else if (key.length === 1 && /^Key[A-Z]$/.test(e.code) && /[^\x20-\x7e]/.test(key)) key = e.code.slice(3);
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  const letterOrNamed = /^[A-Z0-9]$/.test(key) || key.length > 1;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && letterOrNamed) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** Normalise a written combo ("shift+k", "Ctrl+Z") to the stored form. */
export function normalize(combo: string): string {
  const parts = combo.split(/\+(?!$)/).map((p) => p.trim());
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const out: string[] = [];
  if (mods.has('mod') || mods.has('ctrl') || mods.has('cmd') || mods.has('meta')) out.push('Mod');
  if (mods.has('alt') || mods.has('option')) out.push('Alt');
  if (mods.has('shift')) out.push('Shift');
  out.push(key.length === 1 ? key.toUpperCase() : key);
  return out.join('+');
}

let overrides: Overrides = localGet<Overrides>(KEY, {});
let lookup: Map<string, string> | null = null;

/** The keys a command runs on now. */
export function keysOf(id: string): string[] {
  return overrides[id] ?? COMMANDS.find((c) => c.id === id)?.keys ?? [];
}

/** The command a combo runs, or undefined. */
export function commandFor(combo: string): string | undefined {
  if (!lookup) {
    lookup = new Map();
    for (const c of COMMANDS) for (const k of keysOf(c.id)) if (!lookup.has(k)) lookup.set(k, c.id);
  }
  return lookup.get(combo);
}

/** Commands (other than `id`) already using a combo. */
export function conflictsWith(combo: string, id: string): string[] {
  return COMMANDS.filter((c) => c.id !== id && keysOf(c.id).includes(combo)).map((c) => c.id);
}

function save() {
  lookup = null;
  localSet(KEY, overrides);
}

/** Give a command these keys; any other command using one of them loses it. */
export function setKeys(id: string, keys: string[]) {
  for (const k of keys)
    for (const other of conflictsWith(k, id))
      overrides[other] = keysOf(other).filter((x) => x !== k);
  overrides[id] = keys;
  // back to the default: forget the override
  const def = COMMANDS.find((c) => c.id === id)?.keys ?? [];
  if (def.length === keys.length && def.every((k, i) => k === keys[i])) delete overrides[id];
  save();
}

export function resetKeys() {
  overrides = {};
  save();
}

export const changedKeys = () => Object.keys(overrides).length > 0;
