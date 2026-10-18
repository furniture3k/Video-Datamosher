// Auto captions: listen to the timeline (Whisper, on the device) and turn the words into titles.
import { store } from './store.svelte';
import { sourcePcm } from './renderer';
import { download } from './storage';
import { captionTexts, toMono16k, toSrt, toVtt, type CaptionStyle, type Word } from '../engine/captions';
import { uid } from '../engine/presets';
import type { Project } from '../engine/types';

export const captionJob = $state({ running: false, stage: '', progress: 0, error: '' });

export interface TranscribeOptions {
  model: string;
  /** '' = detect */
  language: string;
}

export type Transcriber = (audio: Float32Array, o: TranscribeOptions) => Promise<Word[]>;

export const MODELS = [
  { id: 'Xenova/whisper-tiny.en', name: 'Tiny, English (≈40 MB, fastest)' },
  { id: 'Xenova/whisper-base.en', name: 'Base, English (≈80 MB, better)' },
  { id: 'Xenova/whisper-tiny', name: 'Tiny, any language (≈40 MB)' },
  { id: 'Xenova/whisper-base', name: 'Base, any language (≈80 MB)' },
];

let worker: Worker | null = null;

/** Whisper in a worker. */
const whisper: Transcriber = (audio, o) =>
  new Promise((resolve, reject) => {
    worker ??= new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'stage') ((captionJob.stage = m.stage), (captionJob.progress = 0));
      else if (m.type === 'progress') captionJob.progress = m.progress;
      else if (m.type === 'done') resolve(m.words);
      else if (m.type === 'error') reject(new Error(m.message));
    };
    worker.onerror = (e) => {
      // a worker that failed to start stays broken: the next try starts a new one
      worker?.terminate();
      worker = null;
      reject(new Error(e.message || 'The speech model could not start.'));
    };
    worker.postMessage({ audio, model: o.model, language: o.language });
  });

let transcriber: Transcriber = whisper;
/** Swap the recogniser (tests use a fake one so they don't download a model). */
export function setTranscriber(fn: Transcriber | null) {
  transcriber = fn ?? whisper;
}

/** Words spoken in a source ('mix' or an audio track id), on the timeline's clock. */
export async function transcribe(source: string, o: TranscribeOptions): Promise<Word[]> {
  captionJob.running = true;
  captionJob.error = '';
  captionJob.stage = 'Mixing the sound';
  captionJob.progress = 0;
  try {
    const pcm = await sourcePcm($state.snapshot(store.project) as Project, source);
    if (!pcm) throw new Error('There is no sound to listen to on that track.');
    return await transcriber(toMono16k(pcm), o);
  } catch (e) {
    captionJob.error = (e as Error).message;
    throw e;
  } finally {
    captionJob.running = false;
  }
}

/** Put caption titles on the timeline (one undo step); `replace` removes earlier captions first. */
export function applyCaptions(words: Word[], style: CaptionStyle, replace: boolean): number {
  const texts = captionTexts(words, style, uid);
  store.edit((p) => {
    if (replace) p.layers = p.layers.filter((t) => !t.caption);
    p.layers.push(...texts);
  });
  return texts.length;
}

/** Download the captions as subtitles. */
export function downloadSubtitles(kind: 'srt' | 'vtt') {
  const caps = store.project.layers.filter((t) => t.caption).sort((a, b) => a.start - b.start);
  const text = kind === 'srt' ? toSrt(caps) : toVtt(caps);
  download(new Blob([text], { type: 'text/plain' }), `${(store.project.name || 'captions').replace(/[^\w-]+/g, '_')}.${kind}`);
}
