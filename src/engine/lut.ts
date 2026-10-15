// .cube LUTs (Resolve / Adobe format): parsing, sampling for the live preview, and the file the
// render uses (with the clip's LUT amount baked in, so FFmpeg's lut3d does it all in one pass).

export interface Lut3D {
  title: string;
  size: number;
  /** size³ RGB triples, red changing fastest (the .cube order), values 0..1 */
  data: Float32Array;
}

/** Parse a .cube file. 1D LUTs are turned into an equivalent 3D one. */
export function parseCube(text: string): Lut3D {
  let title = '';
  let size3 = 0;
  let size1 = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const rows: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const up = line.toUpperCase();
    if (up.startsWith('TITLE')) title = line.replace(/^TITLE\s*/i, '').replace(/^"|"$/g, '');
    else if (up.startsWith('LUT_3D_SIZE')) size3 = parseInt(line.split(/\s+/)[1], 10);
    else if (up.startsWith('LUT_1D_SIZE')) size1 = parseInt(line.split(/\s+/)[1], 10);
    else if (up.startsWith('DOMAIN_MIN')) min = line.split(/\s+/).slice(1, 4).map(Number);
    else if (up.startsWith('DOMAIN_MAX')) max = line.split(/\s+/).slice(1, 4).map(Number);
    else if (/^[-+.\d]/.test(line)) {
      const v = line.split(/\s+/).slice(0, 3).map(Number);
      if (v.length === 3 && v.every(Number.isFinite)) rows.push(...v);
    }
  }
  const norm = (v: number, c: number) => (v - min[c]) / (max[c] - min[c] || 1);
  if (size3 > 1) {
    if (rows.length < size3 ** 3 * 3) throw new Error(`The LUT says it has ${size3}³ entries but holds ${rows.length / 3}.`);
    const data = new Float32Array(size3 ** 3 * 3);
    for (let i = 0; i < data.length; i++) data[i] = rows[i];
    return { title, size: size3, data };
  }
  if (size1 > 1) {
    if (rows.length < size1 * 3) throw new Error('The 1D LUT is shorter than its size.');
    const curve = (c: number, v: number) => {
      const x = Math.min(1, Math.max(0, norm(v, c))) * (size1 - 1);
      const i = Math.min(size1 - 2, Math.floor(x));
      return rows[i * 3 + c] + (rows[(i + 1) * 3 + c] - rows[i * 3 + c]) * (x - i);
    };
    const n = 33;
    const data = new Float32Array(n ** 3 * 3);
    for (let b = 0; b < n; b++)
      for (let g = 0; g < n; g++)
        for (let r = 0; r < n; r++) {
          const o = (r + g * n + b * n * n) * 3;
          data[o] = curve(0, min[0] + ((max[0] - min[0]) * r) / (n - 1));
          data[o + 1] = curve(1, min[1] + ((max[1] - min[1]) * g) / (n - 1));
          data[o + 2] = curve(2, min[2] + ((max[2] - min[2]) * b) / (n - 1));
        }
    return { title, size: n, data };
  }
  throw new Error('Not a .cube LUT (no LUT_3D_SIZE or LUT_1D_SIZE).');
}

/** Trilinear lookup of an RGB colour (0..1) into `out`. */
export function sampleLut(l: Lut3D, r: number, g: number, b: number, out: number[] | Float32Array) {
  const n = l.size - 1;
  const fx = Math.min(n, Math.max(0, r * n));
  const fy = Math.min(n, Math.max(0, g * n));
  const fz = Math.min(n, Math.max(0, b * n));
  const x0 = Math.min(n - 1, Math.floor(fx));
  const y0 = Math.min(n - 1, Math.floor(fy));
  const z0 = Math.min(n - 1, Math.floor(fz));
  const dx = fx - x0;
  const dy = fy - y0;
  const dz = fz - z0;
  const s = l.size;
  const d = l.data;
  for (let c = 0; c < 3; c++) {
    const at = (x: number, y: number, z: number) => d[(x + y * s + z * s * s) * 3 + c];
    const c00 = at(x0, y0, z0) * (1 - dx) + at(x0 + 1, y0, z0) * dx;
    const c10 = at(x0, y0 + 1, z0) * (1 - dx) + at(x0 + 1, y0 + 1, z0) * dx;
    const c01 = at(x0, y0, z0 + 1) * (1 - dx) + at(x0 + 1, y0, z0 + 1) * dx;
    const c11 = at(x0, y0 + 1, z0 + 1) * (1 - dx) + at(x0 + 1, y0 + 1, z0 + 1) * dx;
    out[c] = (c00 * (1 - dy) + c10 * dy) * (1 - dz) + (c01 * (1 - dy) + c11 * dy) * dz;
  }
}

/** For the preview: apply the LUT (mixed with the original by `amount`) to RGBA pixels in place. */
export function lutApplier(l: Lut3D, amount: number): (px: Uint8ClampedArray | Uint8Array) => void {
  const a = Math.min(1, Math.max(0, amount));
  const tmp = [0, 0, 0];
  return (d) => {
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const r = d[i] / 255;
      const g = d[i + 1] / 255;
      const b = d[i + 2] / 255;
      sampleLut(l, r, g, b, tmp);
      d[i] = (r + (tmp[0] - r) * a) * 255;
      d[i + 1] = (g + (tmp[1] - g) * a) * 255;
      d[i + 2] = (b + (tmp[2] - b) * a) * 255;
    }
  };
}

/** The LUT mixed with "no change" by `amount`, written as a .cube file. */
export function cubeText(l: Lut3D, amount = 1): string {
  const a = Math.min(1, Math.max(0, amount));
  const n = l.size;
  const lines = [`TITLE "${l.title.replace(/"/g, '')}"`, `LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const o = (r + g * n + b * n * n) * 3;
        const id = [r / (n - 1), g / (n - 1), b / (n - 1)];
        lines.push([0, 1, 2].map((c) => (id[c] + (l.data[o + c] - id[c]) * a).toFixed(6)).join(' '));
      }
  return lines.join('\n') + '\n';
}

/** File name the render reads a LUT at a given amount from (no characters FFmpeg filters mind). */
export const lutFile = (id: string, amount = 1) => `lut_${id.replace(/[^\w]/g, '')}_${Math.round(Math.min(1, Math.max(0, amount)) * 100)}.cube`;

/** Storage key of an imported LUT's text. */
export const lutKey = (id: string) => 'lut:' + id;
