// The landing page's mosh pad: a tiny datamosher on the GPU. Every new video frame, it finds how
// each 16 px block moved since the last frame (block matching, like an encoder), then rebuilds the
// picture from its own previous output plus that motion and the leftover difference, like a
// decoder. With keyframes killed, the frames at the cuts are dropped, so the next shot's motion
// drags the old picture around. Dragging adds motion of your own; Bloom repeats the last frame.

const W = 480;
const H = 270;
const B = 16;
const BW = Math.ceil(W / B);
const BH = Math.ceil(H / B);
/** where the shots change in site/before.webm (seconds) */
const CUTS = [2.5, 5.0];
const FPS = 24;
/** furthest a pushed block moves per frame (px) */
const PUSH_MAX = 24;

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
const ivec2 SIZE = ivec2(${W}, ${H});
ivec2 cl(ivec2 q) { return clamp(q, ivec2(0), SIZE - 1); }
`;

// One fragment per block: the offset into the previous frame that best explains this block now.
const MOTION = `${HEAD}
uniform sampler2D cur, prev;
float sad(ivec2 base, ivec2 d) {
  float s = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    ivec2 q = base + ivec2(i * 4 + 2, j * 4 + 2);
    s += dot(abs(texelFetch(cur, cl(q), 0).rgb - texelFetch(prev, cl(q + d), 0).rgb), vec3(1.0));
  }
  return s + 0.004 * float(abs(d.x) + abs(d.y));
}
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * ${B};
  ivec2 best = ivec2(0);
  float b = sad(base, best);
  for (int y = -12; y <= 12; y += 3) for (int x = -12; x <= 12; x += 3) {
    float s = sad(base, ivec2(x, y));
    if (s < b) { b = s; best = ivec2(x, y); }
  }
  ivec2 c = best;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    float s = sad(base, c + ivec2(x, y));
    if (s < b) { b = s; best = c + ivec2(x, y); }
  }
  o = vec4((vec2(best) + 128.0) / 255.0, 0.0, 1.0);
}`;

// The decoder. mode 0: a keyframe (the clean picture); 1: a motion frame; 2: only your push.
const MOSH = `${HEAD}
uniform sampler2D cur, prev, back, motion, push;
uniform int mode;
uniform float glitch, seed;
float hash(vec2 v) { return fract(sin(dot(v, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
ivec2 vec(sampler2D t, ivec2 b) { return ivec2(round(texelFetch(t, b, 0).xy * 255.0 - 128.0)); }
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  ivec2 b = q / ${B};
  if (mode == 0) { o = texelFetch(cur, q, 0); return; }
  ivec2 u = vec(push, b);
  if (mode == 2) { o = texelFetch(back, cl(q + u), 0); return; }
  ivec2 mv = vec(motion, b);
  vec3 ref = texelFetch(back, cl(q + mv + u), 0).rgb;
  // what the encoder would have sent besides the motion: small, so the old picture survives it
  vec3 res = texelFetch(cur, q, 0).rgb - texelFetch(prev, cl(q + mv), 0).rgb;
  vec3 c = ref + clamp(res * 0.9, -0.14, 0.14);
  float h = hash(vec2(b));
  if (h < glitch) {
    // damaged blocks: borrowed from somewhere else, colours turned around
    ivec2 far = ivec2(vec2(hash(vec2(b) + 1.7), hash(vec2(b) + 4.1)) * vec2(SIZE));
    c = texelFetch(back, cl(far + q % ${B}), 0).gbr;
    if (h < glitch * 0.3) c = vec3(hash(vec2(b.y)), hash(vec2(b.x)), 0.5) * 1.2;
  }
  o = vec4(c, 1.0);
}`;

const SHOW = `${HEAD}
uniform sampler2D src;
uniform vec2 out_size;
void main() {
  vec2 uv = gl_FragCoord.xy / out_size;
  o = texture(src, vec2(uv.x, 1.0 - uv.y));
}`;

export interface PadUi {
  /** called with the frame type shown ('I', 'P', 'P ×n' while blooming, '—' for a dropped I) */
  frame(type: string, timecode: string, mvAvg: number, sinceI: number): void;
  /** a keyframe at a cut was dropped */
  melt(): void;
  /** the browser wouldn't start the video by itself (it needs a tap first) */
  blocked(): void;
}

export interface Pad {
  start(): void;
  stop(): void;
  setKill(on: boolean): void;
  setBloom(on: boolean): void;
  glitch(): void;
  keyframe(): void;
  /** push the blocks around a point (picture coordinates, 0–1) by (dx, dy) picture pixels */
  pushAt(x: number, y: number, dx: number, dy: number): void;
}

function compile(gl: WebGL2RenderingContext, frag: string): WebGLProgram {
  const prog = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VERT],
    [gl.FRAGMENT_SHADER, frag],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(prog, s);
  }
  gl.bindAttribLocation(prog, 0, 'p');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  return prog;
}

/** null when this browser has no WebGL 2 (the page then shows a moshed video instead) */
export function createPad(canvas: HTMLCanvasElement, video: HTMLVideoElement, ui: PadUi): Pad | null {
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  let progs: { motion: WebGLProgram; mosh: WebGLProgram; show: WebGLProgram };
  try {
    progs = { motion: compile(gl, MOTION), mosh: compile(gl, MOSH), show: compile(gl, SHOW) };
  } catch (e) {
    console.warn('mosh pad:', e);
    return null;
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const tex = (w: number, h: number, filter: number = gl.NEAREST) => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const target = (t: WebGLTexture) => {
    const f = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return f;
  };
  // video frames (current and previous), the decoder's output (ping-pong), motion and your push
  const frames = [tex(W, H), tex(W, H)];
  const outs = [tex(W, H, gl.LINEAR), tex(W, H, gl.LINEAR)];
  const outFb = outs.map(target);
  const motion = tex(BW, BH);
  const motionFb = target(motion);
  const push = tex(BW, BH);
  const pushField = new Float32Array(BW * BH * 2);
  // 128 is no movement
  const pushBytes = new Uint8Array(BW * BH * 4).fill(128);
  gl.bindTexture(gl.TEXTURE_2D, push);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.UNSIGNED_BYTE, pushBytes);
  let cur = 0;
  let out = 0;

  const loc = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
  const bind = (p: WebGLProgram, units: Record<string, WebGLTexture>) => {
    gl.useProgram(p);
    Object.entries(units).forEach(([name, t], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(loc(p, name), i);
    });
  };
  const draw = (fb: WebGLFramebuffer | null, w: number, h: number) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // the average motion this frame, for the readout (read back from the small motion texture)
  const mvBytes = new Uint8Array(BW * BH * 4);
  const measure = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, motionFb);
    gl.readPixels(0, 0, BW, BH, gl.RGBA, gl.UNSIGNED_BYTE, mvBytes);
    let s = 0;
    for (let i = 0; i < BW * BH; i++) s += Math.hypot(mvBytes[i * 4] - 128, mvBytes[i * 4 + 1] - 128);
    return s / (BW * BH);
  };

  let kill = true;
  let bloom = false;
  let bloomCount = 0;
  let glitchFrames = 0;
  let sinceI = 0;
  let mvAvg = 0;
  let pushing = false;
  let lastTime = -1;
  let haveFrame = false;
  let running = false;
  let raf = 0;
  let lastBloom = 0;

  const uploadPush = () => {
    let any = false;
    for (let i = 0; i < BW * BH; i++) {
      const x = (pushField[i * 2] *= 0.86);
      const y = (pushField[i * 2 + 1] *= 0.86);
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) {
        pushField[i * 2] = pushField[i * 2 + 1] = 0;
      } else any = true;
      // the shader moves a block by the vector it finds there: it reads from q + u, so negate
      pushBytes[i * 4] = 128 - Math.round(pushField[i * 2]);
      pushBytes[i * 4 + 1] = 128 - Math.round(pushField[i * 2 + 1]);
    }
    gl.bindTexture(gl.TEXTURE_2D, push);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.UNSIGNED_BYTE, pushBytes);
    pushing = any;
  };

  const mosh = (mode: number) => {
    const p = progs.mosh;
    bind(p, { cur: frames[cur], prev: frames[1 - cur], back: outs[out], motion, push });
    gl.uniform1i(loc(p, 'mode'), mode);
    gl.uniform1f(loc(p, 'glitch'), glitchFrames > 0 ? 0.015 + glitchFrames * 0.005 : 0);
    gl.uniform1f(loc(p, 'seed'), Math.random() * 100);
    if (glitchFrames > 0) glitchFrames--;
    out = 1 - out;
    draw(outFb[out], W, H);
  };

  const show = () => {
    const p = progs.show;
    bind(p, { src: outs[out] });
    gl.uniform2f(loc(p, 'out_size'), canvas.width, canvas.height);
    draw(null, canvas.width, canvas.height);
  };

  const tc = (t: number) => {
    const f = Math.floor(t * FPS);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `00:00:${pad(Math.floor(f / FPS))}:${pad(f % FPS)}`;
  };

  /** a new frame from the video: estimate its motion, then decode it (or drop it) */
  const step = (t: number) => {
    cur = 1 - cur;
    gl.bindTexture(gl.TEXTURE_2D, frames[cur]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, video);
    // (currentTime can step back a frame now and then: only a big jump back is the loop)
    const looped = t < lastTime - 1;
    const atCut = !looped && lastTime >= 0 && CUTS.some((c) => lastTime < c && t >= c - 0.5 / FPS);
    lastTime = t;
    if (!haveFrame || looped) {
      // the first frame of the file is always a keyframe
      haveFrame = true;
      sinceI = 0;
      mosh(0);
      ui.frame('I', tc(t), 0, 0);
      return;
    }
    if (atCut && kill) {
      // the keyframe is dropped: the old picture stays, and the new shot's motion lands on it
      ui.melt();
      ui.frame('—', tc(t), mvAvg, ++sinceI);
      return;
    }
    if (atCut) {
      sinceI = 0;
      mosh(0);
      ui.frame('I', tc(t), 0, 0);
      return;
    }
    bind(progs.motion, { cur: frames[cur], prev: frames[1 - cur] });
    draw(motionFb, BW, BH);
    mvAvg = measure();
    mosh(1);
    ui.frame('P', tc(t), mvAvg, ++sinceI);
  };

  const tick = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (pushing) uploadPush();
    let drew = false;
    if (bloom) {
      // repeat the same motion frame, about as often as the video's own frames
      if (now - lastBloom > 1000 / FPS && haveFrame) {
        lastBloom = now;
        mosh(1);
        ui.frame(`P ×${++bloomCount}`, tc(lastTime), mvAvg, sinceI);
        drew = true;
      }
    } else if (video.readyState >= 2) {
      // one step per frame of the video (the page redraws more often than the video changes)
      const t = Math.round(video.currentTime * FPS) / FPS;
      if (t !== lastTime) {
        step(t);
        drew = true;
      }
    }
    if (!drew && (pushing || glitchFrames > 0) && haveFrame) {
      mosh(2);
      drew = true;
    }
    if (drew) show();
  };

  return {
    start() {
      if (running) return;
      running = true;
      if (!bloom)
        video.play().catch((e: DOMException) => {
          if (e.name === 'NotAllowedError') ui.blocked();
        });
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      video.pause();
    },
    setKill(on) {
      kill = on;
    },
    setBloom(on) {
      if (on === bloom) return;
      bloom = on;
      bloomCount = 0;
      if (on) video.pause();
      else if (running) video.play().catch(() => {});
    },
    glitch() {
      glitchFrames = 10;
    },
    keyframe() {
      if (!haveFrame) return;
      pushField.fill(0);
      uploadPush();
      sinceI = 0;
      mosh(0);
      show();
      ui.frame('I', tc(lastTime), 0, 0);
    },
    pushAt(x, y, dx, dy) {
      const bx = x * BW;
      const by = y * BH;
      const r = 2.6;
      for (let j = Math.max(0, Math.floor(by - r)); j < Math.min(BH, Math.ceil(by + r)); j++)
        for (let i = Math.max(0, Math.floor(bx - r)); i < Math.min(BW, Math.ceil(bx + r)); i++) {
          const d = Math.hypot(i + 0.5 - bx, j + 0.5 - by) / r;
          if (d >= 1) continue;
          const k = (1 - d * d) * 0.9;
          const n = (j * BW + i) * 2;
          pushField[n] = Math.max(-PUSH_MAX, Math.min(PUSH_MAX, pushField[n] + dx * k));
          pushField[n + 1] = Math.max(-PUSH_MAX, Math.min(PUSH_MAX, pushField[n + 1] + dy * k));
        }
      pushing = true;
    },
  };
}
