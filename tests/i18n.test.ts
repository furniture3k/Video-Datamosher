import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { preferredLocale, translate, LOCALES } from '../src/lib/i18n';

/** Every t('…') text in the app's source. */
function texts(): Set<string> {
  const out = new Set<string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(svelte|ts)$/.test(e.name))
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/\b(?:t|tr)\((['"])((?:(?!\1).)+)\1/g)) out.add(m[2]);
    }
  };
  walk('src');
  return out;
}

describe('translations', () => {
  const catalogs = Object.fromEntries(LOCALES.filter((l) => l.id !== 'en').map((l) => [l.id, JSON.parse(fs.readFileSync(`src/locales/${l.id}.json`, 'utf8')) as Record<string, string>]));

  it('every language has every text the app asks for, with the same {placeholders}', () => {
    const all = texts();
    expect(all.size).toBeGreaterThan(50);
    for (const [id, cat] of Object.entries(catalogs))
      for (const s of all) {
        expect(cat[s], `${id}: "${s}"`).toBeTruthy();
        expect([...cat[s].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), `${id}: "${s}"`).toEqual([...s.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
      }
  });

  it("picks the browser's language when there is one", () => {
    expect(preferredLocale(['de-AT', 'en'])).toBe('de');
    expect(preferredLocale(['pt-BR'])).toBe('pt-BR');
    expect(preferredLocale(['pt-PT'])).toBe('pt-BR');
    expect(preferredLocale(['zh-CN', 'fr-CA'])).toBe('fr');
    expect(preferredLocale(['zh-CN'])).toBe('en');
  });

  it('translates, fills placeholders, and falls back to English', () => {
    const de = catalogs.de;
    expect(translate(de, 'New project')).toBe('Neues Projekt');
    expect(translate(de, '{n} clips', { n: 3 })).toBe('3 Clips');
    expect(translate(de, 'Not in any catalog')).toBe('Not in any catalog');
    expect(translate({}, 'New project')).toBe('New project');
  });
});
