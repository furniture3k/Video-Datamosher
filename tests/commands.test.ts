import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { COMMANDS, keyLabel } from '../src/lib/commandlist';
import { fuzzyFilter, fuzzyScore } from '../src/lib/fuzzy';
import { Eta, formatSeconds, overallProgress } from '../src/engine/eta';
import { describeChange } from '../src/engine/history';
import { makeEffect } from '../src/engine/presets';
import { newProject, type Project, type MediaItem, type Clip } from '../src/engine/types';

// keymap keeps its changes in localStorage
const local = new Map<string, unknown>();
vi.mock('../src/lib/storage', () => ({
  localGet: (k: string, d: unknown) => (local.has(k) ? local.get(k) : d),
  localSet: (k: string, v: unknown) => void local.set(k, v),
}));
const keymap = await import('../src/lib/keymap');

const ev = (key: string, o: Partial<KeyboardEvent> = {}) =>
  ({ key, code: o.code ?? (key.length === 1 && /[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : ''), ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o }) as KeyboardEvent;

describe('keys', () => {
  it('turns key presses into combos the way the command list writes them', () => {
    expect(keymap.comboOf(ev(' '))).toBe('Space');
    expect(keymap.comboOf(ev('s'))).toBe('S');
    expect(keymap.comboOf(ev('S', { shiftKey: true }))).toBe('Shift+S');
    expect(keymap.comboOf(ev('z', { ctrlKey: true }))).toBe('Mod+Z');
    expect(keymap.comboOf(ev('Z', { metaKey: true, shiftKey: true }))).toBe('Mod+Shift+Z');
    // shift is already in the character for punctuation
    expect(keymap.comboOf(ev('?', { shiftKey: true }))).toBe('?');
    expect(keymap.comboOf(ev('<', { shiftKey: true }))).toBe('<');
    expect(keymap.comboOf(ev('Delete', { shiftKey: true }))).toBe('Shift+Delete');
    // Alt changes the character on a Mac: the physical key counts
    expect(keymap.comboOf(ev('≈', { altKey: true, code: 'KeyX' }))).toBe('Alt+X');
    // non-Latin layouts: the letter's place on the keyboard (Latin layouts like AZERTY keep their letters)
    expect(keymap.comboOf(ev('я', { ctrlKey: true, code: 'KeyZ' }))).toBe('Mod+Z');
    expect(keymap.comboOf(ev('ы', { code: 'KeyS' }))).toBe('S');
    expect(keymap.comboOf(ev('a', { code: 'KeyQ' }))).toBe('A');
    expect(keymap.normalize('ctrl+shift+z')).toBe('Mod+Shift+Z');
  });

  it('every command has a unique id and no two share a default key', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seen = new Map<string, string>();
    for (const c of COMMANDS)
      for (const k of c.keys) {
        expect(seen.get(k), `${k} is on ${seen.get(k)} and ${c.id}`).toBeUndefined();
        seen.set(k, c.id);
        // defaults are written in the normalised form
        expect(keymap.normalize(k)).toBe(k.length === 1 ? k.toUpperCase() : k);
      }
  });

  it('every command in the list has something to do', () => {
    const src = fs.readFileSync('src/lib/commands.svelte.ts', 'utf8');
    for (const c of COMMANDS) expect(src.includes(`'${c.id}':`) || src.includes(`\n  ${c.id}:`), c.id).toBe(true);
  });

  it('changed keys take over, move off other commands, and reset', () => {
    expect(keymap.commandFor('Space')).toBe('play');
    keymap.setKeys('play', ['P']);
    expect(keymap.commandFor('P')).toBe('play');
    expect(keymap.commandFor('Space')).toBeUndefined();
    // Presets had P
    expect(keymap.keysOf('presets')).toEqual([]);
    keymap.resetKeys();
    expect(keymap.commandFor('Space')).toBe('play');
    expect(keymap.commandFor('P')).toBe('presets');
  });

  it('labels keys for people', () => {
    expect(keyLabel('Mod+Shift+Z')).toBe('Ctrl Shift Z');
    expect(keyLabel('Mod+Shift+Z', true)).toBe('⌘ ⇧ Z');
    expect(keyLabel('+')).toBe('+');
    expect(keyLabel('Mod+=')).toBe('Ctrl =');
  });
});

describe('finding commands', () => {
  it('matches loosely, best first', () => {
    expect(fuzzyScore('melt', 'Melt the nearest cut')).toBeGreaterThan(fuzzyScore('melt', 'Add effect: Liquid melt'));
    expect(fuzzyScore('mlt', 'Melt the nearest cut')).toBeGreaterThan(0);
    expect(fuzzyScore('xyz', 'Melt the nearest cut')).toBe(-1);
    const items = ['Export…', 'Add effect: Bloom', 'Bloom melt', 'Undo'];
    expect(fuzzyFilter('bloom', items, (x) => x)[0]).toBe('Bloom melt');
    expect(fuzzyFilter('add bl', items, (x) => x)[0]).toBe('Add effect: Bloom');
    expect(fuzzyFilter('', items, (x) => x)).toEqual(items);
  });
});

describe('time left', () => {
  it('estimates from the recent rate and starts over for a new stage', () => {
    const e = new Eta();
    expect(e.update('Preparing', 0, 0)).toBeNull();
    expect(e.update('Preparing', 0.1, 1000)).toBeNull(); // too early
    expect(e.update('Preparing', 0.2, 2000)).toBeCloseTo(8, 5); // 10 %/s, 80 % to go
    expect(e.update('Decoding', 0.5, 2100)).toBeNull();
    expect(formatSeconds(12.2)).toBe('13 s');
    expect(formatSeconds(95)).toBe('1 min 35 s');
    expect(formatSeconds(0.2)).toBe('a moment');
  });

  it('combines the render stages into one bar that only moves forward', () => {
    const steps = [overallProgress('Preparing clips', 0), overallProgress('Preparing clips', 1), overallProgress('Moshing', 0), overallProgress('Decoding', 0.5), overallProgress('Pixel effects', 1)];
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
    expect(steps[0]).toBe(0);
    expect(steps[steps.length - 1]).toBeCloseTo(1, 5);
  });
});

describe('history names', () => {
  const media = (id: string, name: string) => ({ id, source: { kind: 'file', fileId: id, name, mime: 'video/mp4', isImage: false, ext: 'mp4' }, duration: 5, width: 640, height: 360, fps: 24, hasAudio: false, hasVideo: true }) as MediaItem;
  const clip = (id: string, mediaId: string, start: number): Clip => ({ id, mediaId, track: 'v1', start, in: 0, out: 3, speed: 1, reverse: false, fit: 'fit', volume: 1, muted: false, fadeIn: 0, fadeOut: 0 });
  const base = (): Project => ({ ...newProject(), media: [media('m1', 'beach.mp4'), media('m2', 'city.mp4')], clips: [clip('a', 'm1', 0), clip('b', 'm2', 3)] });
  const copy = (p: Project): Project => JSON.parse(JSON.stringify(p));

  it('names effect changes', () => {
    const a = base();
    const b = copy(a);
    const fx = makeEffect('bloom', 0, 10);
    b.effects.push(fx);
    expect(describeChange(a, b)).toBe('Add Bloom');
    const c = copy(b);
    c.effects[0].start = 5;
    c.effects[0].end = 15;
    expect(describeChange(b, c)).toBe('Move Bloom');
    const d = copy(b);
    d.effects[0].params = { ...d.effects[0].params, x: 1 };
    expect(describeChange(b, d)).toBe('Change Bloom');
    expect(describeChange(b, a)).toBe('Remove Bloom');
  });

  it('names clip changes by their footage', () => {
    const a = base();
    const t = copy(a);
    t.clips[0].out = 2;
    expect(describeChange(a, t)).toBe('Trim beach');
    const m = copy(a);
    m.clips[1].transition = { type: 'melt', duration: 1, intensity: 0.5 };
    expect(describeChange(a, m)).toBe('Melt on a cut');
    const s = copy(a);
    s.clips[0].out = 1.5;
    s.clips.push({ ...clip('c', 'm1', 1.5), in: 1.5, out: 3 });
    expect(describeChange(a, s)).toBe('Split beach');
    const del = copy(a);
    del.clips.pop();
    expect(describeChange(a, del)).toBe('Delete city');
    const r = copy(a);
    r.name = 'Summer';
    expect(describeChange(a, r)).toBe('Rename to “Summer”');
  });
});
