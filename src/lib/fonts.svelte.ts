// Fonts added to a project: font files (.ttf, .otf, .woff, .woff2) and Google Fonts, kept with the
// media and loaded into the page so titles can be drawn in them (preview, exports and titles
// that melt alike). Google Fonts are remembered by name and fetched again where the file is missing.
import { store } from './store.svelte';
import { getFile, putFile } from './storage';
import { uid } from '../engine/presets';
import { fontId, type BuiltinFont } from '../engine/layers';
import { latinUrl } from '../engine/fonts';
import type { FontRef, Project } from '../engine/types';

export const fontKey = (id: string) => 'font:' + id;
/** the family name a font is loaded under */
export const fontFamily = (id: string) => 'mp-' + id;

/** bumped when a font finishes loading (the preview redraws) */
export const fontState = $state({ loaded: 0 });

const loading = new Map<string, Promise<boolean>>();
const ready = new Set<string>();
/** when a font last failed to load: the preview asks on every frame, so it is tried again only now and then (offline, say) */
const failedAt = new Map<string, number>();
const RETRY_MS = 30000;

/** Swap the network fetch (tests use a fake one: they run without the internet). */
let fetcher: (url: string) => Promise<Response> = (url) => fetch(url);
export function setFontFetcher(fn: ((url: string) => Promise<Response>) | null) {
  fetcher = fn ?? ((url) => fetch(url));
}

async function install(id: string, data: ArrayBuffer) {
  const face = new FontFace(fontFamily(id), data);
  await face.load();
  document.fonts.add(face);
  ready.add(id);
  fontState.loaded++;
}

/** The file of a Google Fonts family (its Latin letters), as Google serves it. */
async function googleFile(family: string): Promise<Blob> {
  const css = await (await fetcher(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`)).text();
  const url = latinUrl(css);
  if (!url) throw new Error(`Google Fonts has no family called “${family}”.`);
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`Could not download “${family}” (${res.status}).`);
  return res.blob();
}

/** Load an added font into the page (from its file, or Google Fonts if the file is missing). */
export function loadFont(f: FontRef): Promise<boolean> {
  if (ready.has(f.id)) return Promise.resolve(true);
  let p = loading.get(f.id);
  if (!p) {
    p = (async () => {
      let blob = await getFile(fontKey(f.id));
      if (!blob && f.google) {
        blob = await googleFile(f.google);
        await putFile(fontKey(f.id), blob);
      }
      if (!blob) return false;
      await install(f.id, await blob.arrayBuffer());
      return true;
    })().catch((e) => {
      console.warn('font not loaded', f.name, e);
      return false;
    });
    loading.set(f.id, p);
    p.then((ok) => {
      if (ok) return failedAt.delete(f.id);
      loading.delete(f.id);
      failedAt.set(f.id, performance.now());
    });
  }
  return p;
}

/** Load every font the project's titles use (before drawing them into an export). */
export async function ensureFonts(p: Pick<Project, 'fonts' | 'layers'>): Promise<void> {
  const used = new Set(p.layers.flatMap((l) => (l.kind === 'text' ? [fontId(l.font)] : [])).filter((x): x is string => !!x));
  await Promise.all((p.fonts ?? []).filter((f) => used.has(f.id)).map(loadFont));
}

/** CSS for a title's font: a built-in stack, or an added font (loading it if it isn't yet). */
export function fontCss(font: string, builtin: Record<BuiltinFont, string>): string {
  const id = fontId(font);
  if (!id) return builtin[font as BuiltinFont] ?? builtin.sans;
  if (!ready.has(id)) {
    const f = store.project.fonts?.find((x) => x.id === id);
    const failed = failedAt.get(id);
    if (f && (failed === undefined || performance.now() - failed > RETRY_MS)) loadFont(f);
  }
  return `'${fontFamily(id)}', ${builtin.sans}`;
}

function addRef(ref: FontRef) {
  store.edit((p) => (p.fonts = [...(p.fonts ?? []).filter((f) => f.id !== ref.id), ref]));
}

/** Add font files to the project. Returns their refs. */
export async function importFonts(files: File[]): Promise<FontRef[]> {
  const out: FontRef[] = [];
  for (const f of files) {
    try {
      const id = uid();
      await install(id, await f.arrayBuffer());
      await putFile(fontKey(id), f);
      const ref = { id, name: f.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_]+/g, ' ') };
      addRef(ref);
      out.push(ref);
    } catch {
      store.toast(`${f.name} isn't a font this browser can read (try .ttf, .otf, .woff or .woff2).`, 'error', 6000);
    }
  }
  return out;
}

/** Add a Google Fonts family to the project (or find it if it's there already). */
export async function addGoogleFont(family: string): Promise<FontRef> {
  family = family.trim();
  const have = store.project.fonts?.find((f) => f.google?.toLowerCase() === family.toLowerCase());
  if (have) return have;
  const blob = await googleFile(family);
  const id = uid();
  await install(id, await blob.arrayBuffer());
  await putFile(fontKey(id), blob);
  const ref = { id, name: family, google: family };
  addRef(ref);
  return ref;
}

/**
 * Open-licence (OFL) Google Fonts that suit the edits moshpit is for: condensed slams, posters,
 * calligraphy, handwriting, typewriters and pixel fonts.
 */
export const GOOGLE_FONTS: { family: string; kind: string }[] = [
  { family: 'Anton', kind: 'Condensed' },
  { family: 'Bebas Neue', kind: 'Condensed' },
  { family: 'Oswald', kind: 'Condensed' },
  { family: 'League Gothic', kind: 'Condensed' },
  { family: 'Six Caps', kind: 'Condensed' },
  { family: 'Barlow Condensed', kind: 'Condensed' },
  { family: 'Big Shoulders Display', kind: 'Condensed' },
  { family: 'Teko', kind: 'Condensed' },
  { family: 'Archivo Black', kind: 'Heavy' },
  { family: 'Rubik Mono One', kind: 'Heavy' },
  { family: 'Bungee', kind: 'Heavy' },
  { family: 'Unbounded', kind: 'Wide' },
  { family: 'Syne', kind: 'Wide' },
  { family: 'Inter', kind: 'Clean' },
  { family: 'Montserrat', kind: 'Clean' },
  { family: 'Poppins', kind: 'Clean' },
  { family: 'Space Grotesk', kind: 'Clean' },
  { family: 'Playfair Display', kind: 'Serif' },
  { family: 'DM Serif Display', kind: 'Serif' },
  { family: 'Abril Fatface', kind: 'Serif' },
  { family: 'Cormorant Garamond', kind: 'Serif' },
  { family: 'IM Fell English', kind: 'Serif' },
  { family: 'Pinyon Script', kind: 'Calligraphy' },
  { family: 'Great Vibes', kind: 'Calligraphy' },
  { family: 'Dancing Script', kind: 'Calligraphy' },
  { family: 'UnifrakturMaguntia', kind: 'Blackletter' },
  { family: 'Pirata One', kind: 'Blackletter' },
  { family: 'Permanent Marker', kind: 'Handwriting' },
  { family: 'Caveat', kind: 'Handwriting' },
  { family: 'Rock Salt', kind: 'Handwriting' },
  { family: 'Courier Prime', kind: 'Typewriter' },
  { family: 'Space Mono', kind: 'Typewriter' },
  { family: 'IBM Plex Mono', kind: 'Typewriter' },
  { family: 'VT323', kind: 'Pixel' },
  { family: 'Press Start 2P', kind: 'Pixel' },
  { family: 'Silkscreen', kind: 'Pixel' },
  { family: 'Monoton', kind: 'Display' },
  { family: 'Righteous', kind: 'Display' },
];
