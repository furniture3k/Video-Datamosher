// Video scopes from RGBA pixels: waveform, RGB parade, vectorscope and histogram.
// Each one draws into a canvas of its own size; the input is a small downscaled picture.

export type ScopeKind = 'waveform' | 'parade' | 'vectorscope' | 'histogram';

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Counts per (column, level): `cols` columns × 256 levels. */
function columns(px: Uint8ClampedArray, w: number, h: number, cols: number, value: (i: number) => number): Uint32Array {
  const out = new Uint32Array(cols * 256);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c = Math.min(cols - 1, Math.floor((x / w) * cols));
      out[c * 256 + Math.min(255, Math.round(value(i)))]++;
    }
  return out;
}

/** Waveform data: luma level counts per column (exported for tests). */
export const waveformData = (px: Uint8ClampedArray, w: number, h: number, cols: number) => columns(px, w, h, cols, (i) => luma(px[i], px[i + 1], px[i + 2]));

/** Histogram data: counts of R, G, B and luma levels (exported for tests). */
export function histogramData(px: Uint8ClampedArray): Uint32Array[] {
  const hs = [0, 1, 2, 3].map(() => new Uint32Array(256));
  for (let i = 0; i < px.length; i += 4) {
    hs[0][px[i]]++;
    hs[1][px[i + 1]]++;
    hs[2][px[i + 2]]++;
    hs[3][Math.round(luma(px[i], px[i + 1], px[i + 2]))]++;
  }
  return hs;
}

/** Vectorscope position (−1..1) of a colour: Cb across, Cr up. */
export function chroma(r: number, g: number, b: number): [number, number] {
  const cb = -0.1146 * r - 0.3854 * g + 0.5 * b;
  const cr = 0.5 * r - 0.4542 * g - 0.0458 * b;
  return [cb / 128, cr / 128];
}

function plotColumns(ctx: CanvasRenderingContext2D, data: Uint32Array, cols: number, x0: number, wpx: number, H: number, rgb: [number, number, number], gain: number) {
  const img = ctx.getImageData(x0, 0, wpx, H);
  const d = img.data;
  for (let c = 0; c < cols; c++)
    for (let v = 0; v < 256; v++) {
      const n = data[c * 256 + v];
      if (!n) continue;
      const a = Math.min(1, n * gain);
      const x = Math.floor((c / cols) * wpx);
      const y = Math.round((1 - v / 255) * (H - 1));
      const i = (y * wpx + x) * 4;
      d[i] = Math.min(255, d[i] + rgb[0] * a);
      d[i + 1] = Math.min(255, d[i + 1] + rgb[1] * a);
      d[i + 2] = Math.min(255, d[i + 2] + rgb[2] * a);
      d[i + 3] = 255;
    }
  ctx.putImageData(img, x0, 0);
}

/** Draw a scope of the picture `px` (w×h RGBA) onto `canvas`. */
export function drawScope(canvas: HTMLCanvasElement, kind: ScopeKind, px: Uint8ClampedArray, w: number, h: number) {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#0b0b0b';
  ctx.fillRect(0, 0, W, H);
  const gain = 6 / Math.max(1, h);
  if (kind === 'waveform') plotColumns(ctx, waveformData(px, w, h, W), W, 0, W, H, [140, 255, 160], gain);
  else if (kind === 'parade') {
    const third = Math.floor(W / 3);
    [0, 1, 2].forEach((ch) => {
      const rgb: [number, number, number] = [ch === 0 ? 255 : 40, ch === 1 ? 255 : 40, ch === 2 ? 255 : 40];
      plotColumns(ctx, columns(px, w, h, third, (i) => px[i + ch]), third, ch * third, third, H, rgb, gain);
    });
  } else if (kind === 'histogram') {
    const hs = histogramData(px);
    const peak = Math.max(1, ...hs.slice(0, 3).flatMap((a) => Array.from(a.subarray(2, 254))));
    const cols = ['rgba(255,70,70,0.6)', 'rgba(70,255,70,0.6)', 'rgba(80,120,255,0.6)'];
    ctx.globalCompositeOperation = 'lighter';
    hs.slice(0, 3).forEach((hist, ch) => {
      ctx.fillStyle = cols[ch];
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let v = 0; v < 256; v++) ctx.lineTo((v / 255) * W, H - Math.min(1, hist[v] / peak) * (H - 2));
      ctx.lineTo(W, H);
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
  } else {
    // vectorscope: graticule, skin-tone line, then the colours of the picture
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) / 2 - 4;
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    ctx.strokeStyle = '#6a4a2a';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos((-123 * Math.PI) / 180) * R, cy + Math.sin((-123 * Math.PI) / 180) * R);
    ctx.stroke();
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const [u, v] = chroma(px[i], px[i + 1], px[i + 2]);
      const x = Math.round(cx + u * R);
      const y = Math.round(cy - v * R);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const o = (y * W + x) * 4;
      d[o] = Math.min(255, d[o] + px[i] * 0.25 + 20);
      d[o + 1] = Math.min(255, d[o + 1] + px[i + 1] * 0.25 + 20);
      d[o + 2] = Math.min(255, d[o + 2] + px[i + 2] * 0.25 + 20);
    }
    ctx.putImageData(img, 0, 0);
  }
}
