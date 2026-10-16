// Builds the website's docs pages (docs/…/index.html) from site/docs/*.md, plus sitemap.xml and
// robots.txt. Effects, transitions and shortcuts come from the app's own code, so they can't go
// out of date. Used by vite.config.ts (at build time, and served live by the dev server).
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import type { Plugin } from 'vite';
import { ALL_EFFECTS } from '../src/engine/effects';
import type { ParamDef } from '../src/engine/effects/types';
import { MOSH_TRANSITIONS, BLEND_TRANSITIONS } from '../src/engine/timeline';
import { SHORTCUTS } from '../src/lib/shortcuts';

export const SITE_URL = 'https://furniture3k.github.io/Video-Datamosher/';
const DOCS = path.resolve(__dirname, 'docs');
const MARK = 'M6 8a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v14h-4v3h-4v-5h-4v7h-4v-4H6zM13.5 9v7l6-3.5z';

interface Doc {
  slug: string;
  title: string;
  nav: string;
  description: string;
  order: number;
  body: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function frontmatter(src: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

function range(d: ParamDef): string {
  if (d.type === 'number' || d.type === 'int') return `${d.min}–${d.max}${d.unit ? ' ' + d.unit : ''} (default ${d.default}${d.unit ? ' ' + d.unit : ''})`;
  if (d.type === 'bool') return `on / off (default ${d.default ? 'on' : 'off'})`;
  if (d.type === 'select') return d.options.map((o) => o.label).join(', ');
  return 'a frame';
}

function effectsMd(): string {
  const groups: [string, typeof ALL_EFFECTS][] = [
    ['Mosh effects', ALL_EFFECTS.filter((e) => e.kind === 'bitstream')],
    ['Picture effects', ALL_EFFECTS.filter((e) => e.kind === 'pixel')],
  ];
  let md = '';
  for (const [title, list] of groups) {
    md += `\n## ${title}\n\n`;
    md += list.map((e) => `- [${e.name}](#${e.type.toLowerCase()})`).join('\n') + '\n';
    for (const e of list) {
      md += `\n<h3 id="${e.type.toLowerCase()}">${esc(e.name)}<span class="fx-code">${esc(e.icon)}</span></h3>\n\n${e.description}\n\n`;
      const params = e.params.filter((p) => !p.key.startsWith('_'));
      if (!params.length) continue;
      md += '| Setting | What it does | Values |\n|---|---|---|\n';
      for (const p of params) {
        let help = p.help;
        if (p.type === 'select') {
          const hints = p.options.filter((o) => o.hint).map((o) => `*${o.label}*: ${o.hint}`);
          if (hints.length) help += ' ' + hints.join(' ');
        }
        md += `| ${cell(p.label)}${p.advanced ? ' <span class="faint">(advanced)</span>' : ''} | ${cell(help)} | ${cell(range(p))} |\n`;
      }
    }
  }
  return md;
}

function transitionsMd(): string {
  const table = (rows: [string, { name: string; description: string }][]) => '| Transition | What it does |\n|---|---|\n' + rows.map(([, t]) => `| **${cell(t.name)}** | ${cell(t.description)} |`).join('\n') + '\n';
  return `\n## Mosh transitions\n\n${table(Object.entries(MOSH_TRANSITIONS))}\n## Classic transitions\n\n${table(Object.entries(BLEND_TRANSITIONS))}`;
}

function shortcutsMd(): string {
  const kbd = (k: string) =>
    k
      .split(/\s+(\/|or)\s+/)
      .map((part) => (part === '/' || part === 'or' ? ` ${part} ` : part.split(/\s+/).map((x) => (x === '+' ? '+' : `<kbd>${esc(x)}</kbd>`)).join(' ')))
      .join('');
  return '| Keys | Does |\n|---|---|\n' + SHORTCUTS.map(([k, d]) => `| ${kbd(k)} | ${cell(d)} |`).join('\n') + '\n';
}

export function loadDocs(): Doc[] {
  return fs
    .readdirSync(DOCS)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { meta, body } = frontmatter(fs.readFileSync(path.join(DOCS, f), 'utf8'));
      const slug = f.replace(/\.md$/, '');
      const filled = body
        .replace('<!-- effects -->', effectsMd)
        .replace('<!-- transitions -->', transitionsMd)
        .replace('<!-- shortcuts -->', shortcutsMd);
      return { slug, title: meta.title || slug, nav: meta.nav || meta.title || slug, description: meta.description || '', order: Number(meta.order ?? 99), body: filled };
    })
    .sort((a, b) => a.order - b.order);
}

/** Where a doc ends up, relative to the site root. */
export const docPath = (d: Doc) => (d.slug === 'index' ? 'docs/index.html' : `docs/${d.slug}/index.html`);
const docUrl = (d: Doc) => (d.slug === 'index' ? 'docs/' : `docs/${d.slug}/`);

export function renderDoc(d: Doc, all: Doc[]): string {
  const up = d.slug === 'index' ? '../' : '../../';
  const toc = all.map((x) => `<a href="${up}${docUrl(x)}"${x.slug === d.slug ? ' aria-current="page"' : ''}>${esc(x.nav)}</a>`).join('');
  const i = all.indexOf(d);
  const next = all[i + 1];
  const html = marked.parse(d.body, { async: false }) as string;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(d.title)} · moshpit</title>
<meta name="description" content="${esc(d.description)}" />
<link rel="canonical" href="${SITE_URL}${docUrl(d)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="moshpit" />
<meta property="og:title" content="${esc(d.title)}" />
<meta property="og:description" content="${esc(d.description)}" />
<meta property="og:url" content="${SITE_URL}${docUrl(d)}" />
<meta property="og:image" content="${SITE_URL}og.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="theme-color" content="#0b0b0d" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23121214'/><path d='${MARK}' fill='%23c8f031' fill-rule='evenodd'/></svg>" />
<link rel="stylesheet" href="${up}site/site.css" />
</head>
<body>
<header class="nav"><div class="wrap">
<a class="brand" href="${up}"><svg viewBox="4 3 24 26" aria-hidden="true"><path d="${MARK}" fill-rule="evenodd" /></svg>moshpit</a>
<a class="link" href="${up}docs/" aria-current="page">Docs</a>
<a class="link hide-s" href="https://github.com/furniture3k/Video-Datamosher">GitHub</a>
<a class="btn primary small" href="${up}app/">Open moshpit</a>
</div></header>
<div class="wrap docs">
<nav class="toc" aria-label="Docs">${toc}</nav>
<main class="prose">
${html}
${next ? `<p class="next">Next: <a href="${up}${docUrl(next)}">${esc(next.nav)} →</a></p>` : ''}
</main>
</div>
<footer class="foot"><div class="wrap"><span>moshpit · free software under the <a href="https://github.com/furniture3k/Video-Datamosher/blob/main/LICENSE">GPL-3.0</a></span><a href="${up}">Home</a><a href="https://github.com/furniture3k/Video-Datamosher">Source code</a><a href="https://github.com/furniture3k/Video-Datamosher/issues/new/choose">Report a problem</a></div></footer>
</body>
</html>
`;
}

export function sitemap(all: Doc[]): string {
  const urls = ['', 'app/', ...all.map(docUrl)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join('\n')}\n</urlset>\n`;
}

/** Vite plugin: emits the docs pages, sitemap and robots.txt, and serves the docs in dev. */
export function sitePages(): Plugin {
  return {
    name: 'moshpit-site-pages',
    generateBundle() {
      const all = loadDocs();
      for (const d of all) this.emitFile({ type: 'asset', fileName: docPath(d), source: renderDoc(d, all) });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap(all) });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n` });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/docs\/(?:([a-z0-9-]+)\/)?(?:index\.html)?(?:\?.*)?$/.exec(req.url ?? '');
        if (!m) return next();
        const all = loadDocs();
        const d = all.find((x) => x.slug === (m[1] ?? 'index'));
        if (!d) return next();
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(renderDoc(d, all));
      });
    },
  };
}
