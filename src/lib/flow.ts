// The flow engine: GPU block-matching motion estimation + vector manipulation + feedback warp.
// It imitates what a codec does with P-frames (move blocks + add residual), but with every
// part exposed: amplify / rotate / swap / quantise the vectors, drift, turbulence...
import { COPY, GL, type Target } from './gl';

export interface FlowParams {
  amplify: number;
  rotate: number; // degrees
  swap: boolean;
  drift: number;
  driftY: number;
  turbulence: number;
  quantize: number;
  threshold: number;
  block: number;
  search: number;
  smooth: boolean;
  residual: number;
  refresh: number;
  mix: number;
}

export const defaultFlow = (): FlowParams => ({
  amplify: 1.5,
  rotate: 0,
  swap: false,
  drift: 0,
  driftY: 0,
  turbulence: 0,
  quantize: 0,
  threshold: 0.3,
  block: 8,
  search: 8,
  smooth: false,
  residual: 0.15,
  refresh: 0,
  mix: 1,
});

const ME = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D cur; uniform sampler2D prev;
uniform vec2 size; uniform float block; uniform float range;
float lum(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
float cost(vec2 origin, vec2 d){
  float s = 0.;
  for (float y = 0.5; y < 4.; y += 1.) for (float x = 0.5; x < 4.; x += 1.) {
    vec2 p = origin + vec2(x, y) * block / 4.;
    s += abs(lum(texture(cur, p/size).rgb) - lum(texture(prev, (p + d)/size).rgb));
  }
  return s + length(d) * 0.002; // bias toward small vectors
}
void main(){
  vec2 origin = floor(uv * ceil(size/block)) * block; // block top-left in px
  // coarse search on a grid, then refine around the winner
  float st = max(1., floor(range / 5.));
  float best = cost(origin, vec2(0.)); vec2 bd = vec2(0.);
  for (float dy = -range; dy <= range; dy += st) {
    for (float dx = -range; dx <= range; dx += st) {
      float c = cost(origin, vec2(dx, dy));
      if (c < best) { best = c; bd = vec2(dx, dy); }
    }
  }
  if (st > 1.) {
    vec2 c0 = bd;
    float rr = st - 1.;
    for (float dy = -rr; dy <= rr; dy += 1.) for (float dx = -rr; dx <= rr; dx += 1.) {
      float c = cost(origin, c0 + vec2(dx, dy));
      if (c < best) { best = c; bd = c0 + vec2(dx, dy); }
    }
  }
  o = vec4((bd + 32.) / 64., 0., 1.);
}`;

const WARP = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D canvasTex; uniform sampler2D cur; uniform sampler2D prev; uniform sampler2D mv;
uniform vec2 size; uniform float amplify; uniform float rot; uniform float swapXY;
uniform vec2 drift; uniform float turb; uniform float quant; uniform float thresh;
uniform float residual; uniform float refresh; uniform float mixAmt; uniform float time;
void main(){
  vec2 d = texture(mv, uv).xy * 64. - 32.;          // measured sample offset (px)
  vec2 v = d;
  if (length(d) < thresh) v = vec2(0.);
  v *= amplify;
  float c = cos(rot), s = sin(rot);
  v = vec2(c*v.x - s*v.y, s*v.x + c*v.y);
  if (swapXY > 0.5) v = v.yx;
  vec2 p = uv * size;
  // vectors are sample offsets in texture space (y up): content moving by m means v = -m.
  // drift.y > 0 means "flow downwards on screen", i.e. sample from above.
  v += vec2(-drift.x, drift.y);
  v += turb * vec2(sin(p.y*0.045 + time*1.7) + sin(p.x*0.021 - time), cos(p.x*0.04 + time*1.3) + cos(p.y*0.017 + time*0.7));
  if (quant > 0.) v = floor(v/quant + 0.5) * quant;
  vec2 off = v / size;
  vec2 dd = d / size;
  vec3 moved = texture(canvasTex, uv + off).rgb;
  vec3 res = texture(cur, uv).rgb - texture(prev, uv + dd).rgb;
  vec3 r = moved + res * residual;
  r = mix(r, texture(cur, uv).rgb, refresh);
  o = vec4(mix(texture(cur, uv).rgb, r, mixAmt), 1.);
}`;

export class FlowEngine {
  private prev: Target;
  private cur: Target;
  private canvasA: Target;
  private canvasB: Target;
  private mv: Target | null = null;
  private mvBlock = 0;
  private started = false;
  time = 0;
  constructor(public gl: GL, public w: number, public h: number) {
    this.prev = gl.target(w, h);
    this.cur = gl.target(w, h);
    this.canvasA = gl.target(w, h);
    this.canvasB = gl.target(w, h);
  }

  reset() {
    this.started = false;
  }

  /** Feed the next source frame (as a texture target already filled). Returns the output target. */
  step(input: Target, p: FlowParams): Target {
    const gl = this.gl;
    // shift cur -> prev, input -> cur
    gl.pass(COPY, this.prev, { src: this.cur.tex });
    gl.pass(COPY, this.cur, { src: input.tex });
    if (!this.started) {
      gl.pass(COPY, this.prev, { src: input.tex });
      gl.pass(COPY, this.canvasA, { src: input.tex });
      this.started = true;
      return this.canvasA;
    }
    const block = Math.max(2, Math.round(p.block));
    if (!this.mv || this.mvBlock !== block) {
      gl.dispose(this.mv);
      this.mv = gl.target(Math.ceil(this.w / block), Math.ceil(this.h / block), false);
      this.mvBlock = block;
    }
    gl.pass(ME, this.mv, { cur: this.cur.tex, prev: this.prev.tex }, { size: [this.w, this.h], block, range: Math.min(30, Math.max(1, Math.round(p.search))) });
    gl.filter(this.mv.tex, p.smooth);
    this.time += 1 / 24;
    gl.pass(
      WARP,
      this.canvasB,
      { canvasTex: this.canvasA.tex, cur: this.cur.tex, prev: this.prev.tex, mv: this.mv.tex },
      {
        size: [this.w, this.h],
        amplify: p.amplify,
        rot: (p.rotate * Math.PI) / 180,
        swapXY: p.swap ? 1 : 0,
        drift: [p.drift, p.driftY],
        turb: p.turbulence,
        quant: p.quantize,
        thresh: p.threshold,
        residual: p.residual,
        refresh: p.refresh,
        mixAmt: p.mix,
        time: this.time,
      },
    );
    [this.canvasA, this.canvasB] = [this.canvasB, this.canvasA];
    return this.canvasA;
  }

  /** Replace the persistent image (e.g. "freeze this frame" or drop an image in live mode). */
  setCanvas(src: Target) {
    this.gl.pass(COPY, this.canvasA, { src: src.tex });
  }

  dispose() {
    this.gl.dispose(this.prev, this.cur, this.canvasA, this.canvasB, this.mv);
  }
}

export const CHROMA = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D src; uniform vec2 size; uniform vec2 off; uniform float tear; uniform float seed;
float h(float n){ return fract(sin(n*91.345 + seed*7.13)*43758.5453); }
void main(){
  vec2 u = uv;
  float row = floor(uv.y * size.y / 3.);
  if (tear > 0. && h(row) > 0.93) u.x += (h(row + 1.) - 0.5) * 2. * tear / size.x;
  vec2 d = off / size;
  o = vec4(texture(src, u + d).r, texture(src, u).g, texture(src, u - d).b, 1.);
}`;
