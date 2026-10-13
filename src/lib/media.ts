import { store } from './store.svelte';
import { putFile } from './storage';
import { probeFile, generatorThumb } from './renderer';
import { GENERATORS, even } from '../engine/args';
import { uid } from '../engine/presets';
import type { Clip } from '../engine/types';

const blobToDataUrl = (url: string) =>
  url
    ? fetch(url)
        .then((r) => r.blob())
        .then((b) => new Promise<string>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.readAsDataURL(b);
        }))
        .finally(() => URL.revokeObjectURL(url))
    : Promise.resolve('');

export async function addFiles(list: FileList | File[], knownDuration?: number) {
  const files = [...list];
  for (const file of files) {
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
    const isImage = file.type.startsWith('image/') && !/gif$/i.test(file.type) && !/gif$/.test(ext);
    store.status.engine = `Reading ${file.name}…`;
    try {
      const { info, thumb } = await probeFile(file, ext);
      if (!info.hasVideo) {
        store.toast(`${file.name}: no video stream found`, 'error');
        continue;
      }
      const id = uid();
      await putFile(id, file);
      let duration = isImage ? 60 : info.duration || knownDuration || 5;
      if (!isFinite(duration) || duration <= 0) duration = knownDuration || 5;
      const clip: Clip = {
        id,
        source: { kind: 'file', fileId: id, name: file.name, mime: file.type, isImage, ext },
        duration,
        width: info.width,
        height: info.height,
        fps: info.fps,
        hasAudio: info.hasAudio,
        in: 0,
        out: isImage ? 3 : Math.min(duration, 30),
        speed: 1,
        reverse: false,
        fit: 'fit',
        thumb: await blobToDataUrl(thumb),
      };
      store.edit((p) => p.clips.push(clip));
      if (duration > 30 && !isImage) store.toast(`${file.name}: using the first 30 s. Adjust in the Clip tab.`);
      store.ui.selectedClip ??= clip.id;
    } catch (e) {
      console.error(e);
      store.toast(`Could not read ${file.name}: ${(e as Error).message}`, 'error', 6000);
    }
  }
  store.status.engine = '';
}

export async function addGenerator(genId: string, seconds = 4) {
  const g = GENERATORS.find((x) => x.id === genId)!;
  const w = 640;
  const h = even(w / (16 / 9));
  const id = uid();
  const thumb = await generatorThumb(['-f', 'lavfi', '-i', g.spec(w, h, 24)]);
  const clip: Clip = {
    id,
    source: { kind: 'generator', generator: g.id, name: g.name },
    duration: 60,
    width: w,
    height: h,
    fps: 24,
    hasAudio: false,
    in: 0,
    out: seconds,
    speed: 1,
    reverse: false,
    fit: 'fit',
    thumb: await blobToDataUrl(thumb),
  };
  store.edit((p) => p.clips.push(clip));
  store.ui.selectedClip ??= clip.id;
}

/** Two generated clips plus the Cut Transitions preset: something to look at in one click. */
export async function loadExample() {
  const { PRESETS, applyPreset } = await import('../engine/presets');
  await addGenerator('testsrc2', 3);
  await addGenerator('mandelbrot', 4);
  const snap = JSON.parse(JSON.stringify(store.project));
  store.set(applyPreset(snap, PRESETS.find((p) => p.id === 'transitions')!, store.totalFrames, store.cuts));
}
