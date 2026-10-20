// Marking something that moves: a box around it, an arrow pointing at it and a label, all three
// following its tracked path. Pure: the caller tracks the object and adds what this returns.
import { freeRow, type Layer, type ShapeLayer, type TextLayer } from './layers';
import type { ShapeLook } from './shapes';

/**
 * The marks for an object tracked along `path` ([timeline s, x, y] of the box's middle, as shares
 * of the frame) whose box was `bw`×`bh` (shares of the frame's width and height) where it was
 * picked. `aspect` is the frame's width over its height. The arrow comes from whichever side has
 * more room, above it unless it's near the top. Rows are found among `layers` (not changed).
 */
export function markLayers(path: [number, number, number][], bw: number, bh: number, aspect: number, look: ShapeLook, layers: Layer[], id: () => string, label = 'Look'): Layer[] {
  if (!path.length) return [];
  const t0 = path[0][0];
  const t1 = Math.max(t0 + 0.5, path[path.length - 1][0]);
  const [, cx, cy] = path[0];
  // a little room around the object
  const w = Math.min(1, bw * 1.15 + 0.01);
  const h = Math.min(1, bh * 1.15 + 0.01);
  const side = cx < 0.5 ? 1 : -1;
  const up = cy > 0.3 ? -1 : 1;
  // the arrow, in frame heights: from a tail out to the side to the box's nearest top (or bottom) corner
  const L = 0.12;
  const gap = 0.012;
  const tip: [number, number] = [cx * aspect + side * (w * aspect / 2 + gap), cy + up * (h / 2 + gap)];
  const tail: [number, number] = [tip[0] + side * L, tip[1] + up * L];
  // an arrow points from its box's top-left to its bottom-right: turn it to point from tail to tip
  const turn = Math.round(((Math.atan2(tip[1] - tail[1], tip[0] - tail[0]) * 180) / Math.PI - 45) * 10) / 10;
  const mid: [number, number] = [(tip[0] + tail[0]) / 2 / aspect, (tip[1] + tail[1]) / 2];
  const at = (dx: number, dy: number) => path.map(([t, x, y]) => [t, Math.round((x + dx) * 1e4) / 1e4, Math.round((y + dy) * 1e4) / 1e4] as [number, number, number]);

  const out: Layer[] = [];
  // the box, arrow and label are one group: they move, copy and delete together
  const group = id();
  const add = (l: Layer) => {
    l.group = group;
    l.row = freeRow([...layers, ...out], l.start, l.start + l.duration);
    out.push(l);
  };
  const box: ShapeLayer = { id: id(), kind: 'shape', row: '', shape: 'rect', start: t0, duration: t1 - t0, x: cx, y: cy, fade: 0, moshed: false, w, h, ...look, follow: at(0, 0) };
  delete box.fill;
  add(box);
  // the arrow and label come in just after the box has drawn on
  const late = Math.min(0.35, (t1 - t0) / 3);
  const ax = mid[0] - cx;
  const ay = mid[1] - cy;
  const arrow: ShapeLayer = { id: id(), kind: 'shape', row: '', shape: 'arrow', start: t0 + late, duration: t1 - t0 - late, x: mid[0], y: mid[1], fade: 0, moshed: false, w: L / aspect, h: L, head: 0.3, ...look, rotate: turn, follow: at(ax, ay) };
  delete arrow.fill;
  add(arrow);
  // the label sits past the arrow's tail
  const lx = tail[0] / aspect + side * 0.01 - cx;
  const ly = tail[1] + up * 0.035 - cy;
  const text: TextLayer = { id: id(), kind: 'text', row: '', text: label, start: t0 + late * 2, duration: t1 - t0 - late * 2, size: 0.05, color: look.color, font: 'sans', bold: true, x: cx + lx, y: cy + ly, align: 'center', shadow: true, box: false, fade: 0, moshed: false, anim: 'type', animIn: 0.3, follow: at(lx, ly) };
  add(text);
  return out;
}

/**
 * A callout at a point (shares of the frame): a box round what is pointed at, a leader line with a
 * square at each end running out to a title, and small print under it, as one group (they move,
 * copy and delete together). The title and small print go to whichever side has more room.
 */
export function calloutLayers(at: [number, number], aspect: number, look: ShapeLook, layers: Layer[], id: () => string, start: number, duration: number): Layer[] {
  const side = at[0] < 0.5 ? 1 : -1;
  const up = at[1] > 0.4 ? -1 : 1;
  const bw = 0.24 / aspect;
  const bh = 0.16;
  // the leader leaves the box's outer corner for the label's corner
  const from: [number, number] = [at[0] + (side * bw) / 2, at[1] + (up * bh) / 2];
  const dx = (side * 0.13) / aspect;
  const dy = up * 0.15;
  const to: [number, number] = [from[0] + dx, from[1] + dy];
  const group = id();
  const out: Layer[] = [];
  const add = (l: Layer) => {
    l.group = group;
    l.row = freeRow([...layers, ...out], l.start, l.start + l.duration);
    out.push(l);
  };
  const box: ShapeLayer = { id: id(), kind: 'shape', row: '', shape: 'rect', start, duration, x: at[0], y: at[1], fade: 0, moshed: false, w: bw, h: bh, ...look };
  delete box.fill;
  add(box);
  const leader: ShapeLayer = { id: id(), kind: 'shape', row: '', shape: 'leader', start, duration, x: (from[0] + to[0]) / 2, y: (from[1] + to[1]) / 2, fade: 0, moshed: false, w: Math.abs(dx), h: Math.abs(dy), head: 0.07, ...look, fill: look.color, flip: dx * dy < 0 };
  add(leader);
  const align = side > 0 ? 'left' : 'right';
  const title: TextLayer = { id: id(), kind: 'text', row: '', text: 'Title', start, duration, size: 0.06, color: look.color, font: 'sans', bold: true, x: to[0] + (side * 0.012) / aspect, y: to[1] + up * 0.04, align, shadow: true, box: false, fade: 0, moshed: false, anim: 'type', animIn: 0.3 };
  add(title);
  const small: TextLayer = { id: id(), kind: 'text', row: '', text: 'Small print goes here', start, duration, size: 0.028, color: '#ffffff', font: 'sans', bold: false, x: title.x, y: title.y + up * 0.065, align, shadow: true, box: false, fade: 0, moshed: false };
  add(small);
  return out;
}
