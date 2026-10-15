// Recipes: the effect stack, automation, seeds and encoder settings as a short text code
// ("MOSH:…"). Used by share codes and embedded in exported videos so any export can be remixed.
import type { Project } from './types';

export const RECIPE_PREFIX = 'MOSH:';

/** Positions are stored as a share of the timeline so a recipe fits any length of footage. */
export function recipePayload(p: Project, total: number) {
  total = Math.max(1, total);
  return {
    v: 1,
    t: total,
    enc: { ...p.encoder, keyMarkers: p.encoder.keyMarkers.map((m) => m / total) },
    dec: p.decoder,
    au: p.audio,
    seed: p.globalSeed,
    ...(p.chaos !== undefined && p.chaos !== 1 ? { chaos: p.chaos } : {}),
    fx: p.effects.map((e) => ({ ...e, start: e.start / total, end: e.end / total, params: e.type === 'splice' ? { ...e.params, from: Number(e.params.from) / total } : e.params })),
  };
}
export type Recipe = ReturnType<typeof recipePayload>;

/** Apply a recipe to a project whose timeline is `total` frames long. */
export function applyRecipe(p: Project, data: Recipe, total: number): Project {
  total = Math.max(1, total);
  const R = (x: number) => Math.round(x * total);
  type Fx = Project['effects'][number];
  const { source: _s, clipId: _c, ...au } = (data.au ?? {}) as Project['audio'] & { source?: unknown; clipId?: unknown };
  const out: Project = {
    ...p,
    encoder: { ...p.encoder, ...data.enc, keyMarkers: (data.enc?.keyMarkers ?? []).map(R) },
    decoder: { ...p.decoder, ...data.dec },
    audio: { ...p.audio, ...au },
    globalSeed: data.seed ?? p.globalSeed,
    effects: ((data.fx ?? []) as Fx[]).map((e) => ({ ...e, start: R(e.start), end: Math.max(R(e.start) + 1, R(e.end)), params: e.type === 'splice' ? { ...e.params, from: R(Number(e.params.from)) } : e.params })),
  };
  if (data.chaos !== undefined) out.chaos = data.chaos;
  else delete out.chaos;
  return out;
}

function toBase64Url(buf: Uint8Array): string {
  let bin = '';
  buf.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function encodeRecipe(p: Project, total: number): Promise<string> {
  const cs = new Blob([JSON.stringify(recipePayload(p, total))]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return RECIPE_PREFIX + toBase64Url(new Uint8Array(await new Response(cs).arrayBuffer()));
}

export async function decodeRecipe(code: string): Promise<Recipe> {
  const ds = new Blob([fromBase64Url(code.trim().replace(/^MOSH:/, '')) as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const data = JSON.parse(await new Response(ds).text());
  if (!data || typeof data !== 'object' || !Array.isArray(data.fx)) throw new Error('not a moshpit recipe');
  return data;
}

/** A recipe code inside some text (ffmpeg's log of a file's metadata, a GIF comment…). */
export function findRecipe(text: string): string | null {
  const m = /MOSH:[A-Za-z0-9_-]{8,}/.exec(text);
  return m ? m[0] : null;
}

// ---------- GIF comments ----------

/** Insert a Comment Extension holding `text` after the GIF's header and global colour table. */
export function gifWithComment(gif: Uint8Array, text: string): Uint8Array {
  if (gif.length < 13 || String.fromCharCode(...gif.subarray(0, 3)) !== 'GIF') return gif;
  const flags = gif[10];
  const at = 13 + (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0);
  const bytes = new TextEncoder().encode(text);
  const blocks: number[] = [0x21, 0xfe];
  for (let i = 0; i < bytes.length; i += 255) {
    const part = bytes.subarray(i, i + 255);
    blocks.push(part.length, ...part);
  }
  blocks.push(0);
  const out = new Uint8Array(gif.length + blocks.length);
  out.set(gif.subarray(0, at));
  out.set(blocks, at);
  out.set(gif.subarray(at), at + blocks.length);
  return out;
}

/** Text of every Comment Extension in a GIF (walks the block structure). */
export function gifComments(gif: Uint8Array): string[] {
  const out: string[] = [];
  if (gif.length < 13 || String.fromCharCode(...gif.subarray(0, 3)) !== 'GIF') return out;
  const flags = gif[10];
  let i = 13 + (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0);
  const skipBlocks = () => {
    while (i < gif.length && gif[i] !== 0) i += gif[i] + 1;
    i++;
  };
  while (i < gif.length) {
    const b = gif[i];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = gif[i + 1];
      i += 2;
      if (label === 0xfe) {
        const parts: number[] = [];
        while (i < gif.length && gif[i] !== 0) {
          parts.push(...gif.subarray(i + 1, i + 1 + gif[i]));
          i += gif[i] + 1;
        }
        i++;
        out.push(new TextDecoder().decode(new Uint8Array(parts)));
      } else skipBlocks();
    } else if (b === 0x2c) {
      const lf = gif[i + 9];
      i += 10 + (lf & 0x80 ? 3 * (1 << ((lf & 7) + 1)) : 0);
      i++; // LZW minimum code size
      skipBlocks();
    } else break;
  }
  return out;
}
