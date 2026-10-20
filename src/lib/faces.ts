// Faces in a picture (MediaPipe face detection), for stickers and labels that follow faces. Like
// the people model, the library and the model are downloaded on first use and cached by the
// browser; pictures never leave the device.
import type { FaceBox } from '../engine/faces';

const LIB = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite';

interface Detector {
  detect(img: TexImageSource): { detections: { boundingBox?: { originX: number; originY: number; width: number; height: number } }[] };
}

let detector: Promise<Detector> | null = null;

function load(): Promise<Detector> {
  detector ??= (async () => {
    const vision = await import(/* @vite-ignore */ `${LIB}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${LIB}/wasm`);
    const make = (delegate: 'GPU' | 'CPU') => vision.FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 });
    try {
      return await make('GPU');
    } catch {
      return await make('CPU');
    }
  })();
  detector.catch(() => (detector = null));
  return detector;
}

/** Swap the detector (tests use a fake one so they don't download a model). */
let override: ((img: HTMLCanvasElement) => Promise<FaceBox[]>) | null = null;
export function setFaceDetector(fn: typeof override) {
  override = fn;
}

/** The faces in a picture, as boxes (shares of it). */
export async function detectFaces(img: HTMLCanvasElement): Promise<FaceBox[]> {
  if (override) return override(img);
  const d = await load();
  return d.detect(img).detections.flatMap((x) => (x.boundingBox ? [{ x: x.boundingBox.originX / img.width, y: x.boundingBox.originY / img.height, w: x.boundingBox.width / img.width, h: x.boundingBox.height / img.height }] : []));
}
