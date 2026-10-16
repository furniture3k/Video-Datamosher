import fs from 'node:fs';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { parseChangelog, releasesSince, compareVersions, boldRuns } from '../src/engine/changelog';

describe('changelog', () => {
  const md = `# Changelog

## 1.5.0

- **Splash.** A new
  loading screen.
- Plain \`code\` item.

## 1.4.0

- **Old** thing.

## 1.3.0

Some prose that isn't a bullet.
- Third.
`;

  it('splits versions and joins wrapped bullets', () => {
    const r = parseChangelog(md);
    expect(r.map((x) => x.version)).toEqual(['1.5.0', '1.4.0', '1.3.0']);
    expect(r[0].items).toHaveLength(2);
    expect(r[0].items[0]).toEqual([
      { text: 'Splash.', bold: true },
      { text: ' A new loading screen.', bold: false },
    ]);
    expect(r[0].items[1]).toEqual([{ text: 'Plain code item.', bold: false }]);
    expect(r[2].items).toHaveLength(1);
  });

  it('picks the releases newer than the one last seen', () => {
    const r = parseChangelog(md);
    expect(releasesSince(r, '1.3.0', '1.5.0').map((x) => x.version)).toEqual(['1.5.0', '1.4.0']);
    expect(releasesSince(r, '1.5.0', '1.5.0')).toEqual([]);
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0);
    expect(boldRuns('**a**')).toEqual([{ text: 'a', bold: true }]);
  });

  it('parses the real CHANGELOG.md, with notes for the current version', () => {
    const r = parseChangelog(fs.readFileSync('CHANGELOG.md', 'utf8'));
    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
    expect(r.length).toBeGreaterThan(3);
    expect(r[0].version).toBe(version);
    expect(r[0].items.length).toBeGreaterThan(0);
  });
});

describe('crash recovery flag', () => {
  const mem = new Map<string, string>();
  beforeAll(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    vi.stubGlobal('window', { addEventListener: () => {}, setInterval, clearInterval });
  });
  afterAll(() => vi.unstubAllGlobals());

  it('is set while work runs and cleared after', async () => {
    const { busy, crashedSession } = await import('../src/lib/recovery');
    const done = busy('render');
    expect(JSON.parse(mem.get('moshpit:busy')!).kind).toBe('render');
    // this tab's own flag never counts as a crash
    expect(crashedSession(Date.now() + 60000)).toBeNull();
    done();
    expect(mem.has('moshpit:busy')).toBe(false);
  });

  it('reports a stale flag from another tab once, and leaves a live one alone', async () => {
    const { crashedSession } = await import('../src/lib/recovery');
    const now = Date.now();
    mem.set('moshpit:busy', JSON.stringify({ kind: 'export', at: now - 2000, tab: 'other' }));
    expect(crashedSession(now)).toBeNull(); // still beating: another open tab
    expect(mem.has('moshpit:busy')).toBe(true);
    expect(crashedSession(now + 60000)?.kind).toBe('export');
    expect(mem.has('moshpit:busy')).toBe(false);
    expect(crashedSession(now + 60000)).toBeNull();
  });
});

describe('crash recovery flag across tabs', () => {
  it("a tab with nothing running never clears another tab's flag", async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    vi.stubGlobal('window', { addEventListener: () => {}, setInterval, clearInterval });
    const { busy } = await import('../src/lib/recovery');
    const other = JSON.stringify({ kind: 'render', at: Date.now(), tab: 'other' });
    // our job ends while another tab's flag is the stored one
    const done = busy('render');
    mem.set('moshpit:busy', other);
    done();
    expect(mem.get('moshpit:busy')).toBe(other);
    vi.unstubAllGlobals();
  });
});
