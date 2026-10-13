import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

export function ff(cwd: string, args: string[]): string {
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
