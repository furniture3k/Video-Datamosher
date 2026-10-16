import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { osFromUserAgent, pickAsset, type ReleaseAsset } from '../src/site/os';
import { loadDocs, renderDoc, docPath, sitemap } from '../site/build';
import { ALL_EFFECTS } from '../src/engine/effects';

const asset = (name: string): ReleaseAsset => ({ name, size: 50e6, browser_download_url: 'https://example.com/' + name });
// the files a release has (as tauri-action names them)
const RELEASE = [
  'moshpit_1.6.0_x64-setup.exe',
  'moshpit_1.6.0_x64_en-US.msi',
  'moshpit_1.6.0_aarch64.dmg',
  'moshpit_1.6.0_x64.dmg',
  'moshpit_1.6.0_amd64.AppImage',
  'moshpit_1.6.0_amd64.deb',
  'moshpit-1.6.0-1.x86_64.rpm',
  'moshpit_aarch64.app.tar.gz',
  'latest.json',
].map(asset);

describe('downloads on the website', () => {
  it('recognises systems from their user agent', () => {
    expect(osFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130').os).toBe('windows');
    expect(osFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605').os).toBe('mac');
    expect(osFromUserAgent('Mozilla/5.0 (X11; Linux x86_64) Firefox/131').os).toBe('linux');
    expect(osFromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130').os).toBe('android');
    expect(osFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari').os).toBe('ios');
  });

  it('offers the installer that fits', () => {
    expect(pickAsset(RELEASE, { os: 'windows' })?.name).toBe('moshpit_1.6.0_x64-setup.exe');
    expect(pickAsset(RELEASE, { os: 'linux' })?.name).toBe('moshpit_1.6.0_amd64.AppImage');
    // unknown Mac: Apple Silicon first; a known Intel Mac gets the Intel build
    expect(pickAsset(RELEASE, { os: 'mac' })?.name).toBe('moshpit_1.6.0_aarch64.dmg');
    expect(pickAsset(RELEASE, { os: 'mac', arm: false })?.name).toBe('moshpit_1.6.0_x64.dmg');
    expect(pickAsset(RELEASE, { os: 'android' })).toBeNull();
    expect(pickAsset([], { os: 'windows' })).toBeNull();
  });

  it('lists every file for a system, and never the updater files', () => {
    const mac = RELEASE.filter((a) => pickAsset([a], { os: 'mac' }, true)).map((a) => a.name);
    expect(mac).toEqual(['moshpit_1.6.0_aarch64.dmg', 'moshpit_1.6.0_x64.dmg']);
    const linux = RELEASE.filter((a) => pickAsset([a], { os: 'linux' }, true));
    expect(linux).toHaveLength(3);
  });
});

describe('docs pages', () => {
  const docs = loadDocs();
  const paths = new Set(docs.map(docPath));

  it('every page renders, with a title and a description', () => {
    expect(docs.length).toBeGreaterThan(5);
    for (const d of docs) {
      const html = renderDoc(d, docs);
      expect(html).toContain(`<title>${d.title}`);
      expect(d.description.length).toBeGreaterThan(20);
      expect(html).not.toContain('<!-- effects -->');
    }
  });

  it('the effects page covers every effect in the app', () => {
    const html = renderDoc(docs.find((d) => d.slug === 'effects')!, docs);
    for (const e of ALL_EFFECTS) expect(html).toContain(`id="${e.type.toLowerCase()}"`);
  });

  it('links between pages go somewhere that exists', () => {
    const exists = (p: string) => paths.has(p) || paths.has(p + 'index.html') || p === '' || p === 'app/' || p.startsWith('site/') || fs.existsSync('public/' + p);
    for (const d of docs) {
      const from = docPath(d).split('/').slice(0, -1);
      const html = renderDoc(d, docs);
      for (const [, href] of html.matchAll(/href="([^"#]*)(?:#[^"]*)?"/g)) {
        if (!href || /^(https?:|data:|mailto:)/.test(href)) continue;
        // resolve against the page's folder
        const parts = [...from];
        for (const seg of href.split('/')) {
          if (seg === '..') parts.pop();
          else if (seg && seg !== '.') parts.push(seg);
        }
        const target = parts.join('/') + (href.endsWith('/') && parts.length ? '/' : '');
        expect(exists(target), `${d.slug}: ${href} → ${target}`).toBe(true);
      }
    }
  });

  it('the sitemap lists the home page, the app and every doc', () => {
    const xml = sitemap(docs);
    expect(xml.match(/<loc>/g)).toHaveLength(docs.length + 2);
  });
});
