// Auto captions: turn timed words (from speech recognition) into caption titles, and subtitle files.
import { FIRST_ROW, type TextLayer } from './layers';

export interface Word {
  /** seconds on the timeline */
  t0: number;
  t1: number;
  text: string;
}

export type CaptionStyle = 'clean' | 'bold' | 'karaoke' | 'melt';

export const CAPTION_STYLES: { id: CaptionStyle; name: string; hint: string }[] = [
  { id: 'clean', name: 'Clean', hint: 'White subtitles with a shadow at the bottom.' },
  { id: 'bold', name: 'Bold', hint: 'Big, upper-case words in the middle, two or three at a time (short-video style).' },
  { id: 'karaoke', name: 'Karaoke', hint: 'Each word lights up as it is spoken.' },
  { id: 'melt', name: 'Melting', hint: 'Burned into the footage before moshing, so the words smear with it.' },
];

export interface GroupOptions {
  maxChars: number;
  maxSeconds: number;
  /** a silence longer than this starts a new caption */
  gap: number;
}

/** Split words into caption lines: on sentence ends, long pauses, and length limits. */
export function groupWords(words: Word[], o: GroupOptions): Word[][] {
  const out: Word[][] = [];
  let cur: Word[] = [];
  const len = (ws: Word[]) => ws.map((w) => w.text.trim()).join(' ').length;
  for (const w of words) {
    if (!w.text.trim()) continue;
    const prev = cur.at(-1);
    const tooLong = cur.length > 0 && (len([...cur, w]) > o.maxChars || w.t1 - cur[0].t0 > o.maxSeconds);
    const pause = !!prev && w.t0 - prev.t1 > o.gap;
    if (tooLong || pause) {
      out.push(cur);
      cur = [];
    }
    cur.push(w);
    if (/[.!?…]["')\]]*$/.test(w.text.trim())) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

const tidy = (ws: Word[]) => ws.map((w) => w.text.trim()).join(' ').replace(/\s+([,.!?;:…])/g, '$1');

/** Caption titles in a style (ids from `newId`). */
export function captionTexts(words: Word[], style: CaptionStyle, newId: () => string): TextLayer[] {
  const bold = style === 'bold';
  const groups = groupWords(words, bold ? { maxChars: 16, maxSeconds: 1.6, gap: 0.4 } : { maxChars: 38, maxSeconds: 3.5, gap: 0.7 });
  return groups.map((g) => {
    const start = g[0].t0;
    const end = Math.max(g.at(-1)!.t1, start + 0.3);
    const text = tidy(g);
    return {
      id: newId(),
      kind: 'text',
      row: FIRST_ROW,
      text: bold ? text.toUpperCase() : text,
      start,
      duration: end - start,
      size: bold ? 0.09 : 0.055,
      color: '#ffffff',
      font: bold ? 'impact' : 'sans',
      bold: !bold,
      x: 0.5,
      y: bold ? 0.62 : 0.86,
      align: 'center',
      shadow: true,
      box: false,
      fade: bold ? 0 : 0.08,
      moshed: style === 'melt',
      caption: true,
      ...(style === 'karaoke' || bold ? { words: g.map((w) => ({ t0: w.t0 - start, t1: w.t1 - start, text: bold ? w.text.trim().toUpperCase() : w.text.trim() })), highlight: '#ffd23f' } : {}),
    } satisfies TextLayer;
  });
}

const stamp = (s: number, sep: ',' | '.') => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
};

/** SubRip (.srt) of caption titles. */
export function toSrt(texts: Pick<TextLayer, 'start' | 'duration' | 'text'>[]): string {
  return texts.map((t, i) => `${i + 1}\n${stamp(t.start, ',')} --> ${stamp(t.start + t.duration, ',')}\n${t.text}\n`).join('\n');
}

/** WebVTT (.vtt) of caption titles. */
export function toVtt(texts: Pick<TextLayer, 'start' | 'duration' | 'text'>[]): string {
  return 'WEBVTT\n\n' + texts.map((t) => `${stamp(t.start, '.')} --> ${stamp(t.start + t.duration, '.')}\n${t.text}\n`).join('\n');
}

/** Mono 16 kHz float samples (what speech recognition wants) from interleaved stereo 16-bit PCM at `rate`. */
export function toMono16k(pcm: Int16Array, rate = 44100): Float32Array {
  const frames = Math.floor(pcm.length / 2);
  const n = Math.floor((frames * 16000) / rate);
  const out = new Float32Array(n);
  const step = rate / 16000;
  for (let i = 0; i < n; i++) {
    // average the source samples this output sample covers (a simple anti-alias filter)
    const a = Math.floor(i * step);
    const b = Math.max(a + 1, Math.floor((i + 1) * step));
    let s = 0;
    for (let k = a; k < b && k < frames; k++) s += pcm[k * 2] + pcm[k * 2 + 1];
    out[i] = s / (2 * (b - a) * 32768);
  }
  return out;
}
