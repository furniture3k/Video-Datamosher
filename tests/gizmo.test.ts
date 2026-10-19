import type { TextLayer } from '../src/engine/layers';
import { describe, expect, it } from 'vitest';
import { boxQuad, centre, inQuad, normDeg, pictureQuad, pinch, poseOf, scaleBy, setPose, snapTo, snapTurn, turnBy, turnHandle } from '../src/engine/gizmo';
import { withKeyAt } from '../src/engine/keys';
import { pictureMatrix } from '../src/engine/placement';
import { newProject, type Clip } from '../src/engine/types';

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe('handle boxes', () => {
  it('turns a box about its centre', () => {
    const q = boxQuad(100, 50, 40, 20, 0);
    close(q[0], [80, 40]);
    close(q[2], [120, 60]);
    const r = boxQuad(0, 0, 40, 20, 90);
    // a quarter turn clockwise: the top left corner goes to the top right
    close(r[0], [10, -20]);
    close(centre(r), [0, 0]);
  });

  it('places a clip picture with its transform', () => {
    const c = { fit: 'stretch', transform: { zoom: 0.5, x: 0.25, y: 0 } } as unknown as Clip;
    const q = pictureQuad(pictureMatrix(c, 0, 100, 100, 200, 100), 200, 100);
    // half size, moved right by a quarter of the frame: centre at (150, 50), 100×50
    close(centre(q), [150, 50]);
    close(q[0], [100, 25]);
    close(q[2], [200, 75]);
  });

  it('hit tests turned boxes either way round', () => {
    const q = boxQuad(0, 0, 40, 20, 30);
    expect(inQuad([0, 0], q)).toBe(true);
    expect(inQuad([19, 0], q)).toBe(true);
    expect(inQuad([0, 19], q)).toBe(false);
    expect(inQuad([0, 0], [q[3], q[2], q[1], q[0]])).toBe(true);
  });

  it('puts the turn handle outside the top edge, also when turned', () => {
    close(turnHandle(boxQuad(0, 0, 40, 20, 0), 12), [0, -22]);
    close(turnHandle(boxQuad(0, 0, 40, 20, 90), 12), [22, 0]);
  });
});

describe('drags and pinches', () => {
  it('scale by the change in distance from the centre, within limits', () => {
    expect(scaleBy([0, 0], [10, 0], [20, 0])).toBeCloseTo(2);
    expect(scaleBy([0, 0], [10, 0], [0, 5])).toBeCloseTo(0.5);
    expect(scaleBy([0, 0], [10, 0], [0, 0])).toBeCloseTo(0.02);
    expect(scaleBy([0, 0], [0, 0], [5, 5])).toBe(1);
  });

  it('turn by the change in angle about the centre, clockwise positive', () => {
    expect(turnBy([0, 0], [10, 0], [0, 10])).toBeCloseTo(90);
    expect(turnBy([0, 0], [-10, 1], [-10, -1])).toBeCloseTo(normDeg(2 * (Math.atan(1 / 10) * 180) / Math.PI));
    expect(normDeg(270)).toBe(-90);
    expect(normDeg(-190)).toBe(170);
  });

  it('pinch: scale, turn and the move of the middle', () => {
    const p = pinch([0, 0], [10, 0], [5, 5], [5, 25]);
    expect(p.scale).toBeCloseTo(2);
    expect(p.turn).toBeCloseTo(90);
    close(p.move, [0, 15]);
  });
});

describe('snapping', () => {
  it('pulls onto the nearest target within reach', () => {
    expect(snapTo(98, [100, 50], 4)).toEqual({ v: 100, to: 100 });
    expect(snapTo(90, [100, 50], 4)).toEqual({ v: 90, to: null });
    expect(snapTo(52, [55, 50], 4)).toEqual({ v: 50, to: 50 });
  });

  it('turns snap to quarter turns, or to steps', () => {
    expect(snapTurn(88, 0)).toBe(90);
    expect(snapTurn(80, 0)).toBe(80);
    expect(snapTurn(-178, 0)).toBe(-180);
    expect(snapTurn(37, 15)).toBe(30);
  });
});

describe('keys', () => {
  it('set the key at a time, replacing one close to it', () => {
    expect(withKeyAt([[0, 1], [1, 2]], 1.01, 5, 0.02)).toEqual([[0, 1], [1.01, 5]]);
    expect(withKeyAt([[0, 1], [1, 2]], 0.5, 5, 0.02)).toEqual([[0, 1], [0.5, 5], [1, 2]]);
  });
});

describe('poses', () => {
  const project = () => {
    const p = newProject();
    p.media = [{ id: 'm', source: { kind: 'generator', generator: 'bars', name: 'Bars' }, duration: 10, width: 320, height: 240, fps: 24, hasAudio: false, hasVideo: true }];
    p.clips = [
      { id: 'main', mediaId: 'm', track: 'v1', start: 0, in: 0, out: 4, speed: 1, reverse: false, fit: 'fit', volume: 1, muted: false, fadeIn: 0, fadeOut: 0 },
      { id: 'top', mediaId: 'm', track: 'v2', start: 1, in: 0, out: 2, speed: 1, reverse: false, fit: 'fit', volume: 1, muted: false, fadeIn: 0, fadeOut: 0, transform: { zoom: 0.5, x: 0.1 }, keys: { rotate: [[0, 0], [2, 90]] } },
    ];
    p.layers = [{ id: 't', kind: 'text', row: 'g1', text: 'Hi', start: 0, duration: 4, size: 0.1, color: '#fff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: false, box: false, fade: 0, moshed: false, follow: [[0, 0.2, 0.2], [4, 0.6, 0.2]] }];
    return p;
  };

  it('read a title and a clip where they are at that moment', () => {
    const p = project();
    const tp = poseOf(p, 't', 2)!;
    expect(tp.x).toBeCloseTo(0.4);
    expect(tp.scale).toBe(0.1);
    // the clip on the track above: 1 s in, half way through its rotation keys
    expect(poseOf(p, 'top', 2)).toEqual({ x: 0.6, y: 0.5, scale: 0.5, turn: 45 });
    expect(poseOf(p, 'nothing', 0)).toBeNull();
  });

  it('move a title that follows a path along with its whole path, and size and turn it', () => {
    const p = project();
    setPose(p, 't', 2, { x: 0.5, y: 0.3, scale: 0.2, turn: 30 }, 0.02);
    const l = p.layers[0] as TextLayer;
    expect(l.follow!.map(([, x, y]) => [+x.toFixed(6), +y.toFixed(6)])).toEqual([[0.3, 0.3], [0.7, 0.3]]);
    expect([l.size, l.rotate]).toEqual([0.2, 30]);
  });

  it('set a clip\'s plain settings, and a key at the playhead on keyframed ones', () => {
    const p = project();
    setPose(p, 'top', 2, { x: 0.7, y: 0.5, scale: 0.5, turn: 60 }, 0.02);
    const c = p.clips[1];
    expect(c.transform!.x).toBeCloseTo(0.2);
    // y and zoom didn't change: nothing written for them
    expect(c.transform!.zoom).toBe(0.5);
    expect('y' in c.transform!).toBe(false);
    expect(c.keys!.rotate).toEqual([[0, 0], [1, 60], [2, 90]]);
    expect(c.keys!.x).toBeUndefined();
  });

  it('find a main-track clip by its place on the timeline', () => {
    const p = project();
    setPose(p, 'main', 1, { x: 0.5, y: 0.5, scale: 2, turn: 0 }, 0.02);
    expect(p.clips[0].transform).toEqual({ zoom: 2 });
  });
});
