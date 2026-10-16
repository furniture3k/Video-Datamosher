import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { sitePages } from './site/build';

// The site has two parts: the website (index.html at the root, and the docs) and the editor
// (app/index.html). Each page is its own entry, so the website never loads the editor's code.
const PAGES = { site: 'index.html', app: 'app/index.html' };

/** Writes app/sw.js (scripts/sw.js plus the editor's files to keep offline). */
function serviceWorker(): Plugin {
  let publicDir = '';
  return {
    name: 'moshpit-sw',
    apply: 'build',
    configResolved(c) {
      publicDir = c.publicDir;
    },
    generateBundle(_, bundle) {
      // the editor's files only: not the website's page, script and style, nor the docs
      const siteOnly = (f: string) => f.endsWith('.html') || f.startsWith('docs/') || /^assets\/site-/.test(f) || f === 'sitemap.xml' || f === 'robots.txt';
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map') && !siteOnly(f));
      // relative to the service worker in app/
      const files = ['./', 'index.html', ...built.map((f) => '../' + f)];
      const appPublic = path.join(publicDir, 'app');
      const walk = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
      let sig = files.join('|');
      for (const f of walk(appPublic)) {
        const rel = path.relative(appPublic, f).split(path.sep).join('/');
        // the multithreaded engine is kept once it's first used (only some browsers can run it)
        if (rel.startsWith('ffmpeg-mt/')) continue;
        files.push(rel);
        sig += `|${rel}:${fs.statSync(f).size}`;
      }
      let h = 0;
      for (let i = 0; i < sig.length; i++) h = (Math.imul(h, 31) + sig.charCodeAt(i)) >>> 0;
      const src = fs.readFileSync(path.resolve('scripts/sw.js'), 'utf8');
      // build time first, so the service worker can tell which older cache is the previous version
      const mt = JSON.parse(fs.readFileSync(path.resolve('node_modules/@ffmpeg/core-mt/package.json'), 'utf8')).version;
      const head = `const VERSION = '${Date.now()}-${h.toString(36)}';\nconst MT_VERSION = '${mt}';\nconst FILES = ${JSON.stringify(files.map((f) => (f.startsWith('.') ? f : './' + f)))};\n`;
      this.emitFile({ type: 'asset', fileName: 'app/sw.js', source: head + src });
    },
  };
}

/** The desktop app has a native FFmpeg: its build leaves out the browser's video engines (~60 MB). */
function desktopOnly(): Plugin {
  let outDir = '';
  return {
    name: 'moshpit-desktop',
    apply: (_, env) => env.command === 'build' && env.mode === 'desktop',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      for (const d of ['ffmpeg', 'ffmpeg-mt']) fs.rmSync(path.join(outDir, 'app', d), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [svelte(), serviceWorker(), sitePages(), desktopOnly()],
  // the desktop app (Tauri) runs the dev server on a fixed port
  server: { port: 5173, strictPort: true },
  clearScreen: false,
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: Object.fromEntries(Object.entries(PAGES).map(([k, f]) => [k, path.resolve(__dirname, f)])) },
  },
});
