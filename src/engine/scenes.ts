// Sample footage drawn like camera footage: depth, soft light and a moving camera, which mosh
// the way real clips do (the test patterns and fractals don't move like footage). Each scene
// draws one frame at time t on a 2D canvas of any shape; they're deterministic.

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Scene {
  id: string;
  name: string;
  draw: (g: Ctx, w: number, h: number, t: number) => void;
}

/** A repeatable stream of numbers in 0..1 (mulberry32). */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** A top-to-bottom gradient from y0 to y1 as the fill. */
function vertical(g: Ctx, y0: number, y1: number, stops: [number, string][]) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr;
}

function glow(g: Ctx, x: number, y: number, r: number, colour: string, alpha: number) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, colour);
  gr.addColorStop(0.45, colour);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = alpha;
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
}

// ---------- city lights: out-of-focus lights drifting past a handheld camera

const BOKEH = ['#ffb347', '#ff6f91', '#6fd3ff', '#ffe29a', '#c38bff', '#ff9d5c'];
const lights = (() => {
  const r = rand(7);
  return Array.from({ length: 46 }, () => ({ x: r(), y: r(), size: 0.04 + r() * 0.11, depth: 0.3 + r() * 0.9, colour: BOKEH[Math.floor(r() * BOKEH.length)], phase: r() * 6.28 }));
})();

function cityLights(g: Ctx, w: number, h: number, t: number) {
  const s = Math.min(w, h);
  vertical(g, 0, h, [
    [0, '#0b1026'],
    [0.6, '#1a1238'],
    [1, '#2a0f2e'],
  ]);
  g.fillRect(0, 0, w, h);
  // the camera drifts right and sways a little, as if handheld
  const panX = t * 0.09;
  const swayX = Math.sin(t * 1.3) * 0.012 + Math.sin(t * 3.1) * 0.004;
  const swayY = Math.cos(t * 1.7) * 0.01;
  g.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    const x = ((((l.x - (panX + swayX) * l.depth) % 1.3) + 1.3) % 1.3) - 0.15;
    const y = l.y + swayY * l.depth;
    // the focus breathes
    const r = s * l.size * (1 + 0.08 * Math.sin(t * 0.9 + l.phase));
    glow(g, x * w, y * h, r, l.colour, 0.38 + 0.22 * Math.sin(t * 2 + l.phase) ** 2);
  }
  g.globalCompositeOperation = 'source-over';
}

// ---------- sunset over water: a slow pan, a low sun, waves catching the light

function sunset(g: Ctx, w: number, h: number, t: number) {
  const s = Math.min(w, h);
  const horizon = h * 0.58;
  vertical(g, 0, horizon, [
    [0, '#241047'],
    [0.45, '#8e3f8f'],
    [0.8, '#f0756a'],
    [1, '#ffc173'],
  ]);
  g.fillRect(0, 0, w, horizon + 1);
  const pan = t * 0.025 * w;
  const sx = w * 0.5 - pan + w * 0.06;
  const sy = horizon - s * 0.06 + t * s * 0.006;
  glow(g, sx, sy, s * 0.42, '#ffb067', 0.55);
  g.fillStyle = '#fff1c9';
  g.beginPath();
  g.arc(sx, sy, s * 0.085, 0, Math.PI * 2);
  g.fill();
  // the sea, darker away from the sun
  vertical(g, horizon, h, [
    [0, '#7a3d6e'],
    [0.35, '#3b1f4f'],
    [1, '#120b24'],
  ]);
  g.fillRect(0, horizon, w, h - horizon);
  // waves: rows of short strokes that get bigger and faster towards the camera
  const r = rand(11);
  for (let i = 0; i < 70; i++) {
    const depth = i / 70;
    const y = horizon + (h - horizon) * depth * depth + 2;
    const len = w * (0.03 + 0.12 * depth);
    const speed = 0.02 + 0.15 * depth;
    const x0 = ((r() * w * 1.4 + t * speed * w - pan * (0.3 + depth)) % (w * 1.4)) - w * 0.2;
    const near = Math.max(0, 1 - Math.abs(x0 + len / 2 - sx) / (w * (0.18 + 0.3 * depth)));
    g.globalAlpha = 0.25 + 0.6 * near;
    g.fillStyle = near > 0.2 ? '#ffd29a' : '#c47aa6';
    g.fillRect(x0, y, len, Math.max(1, s * 0.004 * (1 + depth * 2)));
  }
  g.globalAlpha = 1;
}

// ---------- night drive: the road rushing at the camera, streetlights passing

function nightDrive(g: Ctx, w: number, h: number, t: number) {
  const s = Math.min(w, h);
  const horizon = h * 0.45;
  const vx = w * 0.5 + Math.sin(t * 0.6) * w * 0.03;
  vertical(g, 0, horizon, [
    [0, '#05060f'],
    [0.7, '#1a1446'],
    [1, '#5a2a5e'],
  ]);
  g.fillRect(0, 0, w, horizon + 1);
  // the city's glow on the horizon
  glow(g, vx, horizon, w * 0.5, '#ff7a59', 0.35);
  g.fillStyle = '#0a0a14';
  g.fillRect(0, horizon, w, h - horizon);
  // the road: a trapezoid to the vanishing point
  g.fillStyle = '#17151f';
  g.beginPath();
  g.moveTo(vx - s * 0.02, horizon);
  g.lineTo(vx + s * 0.02, horizon);
  g.lineTo(w * 1.1, h);
  g.lineTo(-w * 0.1, h);
  g.closePath();
  g.fill();
  /** a point z (1: at the camera, large: far away) along the road at side u (-1 left edge … 1 right edge) */
  const at = (u: number, z: number) => [vx + ((u * w * 0.6) / z) * 1, horizon + (h - horizon) / z] as const;
  const speed = 6;
  // the road's edges
  g.fillStyle = '#c9c2b0';
  for (const side of [-1, 1]) {
    const [ax, ay] = at(side * 0.92, 1);
    const [bx, by] = at(side * 0.97, 1);
    const [cx, cy] = at(side * 0.97, 60);
    const [dx, dy] = at(side * 0.92, 60);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.lineTo(cx, cy);
    g.lineTo(dx, dy);
    g.closePath();
    g.fill();
  }
  // dashes down the middle
  g.fillStyle = '#f2e6c4';
  for (let k = 0; k < 14; k++) {
    const z0 = 1 + ((k * 1.6 - t * speed) % 22.4 + 22.4) % 22.4;
    const z1 = z0 + 0.7;
    const [ax, ay] = at(-0.025, z0);
    const [bx, by] = at(0.025, z0);
    const [cx, cy] = at(0.025, z1);
    const [dx, dy] = at(-0.025, z1);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.lineTo(cx, cy);
    g.lineTo(dx, dy);
    g.closePath();
    g.fill();
  }
  // streetlights on both sides: posts, and warm lamps that grow and fly past
  const lamps: [number, number, number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const z = 0.6 + ((k * 2.4 - t * speed) % 24 + 24) % 24;
    for (const side of [-1, 1]) {
      const [x, y] = at(side * 1.25, z);
      const top = y - ((h - horizon) * 1.1) / z;
      g.strokeStyle = '#26232f';
      g.lineWidth = Math.max(1, (s * 0.012) / z);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, top);
      g.lineTo(x - side * ((s * 0.05) / z), top);
      g.stroke();
      lamps.push([x - side * ((s * 0.05) / z), top, z, side]);
    }
  }
  g.globalCompositeOperation = 'lighter';
  for (const [x, top, z, side] of lamps) glow(g, x, top, (s * 0.3) / z, side < 0 ? '#ffb15e' : '#ffd08a', Math.min(0.9, 1.6 / z));
  // tail lights ahead
  const [lx, ly] = at(-0.3, 7 + Math.sin(t * 0.8));
  glow(g, lx - s * 0.015, ly, s * 0.03, '#ff2a3a', 0.9);
  glow(g, lx + s * 0.015, ly, s * 0.03, '#ff2a3a', 0.9);
  g.globalCompositeOperation = 'source-over';
}

// ---------- a figure dancing on a plain backdrop (a clear subject, for cut-outs)

function figure(g: Ctx, w: number, h: number, t: number) {
  vertical(g, 0, h, [
    [0, '#f6dcc8'],
    [1, '#e9b8a6'],
  ]);
  g.fillRect(0, 0, w, h);
  // sized by the height, with the body on the middle of the frame (where a cut-out starts looking)
  const u = h * 0.075;
  const bob = Math.abs(Math.sin(t * Math.PI * 2 * 0.9)) * u * 0.3;
  const cx = w * 0.5 + Math.sin(t * 1.1) * Math.min(w * 0.04, u * 0.5);
  const floor = h * 0.5 + u * 3.4;
  // a soft shadow on the floor
  g.fillStyle = 'rgba(80,30,30,0.18)';
  g.beginPath();
  g.ellipse(cx, floor, u * 1.6, u * 0.25, 0, 0, Math.PI * 2);
  g.fill();
  const lean = Math.sin(t * 2.2) * 0.12;
  g.save();
  g.translate(cx, floor - bob);
  g.rotate(lean);
  g.fillStyle = '#1f1530';
  g.strokeStyle = '#1f1530';
  g.lineCap = 'round';
  // legs
  g.lineWidth = u * 0.42;
  const step = Math.sin(t * Math.PI * 2 * 0.9);
  g.beginPath();
  g.moveTo(-u * 0.3, -u * 2.4);
  g.lineTo(-u * 0.5 + step * u * 0.3, -u * 0.1);
  g.moveTo(u * 0.3, -u * 2.4);
  g.lineTo(u * 0.5 - step * u * 0.3, -u * 0.1);
  g.stroke();
  // body
  g.beginPath();
  g.ellipse(0, -u * 3.4, u * 0.8, u * 1.25, 0, 0, Math.PI * 2);
  g.fill();
  // arms, up on the beat
  g.lineWidth = u * 0.32;
  const arm = Math.sin(t * Math.PI * 2 * 0.9 + 1);
  g.beginPath();
  g.moveTo(-u * 0.6, -u * 4.1);
  g.lineTo(-u * 1.5, -u * (4.1 + 1.2 * arm));
  g.moveTo(u * 0.6, -u * 4.1);
  g.lineTo(u * 1.5, -u * (4.1 - 1.2 * arm));
  g.stroke();
  // head
  g.beginPath();
  g.arc(0, -u * 5.2, u * 0.62, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export const SCENES: Scene[] = [
  { id: 'citylights', name: 'City lights', draw: cityLights },
  { id: 'sunset', name: 'Sunset over water', draw: sunset },
  { id: 'nightdrive', name: 'Night drive', draw: nightDrive },
  { id: 'figure', name: 'Dancer', draw: figure },
];

export const isScene = (id: string) => SCENES.some((s) => s.id === id);

/** A generated clip's name, scene or FFmpeg generator. */
export const generatorName = (id: string, generators: { id: string; name: string }[]) => (SCENES.find((s) => s.id === id) ?? generators.find((g) => g.id === id))?.name ?? id;
