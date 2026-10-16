// Retro looks: shaders for old tape, old screens, film and cheap colour (pixel effects, after the
// mosh). Each takes `src`, the picture size in pixels and the time in seconds (for movement and
// noise that changes every frame).

const NOISE = `
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed * 7.31) * 43758.5453); }
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }`;

/** VHS: wobbling lines, a tracking band, colour that bleeds to the right, tape noise. */
export const VHS = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D src; uniform vec2 size; uniform float time; uniform float seed;
uniform float tracking; uniform float bleed; uniform float noise; uniform float wobble; uniform float colour;
${NOISE}
void main(){
  vec2 u = uv;
  float y = 1. - uv.y;
  float row = floor(y * size.y);
  u.x += wobble * 0.003 * sin(y * 37. + time * 2.7) + wobble * 0.0015 * (h(vec2(row, floor(time * 12.))) - 0.5);
  // the tracking band rolls up the picture
  float band = 1. - fract(time * 0.11);
  float d = abs(y - band);
  if (tracking > 0. && d < 0.05 * tracking) u.x += (h(vec2(row, 1.)) - 0.5) * 0.06 * tracking * (1. - d / (0.05 * tracking));
  // head switching at the bottom
  if (tracking > 0. && y > 1. - 0.025 * tracking) u.x += (h(vec2(row, 2.)) - 0.5) * 0.04;
  vec3 c = texture(src, u).rgb;
  // colour smears to the right of the sharp picture
  vec3 ch = vec3(0.);
  for (int i = 0; i < 6; i++) ch += texture(src, u - vec2(bleed / size.x * float(i) / 5., 0.)).rgb;
  ch /= 6.;
  float l = lum(c);
  vec3 col = vec3(l) + (ch - vec3(lum(ch))) * colour;
  // tape noise, and the odd white speck
  col += (h(uv * size + time) - 0.5) * noise * 0.3;
  if (h(vec2(row, floor(time * 24.))) > 1. - noise * 0.004) col += vec3(0.6) * h(vec2(uv.x * size.x, row));
  o = vec4(clamp(col, 0., 1.), 1.);
}`;

/** CRT: a curved glass screen with scanlines, a shadow mask, glow and dark corners. */
export const CRT = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D src; uniform vec2 size; uniform float time; uniform float seed;
uniform float curve; uniform float scan; uniform float mask; uniform float glow; uniform float vignette;
${NOISE}
void main(){
  vec2 c = uv * 2. - 1.;
  c *= 1. + curve * 0.35 * (c.yx * c.yx);
  vec2 u = c * 0.5 + 0.5;
  if (u.x < 0. || u.x > 1. || u.y < 0. || u.y > 1.) { o = vec4(0., 0., 0., 1.); return; }
  vec3 col = texture(src, u).rgb;
  // glow: a soft copy of the bright parts
  vec2 px = 2.5 / size;
  vec3 g = (texture(src, u + vec2(px.x, 0.)).rgb + texture(src, u - vec2(px.x, 0.)).rgb + texture(src, u + vec2(0., px.y)).rgb + texture(src, u - vec2(0., px.y)).rgb) * 0.25;
  col += max(g - 0.5, 0.) * glow * 1.5;
  // scanlines (every other line of the picture) and the red / green / blue stripes of the mask
  float line = 0.5 + 0.5 * cos(u.y * size.y * 3.14159265);
  col *= 1. - scan * 0.6 * (1. - line);
  float k = mod(floor(gl_FragCoord.x), 3.);
  vec3 stripes = vec3(k < 0.5 ? 1. : 0.35, k > 0.5 && k < 1.5 ? 1. : 0.35, k > 1.5 ? 1. : 0.35);
  col *= mix(vec3(1.), stripes * 1.35, mask);
  col *= 1. - vignette * dot(c * 0.7, c * 0.7);
  col *= 1. + 0.015 * sin(time * 50.);
  o = vec4(clamp(col, 0., 1.), 1.);
}`;

/** Film grain: noise that sits in the midtones, in grains of a set size. */
export const GRAIN = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D src; uniform vec2 size; uniform float time; uniform float seed;
uniform float amount; uniform float grain; uniform float colour; uniform float fade;
${NOISE}
void main(){
  vec3 c = texture(src, uv).rgb;
  vec2 cell = floor(uv * size / max(1., grain)) + floor(time * 24.) * 17.;
  float n = h(cell) - 0.5;
  vec3 nc = colour > 0.5 ? vec3(n, h(cell + 3.1) - 0.5, h(cell + 7.7) - 0.5) : vec3(n);
  float l = lum(c);
  c += nc * amount * 0.5 * (1. - abs(l - 0.5) * 1.2);
  // faded film: lifted blacks, softer whites
  c = mix(c, c * 0.88 + 0.07, fade);
  o = vec4(clamp(c, 0., 1.), 1.);
}`;

/** Posterise: few levels per colour, with an ordered (Bayer) or noise dither between them. */
export const POSTERIZE = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D src; uniform vec2 size; uniform float time; uniform float seed;
uniform float levels; uniform float dither; uniform float pixel; uniform float mixAmt;
${NOISE}
float bayer(vec2 p){
  int x = int(mod(p.x, 4.)); int y = int(mod(p.y, 4.));
  int m[16] = int[](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return float(m[y * 4 + x]) / 16. - 0.5;
}
void main(){
  // bigger pixels first, if asked
  vec2 cellPx = vec2(max(1., pixel));
  vec2 u = (floor(uv * size / cellPx) + 0.5) * cellPx / size;
  vec3 c = texture(src, u).rgb;
  vec2 p = floor(uv * size / cellPx);
  float d = dither < 0.5 ? 0. : dither < 1.5 ? bayer(p) : h(p) - 0.5;
  float n = max(2., levels) - 1.;
  vec3 q = floor(c * n + 0.5 + d) / n;
  o = vec4(mix(texture(src, uv).rgb, clamp(q, 0., 1.), mixAmt), 1.);
}`;
