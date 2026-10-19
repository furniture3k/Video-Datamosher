// Bake: render the mosh to a video file and bring it back as media, to cut, re-mosh or melt again.
import { store } from './store.svelte';
import { exportVideo, type Progress, type Signal } from './renderer';
import { addFiles } from './media';
import { readEngineFile, removeEngineFile } from './ffmpeg-native';
import { takeSnapshot } from './snapshots.svelte';
import { defaultExport } from '../engine/args';
import { makeClip } from '../engine/timeline';
import { CLIP_AUDIO, VIDEO_TRACK, type MediaItem, type Project } from '../engine/types';

/**
 * Render the whole mosh (with its sound) to an MP4 and add it to the media library.
 * `replace`: the baked clip then takes the place of the video tracks and the effect stack.
 */
export async function bakeToClip(replace: boolean, progress: Progress, signal: Signal): Promise<MediaItem | null> {
  const p = $state.snapshot(store.project) as Project;
  const r = await exportVideo(p, { ...defaultExport(), format: 'mp4', crf: 12, preset: 'veryfast', width: 0, audio: true }, progress, signal);
  let blob = r.blob;
  if (!blob && r.file) {
    blob = await readEngineFile(r.file, 'video/mp4');
    removeEngineFile(r.file);
  }
  if (!blob) return null;
  const name = `${(p.name || 'mosh').replace(/[^\w-]+/g, '_')}_baked.mp4`;
  // the bake carries this project's recipe: don't offer to apply it back onto the project
  const [m] = await addFiles([new File([blob], name, { type: 'video/mp4' })], 'none', undefined, { recipes: false });
  if (!m) return null;
  if (replace) {
    await takeSnapshot('Before baking', true);
    store.edit((q) => {
      // the baked file holds the picture and the whole mixed sound, so every old clip goes
      q.clips = [makeClip(m, VIDEO_TRACK, { muted: false })];
      q.effects = [];
      // every title is in the baked picture already (melting ones in the mosh, the rest drawn on)
      q.layers = [];
      q.tracks = q.tracks.filter((t) => t.kind === 'audio' || t.id === VIDEO_TRACK).map((t) => (t.id === CLIP_AUDIO ? { ...t, muted: false } : t));
    });
  }
  return m;
}
