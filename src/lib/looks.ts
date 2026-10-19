// Film and print looks: shaders for 1-bit ink, halftone dots, line art, glow and halation,
// vignettes, light leaks, gate weave, DV tape and light trails (pixel effects, after the mosh).
// Like ./retro, each takes `src`, the picture size in pixels, the time in seconds and a seed.

const HEAD = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D src; uniform vec2 size; uniform float time; uniform float seed;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed * 7.31) * 43758.5453); }
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float bayer(vec2 p){
  int x = int(mod(p.x, 4.)); int y = int(mod(p.y, 4.));
  int m[16] = int[](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return float(m[y * 4 + x]) / 16. - 0.5;
}`;

/** 1-bit: every pixel is ink or paper, split at a brightness level (a soft edge, or a dither). */
export const THRESHOLD = `${HEAD}
uniform float level; uniform float soft; uniform float dither; uniform vec3 ink; uniform vec3 paper; uniform float mixAmt;
void main(){
  vec3 c = texture(src, uv).rgb;
  float l = lum(c) + (dither > 0.5 ? bayer(floor(uv * size)) * 0.35 : 0.);
  float v = smoothstep(level - soft - 0.001, level + soft + 0.001, l);
  o = vec4(mix(c, mix(ink, paper, v), mixAmt), 1.);
}`;

/** Halftone: the picture as dots on a turned grid, bigger where it's darker (in black, or in its colours). */
export const HALFTONE = `${HEAD}
uniform float cell; uniform float angle; uniform float mono; uniform vec3 paper; uniform float mixAmt;
void main(){
  vec2 p = uv * size;
  float a = radians(angle);
  mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 q = r * p;
  vec2 cq = (floor(q / cell) + 0.5) * cell;
  vec2 cp = transpose(r) * cq;
  vec3 c = texture(src, clamp(cp / size, 0., 1.)).rgb;
  float l = lum(c);
  float rad = cell * 0.5 * sqrt(1. - l) * 1.25;
  float d = length(q - cq);
  float dot1 = 1. - smoothstep(rad - 0.8, rad + 0.8, d);
  vec3 inkc = mono > 0.5 ? vec3(0.06) : clamp((c - l * 0.35) * 1.35, 0., 1.);
  vec3 col = mix(paper, inkc, dot1);
  o = vec4(mix(texture(src, uv).rgb, col, mixAmt), 1.);
}`;

/** Line art: the picture's edges as ink lines, on paper, glowing on black, or over the picture. */
export const LINEART = `${HEAD}
uniform float thick; uniform float strength; uniform float mode; uniform vec3 ink; uniform float mixAmt;
float L(vec2 u){ return lum(texture(src, u).rgb); }
void main(){
  vec2 d = thick / size;
  float tl = L(uv + vec2(-d.x, d.y)), t = L(uv + vec2(0., d.y)), tr = L(uv + d);
  float l = L(uv - vec2(d.x, 0.)), r = L(uv + vec2(d.x, 0.));
  float bl = L(uv - d), b = L(uv - vec2(0., d.y)), br = L(uv + vec2(d.x, -d.y));
  float gx = (tr + 2. * r + br) - (tl + 2. * l + bl);
  float gy = (tl + 2. * t + tr) - (bl + 2. * b + br);
  float e = clamp(length(vec2(gx, gy)) * strength, 0., 1.);
  vec3 c = texture(src, uv).rgb;
  // 0: ink on paper, 1: light on black, 2: ink over the picture
  vec3 col = mode < 0.5 ? mix(vec3(0.97, 0.96, 0.93), ink, e) : mode < 1.5 ? ink * e : mix(c, ink, e);
  o = vec4(mix(c, col, mixAmt), 1.);
}`;

/** Glow: bright parts bloom; halation tints the bloom red, like light bouncing in film. */
export const GLOW = `${HEAD}
uniform float thr; uniform float radius; uniform float amount; uniform float halation;
void main(){
  vec3 c = texture(src, uv).rgb;
  vec3 acc = vec3(0.);
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float a = fi * 2.39996;
    float rr = radius * sqrt((fi + 0.5) / 24.);
    vec3 s = texture(src, uv + vec2(cos(a), sin(a)) * rr / size).rgb;
    acc += max(s - thr, 0.) / max(0.05, 1. - thr);
  }
  acc /= 24.;
  vec3 tint = mix(vec3(1.), vec3(1., 0.32, 0.18), halation);
  vec3 g = acc * tint * amount;
  o = vec4(clamp(1. - (1. - c) * (1. - g), 0., 1.), 1.);
}`;

/** Vignette: the corners darken (or lighten to white). */
export const VIGNETTE = `${HEAD}
uniform float amount; uniform float reach; uniform float soft; uniform float white;
void main(){
  vec3 c = texture(src, uv).rgb;
  vec2 p = (uv - 0.5) * vec2(size.x / size.y, 1.);
  float d = length(p) / length(vec2(size.x / size.y, 1.) * 0.5);
  float v = smoothstep(1. - reach, 1. - reach + soft + 0.01, d) * amount;
  o = vec4(white > 0.5 ? mix(c, vec3(1.), v) : c * (1. - v), 1.);
}`;

/** Light leaks: warm glows drifting in from the edges, like light getting into the camera. */
export const LEAKS = `${HEAD}
uniform float amount; uniform float speed; uniform float hue;
vec3 warm(float k){ return mix(vec3(1., 0.42, 0.12), vec3(1., 0.85, 0.35), k); }
void main(){
  vec3 c = texture(src, uv).rgb;
  vec2 p = uv * vec2(size.x / size.y, 1.);
  float t = time * speed;
  vec3 leak = vec3(0.);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 centre = vec2(0.5 + 0.9 * sin(t * (0.21 + fi * 0.07) + seed + fi * 2.1), 0.5 + 0.7 * cos(t * (0.17 + fi * 0.05) + fi * 1.3)) * vec2(size.x / size.y, 1.);
    float g = exp(-pow(length(p - centre) / (0.45 + 0.15 * fi), 2.));
    vec3 col = warm(fract(fi * 0.37 + hue));
    if (hue > 0.66) col = col.bgr;
    leak += col * g;
  }
  leak *= amount * (0.8 + 0.2 * sin(t * 1.7));
  o = vec4(clamp(1. - (1. - c) * (1. - leak), 0., 1.), 1.);
}`;

/** Gate weave: the picture jitters and drifts in the projector gate, with a flicker and dust. */
export const WEAVE = `${HEAD}
uniform float amount; uniform float flicker; uniform float dust;
void main(){
  float f = floor(time * 24.);
  vec2 drift = vec2(sin(time * 1.3 + seed) * 0.6 + sin(time * 3.7) * 0.3, cos(time * 1.1 + seed) * 0.6) ;
  vec2 jit = vec2(h(vec2(f, 1.)) - 0.5, h(vec2(f, 2.)) - 0.5);
  vec2 off = (drift * 0.6 + jit) * amount * 4. / size;
  vec3 c = texture(src, clamp(uv + off, 0., 1.)).rgb;
  c *= 1. + (h(vec2(f, 3.)) - 0.5) * flicker * 0.25;
  // a few specks and hairs of dust, new each frame
  vec2 cellp = floor(uv * vec2(48., 27.));
  float sp = h(cellp + f * 13.1);
  if (sp > 1. - dust * 0.02) {
    vec2 local = fract(uv * vec2(48., 27.)) - 0.5;
    if (length(local) < 0.18) c = mix(c, vec3(h(cellp) > 0.5 ? 0.95 : 0.05), 0.8);
  }
  o = vec4(clamp(c, 0., 1.), 1.);
}`;

/** DV tape: colour in blocks, over-sharp edges, interlaced lines and a cheap camcorder cast. */
export const DVCRUSH = `${HEAD}
uniform float amount; uniform float lines; uniform float res;
vec3 toYuv(vec3 c){ float y = lum(c); return vec3(y, (c.b - y) * 0.565, (c.r - y) * 0.713); }
vec3 toRgb(vec3 v){ float y = v.x; float r = y + 1.403 * v.z; float b = y + 1.770 * v.y; return vec3(r, (y - 0.299 * r - 0.114 * b) / 0.587, b); }
void main(){
  // lower resolution first
  vec2 px = vec2(max(1., res));
  vec2 u = (floor(uv * size / px) + 0.5) * px / size;
  // interlaced: every other line from a moment later (shifted a little)
  float row = floor(uv.y * size.y);
  if (lines > 0.5 && mod(row, 2.) > 0.5) u.x += 1.5 * amount / size.x;
  vec3 c = texture(src, u).rgb;
  vec3 v = toYuv(c);
  // colour shared by blocks of 4 pixels across (4:1:1)
  vec2 cu = (floor(uv * size / vec2(4. * px.x, px.y)) + 0.5) * vec2(4. * px.x, px.y) / size;
  vec3 cv = toYuv(texture(src, cu).rgb);
  v.yz = mix(v.yz, cv.yz, amount);
  // sharpening halo on the brightness
  float blur = (lum(texture(src, u + vec2(px.x, 0.) / size).rgb) + lum(texture(src, u - vec2(px.x, 0.) / size).rgb)) * 0.5;
  v.x += (v.x - blur) * amount * 1.2;
  vec3 col = toRgb(v);
  col = mix(col, col * vec3(0.97, 1.03, 0.98) + vec3(0., 0.01, 0.), amount);
  o = vec4(clamp(col, 0., 1.), 1.);
}`;

/** Light trails: bright things leave a fading trail (needs the last output as `prev`). */
export const TRAILS = `${HEAD}
uniform sampler2D prev; uniform float decay; uniform float add;
void main(){
  vec3 c = texture(src, uv).rgb;
  vec3 p = texture(prev, uv).rgb * decay;
  o = vec4(add > 0.5 ? clamp(c + p * 0.5, 0., 1.) : max(c, p), 1.);
}`;

/** Ink and paper colours for the 1-bit look. */
export const INKS: Record<string, [number[], number[]]> = {
  bw: [[0.05, 0.05, 0.05], [0.97, 0.96, 0.93]],
  red: [[0.85, 0.08, 0.1], [0.98, 0.95, 0.9]],
  blue: [[0.1, 0.2, 0.75], [0.96, 0.94, 0.88]],
  lime: [[0.05, 0.05, 0.05], [0.78, 0.98, 0.25]],
  pink: [[0.3, 0.05, 0.25], [1, 0.7, 0.86]],
  night: [[0.95, 0.95, 0.95], [0.02, 0.02, 0.05]],
};
