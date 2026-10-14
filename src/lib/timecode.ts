// Timecode formatting and parsing (HH:MM:SS:FF, like an editing suite).

const p2 = (x: number) => String(x).padStart(2, '0');

/** HH:MM:SS:FF for timeline time t at fps. */
export function tc(t: number, fps: number): string {
  const f = Math.max(0, Math.round(t * fps));
  const secs = Math.floor(f / fps);
  return `${p2(Math.floor(secs / 3600))}:${p2(Math.floor(secs / 60) % 60)}:${p2(secs % 60)}:${p2(f % fps)}`;
}

/**
 * A typed time in seconds, or null. Accepts HH:MM:SS:FF, MM:SS:FF-style colon groups (the last
 * group is frames when there are four, seconds otherwise), plain seconds ("12.5"), frames with an
 * "f" ("40f"), and a leading + or - to move relative to `now`.
 */
export function parseTimecode(v: string, fps: number, now = 0): number | null {
  const m = /^([+-])?\s*(.+)$/.exec(v.trim());
  if (!m) return null;
  const body = m[2].trim();
  let t: number | null = null;
  if (/^\d+(\.\d+)?f$/i.test(body)) t = parseFloat(body) / fps;
  else if (/^\d+(\.\d+)?$/.test(body)) t = parseFloat(body);
  else if (/^\d+([:;.]\d+){1,3}$/.test(body)) {
    const g = body.split(/[:;.]/).map(Number);
    if (g.length === 4) t = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / fps;
    else if (g.length === 3) t = g[0] * 3600 + g[1] * 60 + g[2];
    else t = g[0] * 60 + g[1];
  }
  if (t === null || !isFinite(t)) return null;
  if (m[1] === '+') return now + t;
  if (m[1] === '-') return Math.max(0, now - t);
  return t;
}
