import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/** Writes sw.js (scripts/sw.js plus the list of files to keep offline) into the build. */
function serviceWorker(): Plugin {
  let publicDir = '';
  return {
    name: 'moshpit-sw',
    apply: 'build',
    configResolved(c) {
      publicDir = c.publicDir;
    },
    generateBundle(_, bundle) {
      const files = ['./', 'index.html', ...Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html')];
      const walk = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
      let sig = files.join('|');
      for (const f of walk(publicDir)) {
        const rel = path.relative(publicDir, f).split(path.sep).join('/');
        files.push(rel);
        sig += `|${rel}:${fs.statSync(f).size}`;
      }
      let h = 0;
      for (let i = 0; i < sig.length; i++) h = (Math.imul(h, 31) + sig.charCodeAt(i)) >>> 0;
      const src = fs.readFileSync(path.resolve('scripts/sw.js'), 'utf8');
      // build time first, so the service worker can tell which older cache is the previous version
      const head = `const VERSION = '${Date.now()}-${h.toString(36)}';\nconst FILES = ${JSON.stringify(files.map((f) => (f.startsWith('./') ? f : './' + f)))};\n`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: head + src });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [svelte(), serviceWorker()],
  // the desktop app (Tauri) runs the dev server on a fixed port
  server: { port: 5173, strictPort: true },
  clearScreen: false,
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
