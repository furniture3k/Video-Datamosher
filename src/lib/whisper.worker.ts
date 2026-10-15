// Speech recognition (Whisper, via transformers.js) in a worker so the editor stays responsive.
// The library and the model are downloaded on first use and cached by the browser; the sound
// never leaves the device.

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

type Word = { t0: number; t1: number; text: string };
type Chunk = { text: string; timestamp: [number, number | null] };

let asr: ((audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: Chunk[] }>) | null = null;
let loadedModel = '';

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

/** Segment-level chunks (no word timings): spread each segment's words evenly over it. */
function spread(chunks: Chunk[]): Word[] {
  const out: Word[] = [];
  for (const c of chunks) {
    const [a, b] = c.timestamp;
    const end = b ?? a + 2;
    const words = c.text.trim().split(/\s+/).filter(Boolean);
    const total = words.reduce((s, w) => s + w.length + 1, 0);
    let t = a;
    for (const w of words) {
      const d = ((end - a) * (w.length + 1)) / total;
      out.push({ t0: t, t1: t + d, text: w });
      t += d;
    }
  }
  return out;
}

self.onmessage = async (e: MessageEvent<{ audio: Float32Array; model: string; language: string }>) => {
  const { audio, model, language } = e.data;
  try {
    const T = await import(/* @vite-ignore */ LIB);
    if (!asr || loadedModel !== model) {
      post({ type: 'stage', stage: 'Downloading the speech model' });
      asr = await T.pipeline('automatic-speech-recognition', model, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p: { status: string; progress?: number }) => p.status === 'progress' && post({ type: 'progress', progress: (p.progress ?? 0) / 100 }),
      });
      loadedModel = model;
    }
    post({ type: 'stage', stage: 'Listening' });
    const multilingual = !model.endsWith('.en');
    const opts = { chunk_length_s: 30, stride_length_s: 5, ...(multilingual && language ? { language, task: 'transcribe' } : {}) };
    let words: Word[];
    try {
      const out = await asr!(audio, { ...opts, return_timestamps: 'word' });
      words = (out.chunks ?? []).map((c) => ({ t0: c.timestamp[0], t1: c.timestamp[1] ?? c.timestamp[0] + 0.3, text: c.text.trim() }));
    } catch {
      // some models can't time single words: fall back to sentences
      const out = await asr!(audio, { ...opts, return_timestamps: true });
      words = spread(out.chunks ?? []);
    }
    post({ type: 'done', words: words.filter((w) => w.text) });
  } catch (err) {
    post({ type: 'error', message: (err as Error)?.message ?? String(err) });
  }
};
