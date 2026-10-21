// Export presets for the places people post: size, shape, length and file-size limits.
import type { ExportOptions } from './args';
import type { Aspect } from './types';

export interface SocialPreset {
  id: string;
  name: string;
  /** shape the platform wants (null: any) */
  aspect: Aspect | null;
  /** export settings it sets */
  opts: Partial<ExportOptions>;
  /** longest video the platform takes, seconds */
  maxSec?: number;
  /** largest file it takes, MB (the encoder aims under it) */
  maxMB?: number;
  /** what the safe-zone guides show: where the app's buttons and captions cover the picture */
  guides?: 'vertical' | 'feed';
  note: string;
}

export const SOCIAL_PRESETS: SocialPreset[] = [
  { id: 'vertical', name: 'TikTok · Reels · Shorts', aspect: '9:16', opts: { format: 'mp4', width: 1080, crf: 18, preset: 'medium' }, maxSec: 180, guides: 'vertical', note: '1080×1920. Keep text inside the guides: the apps cover the bottom and right edges.' },
  { id: 'vertical4k', name: 'TikTok · Shorts 4K', aspect: '9:16', opts: { format: 'mp4', width: 2160, crf: 16, preset: 'medium', scaler: 'lanczos' }, maxSec: 180, guides: 'vertical', note: '2160×3840. Shorts and TikTok keep more detail from a 4K upload; Instagram shows Reels at 1080×1920 either way.' },
  { id: 'igfeed', name: 'Instagram feed', aspect: '4:5', opts: { format: 'mp4', width: 1080, crf: 18, preset: 'medium' }, maxSec: 3600, guides: 'feed', note: '1080×1350, the tallest a feed post shows.' },
  { id: 'square', name: 'Square', aspect: '1:1', opts: { format: 'mp4', width: 1080, crf: 18, preset: 'medium' }, note: '1080×1080. Works everywhere.' },
  { id: 'yt', name: 'YouTube 1080p', aspect: '16:9', opts: { format: 'mp4', width: 1920, crf: 16, preset: 'medium' }, note: 'Full HD with headroom for YouTube\'s re-encode.' },
  { id: 'yt4k', name: 'YouTube 4K', aspect: '16:9', opts: { format: 'mp4', width: 3840, crf: 16, preset: 'medium', scaler: 'lanczos' }, note: 'Upscaled 4K gets a better bitrate from YouTube, so the mosh survives its compression.' },
  { id: 'x', name: 'X / Twitter', aspect: null, opts: { format: 'mp4', width: 1280, crf: 20, preset: 'medium' }, maxSec: 140, maxMB: 512, note: '720p, up to 2:20.' },
  { id: 'discord', name: 'Discord (10 MB)', aspect: null, opts: { format: 'mp4', width: 1280, preset: 'medium' }, maxMB: 10, note: 'Aims just under the 10 MB upload limit.' },
  { id: 'gifchat', name: 'GIF for chats', aspect: null, opts: { format: 'gif', width: 480, gifFps: 15, gifColors: 128, gifDither: 'bayer' }, maxMB: 10, note: '480px, 15 fps. Short clips stay under 10 MB.' },
];

export const AUDIO_KBPS_SIZED = 128;

/**
 * Video bitrate (kbit/s) that keeps a `seconds`-long file under `maxMB`, leaving room for the
 * sound and the container. 0 when there's no limit.
 */
export function bitrateFor(maxMB: number | undefined, seconds: number, audio: boolean): number {
  if (!maxMB || seconds <= 0) return 0;
  const totalKbits = maxMB * 8 * 1024 * 0.94; // 6% for container overhead and rate wobble
  const kbps = totalKbits / seconds - (audio ? AUDIO_KBPS_SIZED : 0);
  return Math.max(150, Math.floor(kbps));
}

/** Width × height that an aspect gives at a width, both even. */
export function aspectSize(aspect: Aspect, width: number): { w: number; h: number } | null {
  const m = /^(\d+):(\d+)$/.exec(aspect);
  if (!m) return null;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { w: even(width), h: even((width * +m[2]) / +m[1]) };
}

/** Resolution classes by the frame's short side (the "p" in 1080p). */
const CLASSES: [number, string][] = [
  [180, ''],
  [270, ''],
  [360, '360p'],
  [480, '480p'],
  [540, ''],
  [720, '720p HD'],
  [1080, '1080p Full HD'],
  [1440, '1440p QHD'],
  [2160, '4K UHD'],
];

/**
 * Widths to offer for a frame of this shape (width / height), labelled with the size they make:
 * 1080p is 1920 wide for 16:9 and 1080 wide for 9:16. From `min` short side up; `current` is kept
 * in the list when it isn't one of them.
 */
export function sizeChoices(ar: number, min = 0, current = 0): { value: number; label: string }[] {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const a = ar > 0 && isFinite(ar) ? ar : 16 / 9;
  const at = (w: number) => `${w}×${even(w / a)}`;
  const out = CLASSES.filter(([s]) => s >= min).map(([s, name]) => {
    const w = even(a >= 1 ? s * a : s);
    return { value: w, label: name ? `${name} (${at(w)})` : at(w) };
  });
  if (current > 0 && !out.some((o) => o.value === even(current))) out.push({ value: current, label: at(even(current)) });
  return out.sort((x, y) => x.value - y.value);
}

/**
 * The width that keeps a frame's resolution class (its short side) when its shape changes from
 * `fromAr` to `toAr` (width / height): 720p is 1280 wide at 16:9 and 720 wide at 9:16.
 */
export function widthForShape(width: number, fromAr: number, toAr: number): number {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (!(fromAr > 0) || !(toAr > 0)) return width;
  const short = fromAr >= 1 ? width / fromAr : width;
  return even(toAr >= 1 ? short * toAr : short);
}
