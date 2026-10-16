// Batch: the same mosh on many videos. Each video gets a project of its own (the video on the
// timeline, the recipe fitted to its length) and goes into the export queue.
import { readMedia } from './media';
import { enqueue } from './exportqueue.svelte';
import { batchProject, type Recipe } from '../engine/recipe';
import type { ExportOptions } from '../engine/args';

/**
 * Read each file and queue its export. Returns how many were queued; files without a picture are
 * skipped (and named in `skipped`).
 */
export async function batchExport(files: File[], recipe: Recipe, o: ExportOptions, opts: { keepShape?: boolean; onStatus?: (s: string) => void } = {}): Promise<{ queued: number; skipped: string[] }> {
  let queued = 0;
  const skipped: string[] = [];
  for (const [i, f] of files.entries()) {
    opts.onStatus?.(`Reading ${f.name} (${i + 1} of ${files.length})…`);
    try {
      const r = await readMedia(f);
      if (!r || !r.m.hasVideo) {
        skipped.push(f.name);
        continue;
      }
      enqueue(batchProject(r.m, recipe, opts.keepShape ?? true), { ...o, range: null });
      queued++;
    } catch (e) {
      console.warn('batch', f.name, e);
      skipped.push(f.name);
    }
  }
  opts.onStatus?.('');
  return { queued, skipped };
}
