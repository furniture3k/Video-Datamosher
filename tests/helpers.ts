import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpegMajor, graphsToFiles } from '../src/engine/args';

export const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

export function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mosh-'));
}

let major = -1;
export function ff(cwd: string, args: string[]): string {
  // long filter graphs go in files, as the desktop app does (a command line has a length limit)
  if (major < 0) major = ffmpegMajor(execFileSync('ffmpeg', ['-version']).toString().split('\n')[0]) || 99;
  const graphs = graphsToFiles(args, major);
  for (const [name, text] of graphs.files) fs.writeFileSync(path.join(cwd, name), text);
  args = graphs.args;
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).toString();
  } catch (e) {
    const err = e as { stderr?: Buffer };
    throw new Error(`ffmpeg failed: ${args.join(' ')}\n${err.stderr?.toString().slice(-3000)}`);
  }
}

export function ffLog(cwd: string, args: string[]): string {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    return '';
  } catch (e) {
    return (e as { stderr?: Buffer }).stderr?.toString() ?? '';
  }
}

/** Split concatenated JPEGs */
export function splitJpegs(b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i + 2 < b.length; i++) if (b[i] === 0xff && b[i + 1] === 0xd8 && b[i + 2] === 0xff) n++;
  return n;
}

import type { Clip, MediaItem } from '../src/engine/types';
import { inputName } from '../src/engine/args';

export function fileMedia(id: string, ext: string, extra: Partial<MediaItem> = {}): MediaItem {
  const isImage = ext === 'png' || ext === 'jpg';
  return { id, source: { kind: 'file', fileId: id, name: id, mime: '', isImage, ext }, duration: isImage ? 3600 : 2, width: 320, height: 240, fps: 25, hasAudio: ext === 'mp4' || ext === 'wav', hasVideo: ext !== 'wav', ...extra };
}

export function clipOf(m: MediaItem, extra: Partial<Clip> = {}): Clip {
  return { id: m.id + Math.random().toString(36).slice(2, 6), mediaId: m.id, track: 'v1', start: 0, in: 0, out: Math.min(m.duration, 2), speed: 1, reverse: false, fit: 'fit', volume: 1, muted: false, fadeIn: 0, fadeOut: 0, ...extra };
}

/** Copy a source file into dir under the media's ffmpeg input name. */
export function place(dir: string, file: string, m: MediaItem) {
  fs.copyFileSync(path.join(dir, file), path.join(dir, inputName(m)));
}
