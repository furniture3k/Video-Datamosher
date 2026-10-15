// People in a picture (MediaPipe selfie segmentation), for Subject Guard. The library and the
// model are downloaded on first use and cached by the browser; pictures never leave the device.

const LIB = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

interface MPMask {
  width: number;
  height: number;
  getAsFloat32Array(): Float32Array;
}
interface Segmenter {
  segment(img: TexImageSource): { confidenceMasks?: MPMask[]; close(): void };
}

let segmenter: Promise<Segmenter> | null = null;

function load(): Promise<Segmenter> {
  segmenter ??= (async () => {
    const vision = await import(/* @vite-ignore */ `${LIB}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${LIB}/wasm`);
    const make = (delegate: 'GPU' | 'CPU') =>
      vision.ImageSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true });
    try {
      return await make('GPU');
    } catch {
      return await make('CPU');
    }
  })();
  segmenter.catch(() => (segmenter = null));
  return segmenter;
}

/** Swap the segmenter (tests use a fake one so they don't download a model). */
let override: ((img: ImageBitmap) => Promise<HTMLCanvasElement>) | null = null;
export function setPersonSegmenter(fn: typeof override) {
  override = fn;
}

/**
 * How likely each pixel is part of a person, as a grayscale canvas (white = person) the size of
 * the model's output; drawn the same way up as the picture.
 */
export async function personMask(img: ImageBitmap): Promise<HTMLCanvasElement> {
  if (override) return override(img);
  const s = await load();
  const res = s.segment(img);
  try {
    const masks = res.confidenceMasks ?? [];
    // one mask: person; two: background, person
    const m = masks[masks.length - 1];
    if (!m) throw new Error('The people model returned nothing.');
    const data = m.getAsFloat32Array();
    const c = document.createElement('canvas');
    c.width = m.width;
    c.height = m.height;
    const ctx = c.getContext('2d')!;
    const id = ctx.createImageData(m.width, m.height);
    for (let i = 0; i < data.length; i++) {
      const v = Math.round(Math.max(0, Math.min(1, data[i])) * 255);
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
      id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  } finally {
    res.close();
  }
}
