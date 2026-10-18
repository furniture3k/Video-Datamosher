// Colour correction and chroma key for the live preview, on the GPU. Same maths as gradePixels and
// chromaKeyPixels in preview.ts (which stay as the fallback when WebGL2 isn't there).
import { GL } from './gl';
import { gradeCurve, gradeMatrix } from '../engine/args';
import type { Lut3D } from '../engine/lut';
import type { ChromaKey, Grade } from '../engine/types';

const GRADE = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 o;
uniform sampler2D src; uniform sampler2D curve; uniform sampler3D lut;
uniform float colour; uniform float ident; uniform vec3 m0; uniform vec3 m1; uniform vec3 m2;
uniform float keyed; uniform vec3 keyc; uniform float sim; uniform float soft; uniform float spill; uniform float green;
uniform float hasLut; uniform float lutAmt; uniform float lutSize;
void main(){
  vec4 c = texture(src, uv);
  float a = c.a;
  if (keyed > 0.5) {
    float d = distance(c.rgb, keyc) / 1.7320508;
    float k = d < sim ? 0. : (soft > 0. && d < sim + soft ? (d - sim) / soft : 1.);
    a *= k;
    if (spill > 0.5 && k > 0.) {
      if (green > 0.5) c.g = min(c.g, (c.r + c.b) / 2. + 8. / 255.);
      else c.b = min(c.b, (c.r + c.g) / 2. + 8. / 255.);
    }
  }
  vec3 rgb = c.rgb;
  if (colour > 0.5) {
    // the curve is a 256-entry table, looked up by the 8-bit level (as on the CPU)
    vec3 i = (floor(rgb * 255. + 0.5) + 0.5) / 256.;
    rgb = vec3(texture(curve, vec2(i.r, .5)).r, texture(curve, vec2(i.g, .5)).r, texture(curve, vec2(i.b, .5)).r);
    if (ident < 0.5) rgb = clamp(vec3(dot(m0, rgb), dot(m1, rgb), dot(m2, rgb)), 0., 1.);
  }
  if (hasLut > 0.5) {
    vec3 p = (clamp(rgb, 0., 1.) * (lutSize - 1.) + 0.5) / lutSize;
    rgb = mix(rgb, texture(lut, p).rgb, lutAmt);
  }
  o = vec4(rgb, a);
}`;

export class GradeGL {
  canvas = document.createElement('canvas');
  private g: GL;
  private src: WebGLTexture;
  private curve: WebGLTexture;
  private curveKey = '';
  private luts = new WeakMap<Lut3D, WebGLTexture>();
  private emptyLut: WebGLTexture;

  private constructor() {
    this.g = new GL(this.canvas);
    const gl = this.g.gl;
    this.src = gl.createTexture()!;
    this.g.filter(this.src, true);
    this.curve = gl.createTexture()!;
    this.g.filter(this.curve, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 1, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    this.emptyLut = this.lut3d(new Float32Array(8 * 3), 2);
  }

  /** null when WebGL2 isn't available (the preview then grades on the CPU) */
  static create(): GradeGL | null {
    try {
      return new GradeGL();
    } catch {
      return null;
    }
  }

  dispose() {
    this.g.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  get lost() {
    return this.g.gl.isContextLost();
  }

  private lut3d(data: Float32Array, size: number): WebGLTexture {
    const gl = this.g.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, size, size, size, 0, gl.RGB, gl.FLOAT, data);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    return t;
  }

  /**
   * `img` keyed and graded, at w×h: draw `this.canvas` where `img` would have gone. False if the
   * picture can't be read (not loaded yet, or the GPU went away).
   */
  apply(img: TexImageSource, w: number, h: number, G: Grade, key: ChromaKey | null, lut: Lut3D | null, lutAmount: number): boolean {
    const gl = this.g.gl;
    if (gl.isContextLost()) return false;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } catch {
      return false;
    }
    const colour = !!(G.brightness || G.contrast !== 1 || G.gamma !== 1 || G.saturation !== 1 || G.hue);
    if (colour) {
      const ck = [G.brightness, G.contrast, G.gamma].join();
      if (ck !== this.curveKey) {
        this.curveKey = ck;
        const c = new Uint8Array(256);
        for (let i = 0; i < 256; i++) c[i] = Math.round(gradeCurve(G, i / 255) * 255);
        gl.bindTexture(gl.TEXTURE_2D, this.curve);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RED, gl.UNSIGNED_BYTE, c);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      }
    }
    let lt = this.emptyLut;
    if (lut && lutAmount > 0) {
      lt = this.luts.get(lut) ?? this.lut3d(lut.data, lut.size);
      this.luts.set(lut, lt);
    }
    // the 3D table sits on a unit of its own; pass() binds the 2D ones from unit 0
    const p = this.g.program(GRADE);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_3D, lt);
    gl.uniform1i(gl.getUniformLocation(p, 'lut'), 7);
    const m = gradeMatrix(G);
    const hex = (key?.color ?? '#000000').replace('#', '').padEnd(6, '0');
    const kc = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    gl.disable(gl.BLEND);
    this.g.pass(GRADE, null, { src: this.src, curve: this.curve }, {
      colour: colour ? 1 : 0,
      ident: G.saturation === 1 && !G.hue ? 1 : 0,
      m0: m.slice(0, 3),
      m1: m.slice(3, 6),
      m2: m.slice(6, 9),
      keyed: key ? 1 : 0,
      keyc: kc,
      sim: Math.max(0.01, key?.similarity ?? 0),
      soft: Math.max(0, key?.blend ?? 0),
      spill: key?.spill ? 1 : 0,
      green: kc[1] >= kc[0] && kc[1] >= kc[2] ? 1 : 0,
      hasLut: lut && lutAmount > 0 ? 1 : 0,
      lutAmt: Math.min(1, Math.max(0, lutAmount)),
      lutSize: lut?.size ?? 2,
    });
    return true;
  }
}
