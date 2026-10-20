// Pixel / flow effects run on decoded frames (after the bitstream mosh).
import type { PixelEffectDef } from './types';
import { BEND_MODES } from '../dsp';

const PIXEL_HINTS: Record<string, string> = {
  echo: 'Every colour value is mixed with one a Delay back along the row: ghost copies and diagonal streaks.',
  reverb: 'Many echoes blurred together: washed-out colour smears.',
  phaser: 'A sweeping filter: rippling colour bands.',
  crush: 'Fewer levels per colour: hard posterised steps.',
  reverse: 'Runs of pixels flipped end to end (each run is Delay long).',
  gain: 'Colours turned up until they overflow and wrap: neon tearing.',
};

export const vectorWarp: PixelEffectDef = {
  kind: 'pixel',
  type: 'vectorWarp',
  name: 'Vector Warp',
  icon: 'WRP',
  color: '#6aa8e8',
  description: 'GPU flow engine. Measures motion between frames, lets you bend it, and drags a persistent image along with it.',
  params: [
    { key: 'amplify', label: 'Amplify', type: 'number', min: -6, max: 6, step: 0.05, default: 1.5, intensity: 'up', help: 'Multiplies motion. Negative values make things flow backwards.' },
    { key: 'rotate', label: 'Rotate', type: 'number', min: -180, max: 180, step: 1, default: 0, unit: '°', help: 'Rotates every motion vector, so things move sideways to their real motion.' },
    { key: 'swap', label: 'Swap X/Y', type: 'bool', default: false, help: 'Horizontal motion becomes vertical and vice versa.' },
    { key: 'drift', label: 'Drift X', type: 'number', min: -8, max: 8, step: 0.1, default: 0, unit: 'px', help: 'Constant sideways flow added everywhere.' },
    { key: 'driftY', label: 'Drift Y', type: 'number', min: -8, max: 8, step: 0.1, default: 0, unit: 'px', help: 'Constant vertical flow (gravity) added everywhere.' },
    { key: 'turbulence', label: 'Turbulence', type: 'number', min: 0, max: 8, step: 0.1, default: 0, intensity: 'up', help: 'Swirly noise added to the vectors.' },
    { key: 'quantize', label: 'Quantise', type: 'number', min: 0, max: 8, step: 0.5, default: 0, unit: 'px', help: 'Snaps vectors to a grid for blocky, stepped motion.', advanced: true },
    { key: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 4, step: 0.1, default: 0.3, intensity: 'down', help: 'Ignores motion smaller than this, so only big movements smear.', advanced: true },
    { key: 'block', label: 'Block size', type: 'select', default: '8', options: ['4', '8', '16', '32'].map((v) => ({ value: v, label: `${v}px` })), help: 'Motion is measured per block. Big blocks look chunky and codec-like; small blocks look liquid.' },
    { key: 'search', label: 'Search range', type: 'int', min: 1, max: 24, default: 8, unit: 'px', help: 'Largest motion that can be detected per frame.', advanced: true },
    { key: 'smooth', label: 'Smooth vectors', type: 'bool', default: false, help: 'Blend vectors between blocks for silky flow instead of blocky moves.' },
    { key: 'residual', label: 'Residual', type: 'number', min: 0, max: 1, step: 0.01, default: 0.15, intensity: 'down', help: 'How much of the real new detail leaks in each frame (like a codec\'s correction data). 0 = pure smear.' },
    { key: 'refresh', label: 'Refresh', type: 'number', min: 0, max: 1, step: 0.01, default: 0, intensity: 'down', help: 'Blends back toward the clean video each frame. Higher values give shorter trails.' },
    { key: 'mix', label: 'Mix', type: 'number', min: 0, max: 1, step: 0.01, default: 1, help: 'Wet/dry mix with the un-warped frame.' },
  ],
};

export const chromaDrift: PixelEffectDef = {
  kind: 'pixel',
  type: 'chroma',
  name: 'Chroma Drift',
  icon: 'CHR',
  color: '#d77a9a',
  description: 'Offsets the red, green and blue channels, with optional jitter and line tearing.',
  params: [
    { key: 'offset', label: 'Offset', type: 'number', min: 0, max: 40, step: 0.5, default: 6, intensity: 'up', unit: 'px', help: 'How far the channels separate.' },
    { key: 'angle', label: 'Angle', type: 'number', min: -180, max: 180, step: 1, default: 0, unit: '°', help: 'Direction of the split.' },
    { key: 'wobble', label: 'Wobble', type: 'number', min: 0, max: 1, step: 0.01, default: 0.2, intensity: 'up', help: 'Random per-frame jitter of the split.' },
    { key: 'scanTear', label: 'Scanline tear', type: 'number', min: 0, max: 40, step: 0.5, default: 0, intensity: 'up', unit: 'px', help: 'Random horizontal line displacement.' },
  ],
};

export const pixelSort: PixelEffectDef = {
  kind: 'pixel',
  type: 'pixelSort',
  name: 'Pixel Sort',
  icon: 'SRT',
  color: '#c9946a',
  description: 'Sorts runs of pixels by brightness between two thresholds.',
  params: [
    { key: 'low', label: 'Low threshold', type: 'number', min: 0, max: 1, step: 0.01, default: 0.25, help: 'Pixels darker than this break a run.' },
    { key: 'high', label: 'High threshold', type: 'number', min: 0, max: 1, step: 0.01, default: 0.85, help: 'Pixels brighter than this break a run.' },
    {
      key: 'direction',
      label: 'Direction',
      type: 'select',
      default: 'vertical',
      options: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
      ],
      help: 'Direction of the streaks.',
    },
    { key: 'reverse', label: 'Reverse order', type: 'bool', default: false, help: 'Sort bright to dark instead.' },
  ],
};

export const rawBend: PixelEffectDef = {
  kind: 'pixel',
  type: 'rawbend',
  name: 'Raw Bend',
  icon: 'RAW',
  color: '#9fd48a',
  description: 'Treats the picture\'s red, green and blue values as one long sound and runs an audio effect over it: echo gives diagonal ghosts, reverb smears colour, phaser bands, bitcrush posterises.',
  params: [
    { key: 'mode', label: 'Effect', type: 'select', default: 'echo', options: BEND_MODES.map((m) => ({ ...m, hint: PIXEL_HINTS[m.value] })), help: 'Which audio effect the pixels go through.' },
    { show: (p) => p.mode !== 'crush' && p.mode !== 'gain', key: 'delay', label: 'Delay', type: 'int', min: 1, max: 4096, default: 160, unit: 'px', log: true, help: 'Echo delay, reverb size, phaser speed or reverse chunk, in pixels along each row. Around the frame width gives diagonal smears.' },
    { show: (p) => ['echo', 'reverb', 'phaser'].includes(String(p.mode)), key: 'feedback', label: 'Feedback', type: 'number', min: 0, max: 0.98, step: 0.01, default: 0.55, intensity: 'up', help: 'How much the effect feeds back into itself.' },
    { show: (p) => p.mode === 'crush', key: 'bits', label: 'Bits', type: 'int', min: 1, max: 8, default: 3, intensity: 'down', help: 'Bits kept per colour value.' },
    { show: (p) => p.mode === 'gain', key: 'gain', label: 'Gain', type: 'number', min: 1, max: 16, step: 0.1, default: 1.8, intensity: 'up', help: 'How far the picture is turned up.' },
    { show: (p) => p.mode === 'gain', key: 'wrap', label: 'Wrap around', type: 'bool', default: true, help: 'Overflowing colours wrap round (neon tearing) instead of clipping to white.' },
    { key: 'mix', label: 'Mix', type: 'number', min: 0, max: 1, step: 0.01, default: 0.6, intensity: 'up', help: 'Dry/wet mix.' },
  ],
};

export const subjectGuard: PixelEffectDef = {
  kind: 'pixel',
  type: 'mask',
  name: 'Subject Guard',
  icon: 'SUB',
  color: '#e8e2d0',
  description: 'Keeps part of the picture clean while the rest moshes: a person, a tracked object, the bright or dark parts, or a colour. Put it last in the stack. Or flip it, so only the subject melts.',
  params: [
    {
      key: 'source',
      label: 'Subject',
      type: 'select',
      default: 'person',
      options: [
        { value: 'person', label: 'People', hint: 'Finds people in the clean footage with a small AI model that runs on this device (downloaded once).' },
        { value: 'cutout', label: 'A cut-out subject', hint: 'The subject you cut out of the footage (Clip tab › Cut out a subject): it stays clean while the rest moshes.' },
        { value: 'track', label: 'A tracked object', hint: 'An oval around the box you tracked, following it (select the clip, then Clip tab › Track an object).' },
        { value: 'luma', label: 'Bright parts', hint: 'Everything brighter than the threshold. Lower the threshold to keep more.' },
        { value: 'dark', label: 'Dark parts', hint: 'Everything darker than the threshold.' },
        { value: 'chroma', label: 'A colour', hint: 'Everything close to a colour (pick it below).' },
        { value: 'gradient', label: 'Map: a gradient', hint: 'A fade across the picture: clean on one side, moshed on the other. Automate its position to sweep the mosh across.' },
        { value: 'paint', label: 'Map: paint it', hint: 'Paint on the player where the picture stays clean.' },
        { value: 'media', label: 'Map: a picture or video', hint: 'A picture or video from the project, in grey: white stays clean, black moshes. Videos loop.' },
        { value: 'depth', label: 'Map: depth', hint: 'How near things are, from a small AI model that runs on this device (downloaded once): near stays clean, far moshes.' },
      ],
      help: 'What counts as the subject. The maps blend: grey parts mosh half way.',
    },
    {
      key: 'keep',
      label: 'Keep clean',
      type: 'select',
      default: 'subject',
      options: [
        { value: 'subject', label: 'The subject', hint: 'The subject stays sharp while the world around it melts.' },
        { value: 'background', label: 'Everything else', hint: 'Only the subject moshes; the background stays clean.' },
      ],
      help: 'Which side of the mask is protected from the mosh.',
    },
    { show: (p) => p.source === 'luma' || p.source === 'dark' || p.source === 'chroma', key: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 1, step: 0.01, default: 0.55, help: 'Where the mask starts (brightness, or distance from the colour).' },
    {
      show: (p) => p.source === 'gradient',
      key: 'shape',
      label: 'Gradient',
      type: 'select',
      default: 'linear',
      options: [
        { value: 'linear', label: 'Linear', hint: 'A straight fade across the picture.' },
        { value: 'radial', label: 'Radial', hint: 'A circle: clean in the middle, moshed around it.' },
      ],
      help: 'The shape of the fade.',
    },
    { show: (p) => p.source === 'gradient' && p.shape !== 'radial', key: 'angle', label: 'Angle', type: 'number', min: -180, max: 180, step: 1, default: 0, unit: '°', help: 'Which way the fade runs (0°: clean on the left).' },
    { show: (p) => p.source === 'gradient', key: 'gx', label: 'Centre X', type: 'number', min: -0.5, max: 1.5, step: 0.01, default: 0.5, help: 'Where the middle of the fade is, across. Automate it to sweep.' },
    { show: (p) => p.source === 'gradient', key: 'gy', label: 'Centre Y', type: 'number', min: -0.5, max: 1.5, step: 0.01, default: 0.5, help: 'Where the middle of the fade is, down.' },
    { show: (p) => p.source === 'gradient', key: 'spread', label: 'Spread', type: 'number', min: 0.02, max: 2, step: 0.01, default: 0.5, help: 'How wide the fade is (radial: the size of the clean circle).' },
    { show: (p) => p.source === 'track', key: 'scale', label: 'Oval size', type: 'number', min: 0.3, max: 4, step: 0.05, default: 1.4, unit: '×', help: 'Size of the oval compared with the box you drew when tracking (1.4 just covers its corners).' },
    { key: 'feather', label: 'Feather', type: 'number', min: 0, max: 0.2, step: 0.005, default: 0.03, help: 'Soft edge, as a share of the frame.' },
    { key: 'expand', label: 'Grow / shrink', type: 'number', min: -0.4, max: 0.4, step: 0.01, default: 0.05, help: 'Grows (+) or shrinks (−) the subject a little.' },
    { key: 'mix', label: 'Strength', type: 'number', min: 0, max: 1, step: 0.01, default: 1, intensity: 'down', help: 'How much of the clean picture comes back. Lower values let some mosh bleed into the subject.' },
  ],
};

export const flowPaint: PixelEffectDef = {
  kind: 'pixel',
  type: 'flowPaint',
  name: 'Flow Paint',
  icon: 'PNT',
  color: '#7ec4e0',
  description: 'Paint where the picture should flow: brush strokes push, swirl, pinch or bulge the image, and it smears along them like a P-frame bloom. Select it and paint on the player.',
  params: [
    { key: 'strength', label: 'Strength', type: 'number', min: 0, max: 4, step: 0.05, default: 1, intensity: 'up', help: 'Multiplies every painted stroke.' },
    { key: 'follow', label: 'Real motion', type: 'number', min: -3, max: 3, step: 0.05, default: 0, help: 'How much of the footage\'s own motion is added to the painted flow (0 = only the paint).' },
    { key: 'residual', label: 'Residual', type: 'number', min: 0, max: 1, step: 0.01, default: 0.08, intensity: 'down', help: 'How much real new detail leaks in each frame. 0 = pure smear.' },
    { key: 'refresh', label: 'Refresh', type: 'number', min: 0, max: 1, step: 0.01, default: 0, intensity: 'down', help: 'Blends back toward the clean video each frame (shorter trails).' },
    { key: 'turbulence', label: 'Turbulence', type: 'number', min: 0, max: 8, step: 0.1, default: 0, intensity: 'up', help: 'Swirly noise on top of the paint.' },
  ],
};

// ---------- retro looks (shaders in src/lib/retro.ts) ----------

export const vhs: PixelEffectDef = {
  kind: 'pixel',
  type: 'vhs',
  name: 'VHS',
  icon: 'VHS',
  color: '#c98fd6',
  description: 'An old tape: lines that wobble, a tracking band rolling up the picture, colour bleeding to the right and tape noise.',
  params: [
    { key: 'tracking', label: 'Tracking', type: 'number', min: 0, max: 1, step: 0.01, default: 0.4, intensity: 'up', help: 'The band of torn lines rolling up the picture, and the noise at the bottom.' },
    { key: 'bleed', label: 'Colour bleed', type: 'number', min: 0, max: 30, step: 0.5, default: 8, unit: 'px', intensity: 'up', help: 'How far colour smears to the right of the picture.' },
    { key: 'wobble', label: 'Wobble', type: 'number', min: 0, max: 2, step: 0.01, default: 0.6, intensity: 'up', help: 'Lines drifting from side to side.' },
    { key: 'noise', label: 'Noise', type: 'number', min: 0, max: 1, step: 0.01, default: 0.25, intensity: 'up', help: 'Tape hiss in the picture, and white specks.' },
    { key: 'colour', label: 'Colour', type: 'number', min: 0, max: 2, step: 0.01, default: 0.85, help: 'How much colour is left (below 1: washed out).' },
  ],
};

export const crt: PixelEffectDef = {
  kind: 'pixel',
  type: 'crt',
  name: 'CRT',
  icon: 'CRT',
  color: '#8fd6b4',
  description: 'An old screen: curved glass, scanlines, red-green-blue stripes, glow and dark corners.',
  params: [
    { key: 'curve', label: 'Curve', type: 'number', min: 0, max: 1, step: 0.01, default: 0.4, help: 'How much the glass bulges.' },
    { key: 'scan', label: 'Scanlines', type: 'number', min: 0, max: 1, step: 0.01, default: 0.6, intensity: 'up', help: 'Dark lines between the picture\'s lines.' },
    { key: 'mask', label: 'Stripes', type: 'number', min: 0, max: 1, step: 0.01, default: 0.35, intensity: 'up', help: 'The red, green and blue stripes of the screen.' },
    { key: 'glow', label: 'Glow', type: 'number', min: 0, max: 1, step: 0.01, default: 0.4, help: 'Bright parts bloom.' },
    { key: 'vignette', label: 'Dark corners', type: 'number', min: 0, max: 1, step: 0.01, default: 0.4, help: 'Corners fade to black.' },
  ],
};

export const grain: PixelEffectDef = {
  kind: 'pixel',
  type: 'grain',
  name: 'Film Grain',
  icon: 'GRN',
  color: '#d6c08f',
  description: 'Film grain that dances every frame, strongest in the midtones, with an optional faded-film look.',
  params: [
    { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 1, step: 0.01, default: 0.35, intensity: 'up', help: 'How strong the grain is.' },
    { key: 'grain', label: 'Grain size', type: 'number', min: 1, max: 6, step: 0.1, default: 1.5, unit: 'px', help: 'Size of each grain.' },
    { key: 'colour', label: 'Colour grain', type: 'bool', default: false, help: 'Each colour gets its own grain (like colour film) instead of the same for all.' },
    { key: 'fade', label: 'Faded', type: 'number', min: 0, max: 1, step: 0.01, default: 0.2, help: 'Lifts the blacks and softens the whites, like old prints.' },
  ],
};

export const posterize: PixelEffectDef = {
  kind: 'pixel',
  type: 'posterize',
  name: 'Posterise',
  icon: 'PST',
  color: '#e0a36a',
  description: 'Only a few levels per colour, with a retro dither pattern between them, and chunky pixels if you like.',
  params: [
    { key: 'levels', label: 'Levels', type: 'int', min: 2, max: 16, default: 4, intensity: 'down', help: 'Levels per colour: 2 is harsh, 8 is subtle.' },
    {
      key: 'dither',
      label: 'Dither',
      type: 'select',
      default: 'bayer',
      options: [
        { value: 'none', label: 'None', hint: 'Flat bands of colour.' },
        { value: 'bayer', label: 'Pattern', hint: 'An ordered crosshatch, like old computers.' },
        { value: 'noise', label: 'Noise', hint: 'Random speckle between the levels.' },
      ],
      help: 'How the in-between colours are faked.',
    },
    { key: 'pixel', label: 'Pixel size', type: 'int', min: 1, max: 16, default: 1, unit: 'px', intensity: 'up', help: 'Draws the picture in bigger pixels first.' },
    { key: 'mix', label: 'Mix', type: 'number', min: 0, max: 1, step: 0.01, default: 1, help: 'Dry/wet mix.' },
  ],
};


// ---------- film and print looks (shaders in src/lib/looks.ts) ----------

const MIX = { key: 'mix', label: 'Mix', type: 'number' as const, min: 0, max: 1, step: 0.01, default: 1, help: 'Dry/wet mix.' };

export const threshold: PixelEffectDef = {
  kind: 'pixel',
  type: 'threshold',
  name: '1-bit',
  icon: '1BT',
  color: '#e8e8e8',
  description: 'Every pixel becomes ink or paper: a hard photocopy or risograph look, in black and white or a coloured ink.',
  params: [
    { key: 'level', label: 'Level', type: 'number', min: 0.05, max: 0.95, step: 0.01, default: 0.5, intensity: 'up', help: 'How bright a pixel must be to be paper (higher: more ink).' },
    { key: 'soft', label: 'Softness', type: 'number', min: 0, max: 0.3, step: 0.005, default: 0.02, help: 'A soft edge between ink and paper.' },
    { key: 'dither', label: 'Dither', type: 'bool', default: false, help: 'A crosshatch pattern for the in-between greys.' },
    {
      key: 'ink',
      label: 'Ink',
      type: 'select',
      default: 'bw',
      options: [
        { value: 'bw', label: 'Black on paper' },
        { value: 'red', label: 'Red ink' },
        { value: 'blue', label: 'Blue ink' },
        { value: 'lime', label: 'Black on lime' },
        { value: 'pink', label: 'Plum on pink' },
        { value: 'night', label: 'White on black' },
      ],
      help: 'The two colours.',
    },
    MIX,
  ],
};

export const halftone: PixelEffectDef = {
  kind: 'pixel',
  type: 'halftone',
  name: 'Halftone',
  icon: 'HTN',
  color: '#f0c0d0',
  description: 'The picture printed as dots on a turned grid, bigger where it is darker: newspaper print or pop art.',
  params: [
    { key: 'cell', label: 'Dot size', type: 'number', min: 3, max: 40, step: 0.5, default: 9, unit: 'px', intensity: 'up', help: 'Spacing of the dots.' },
    { key: 'angle', label: 'Angle', type: 'number', min: 0, max: 90, step: 1, default: 45, unit: '°', help: 'How the grid of dots is turned.' },
    { key: 'mono', label: 'Black dots', type: 'bool', default: false, help: 'Black dots (newspaper) instead of dots in the picture\'s colours (pop art).' },
    MIX,
  ],
};

export const lineArt: PixelEffectDef = {
  kind: 'pixel',
  type: 'lineArt',
  name: 'Line Art',
  icon: 'LIN',
  color: '#c8d8f0',
  description: 'Only the edges are left, as ink lines on paper, glowing lines on black, or lines drawn over the picture.',
  params: [
    { key: 'thick', label: 'Line width', type: 'number', min: 0.5, max: 4, step: 0.1, default: 1, unit: 'px', help: 'How thick the lines are.' },
    { key: 'strength', label: 'Strength', type: 'number', min: 0.5, max: 10, step: 0.1, default: 3, intensity: 'up', help: 'How faint an edge still makes a line.' },
    {
      key: 'mode',
      label: 'Style',
      type: 'select',
      default: 'paper',
      options: [
        { value: 'paper', label: 'Ink on paper' },
        { value: 'neon', label: 'Light on black' },
        { value: 'over', label: 'Over the picture' },
      ],
      help: 'Where the lines go.',
    },
    {
      key: 'ink',
      label: 'Colour',
      type: 'select',
      default: 'black',
      options: [
        { value: 'black', label: 'Black' },
        { value: 'white', label: 'White' },
        { value: 'red', label: 'Red' },
        { value: 'blue', label: 'Blue' },
        { value: 'lime', label: 'Lime' },
      ],
      help: 'Colour of the lines (light on black looks best in white or lime).',
    },
    MIX,
  ],
};

export const glow: PixelEffectDef = {
  kind: 'pixel',
  type: 'glow',
  name: 'Glow',
  icon: 'GLW',
  color: '#ffd59a',
  description: 'Bright parts bloom into soft light. Halation tints the bloom red, like light bouncing inside old film.',
  params: [
    { key: 'thr', label: 'Threshold', type: 'number', min: 0, max: 0.95, step: 0.01, default: 0.6, intensity: 'down', help: 'How bright a part must be to glow.' },
    { key: 'radius', label: 'Radius', type: 'number', min: 2, max: 80, step: 1, default: 18, unit: 'px', intensity: 'up', help: 'How far the glow spreads.' },
    { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 3, step: 0.05, default: 1, intensity: 'up', help: 'How strong the glow is.' },
    { key: 'halation', label: 'Halation', type: 'number', min: 0, max: 1, step: 0.01, default: 0, help: 'Tints the glow red-orange, like film.' },
  ],
};

export const vignette: PixelEffectDef = {
  kind: 'pixel',
  type: 'vignette',
  name: 'Vignette',
  icon: 'VIG',
  color: '#9a9aa8',
  description: 'The corners darken (or fade to white), drawing the eye to the middle.',
  params: [
    { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 1, step: 0.01, default: 0.6, intensity: 'up', help: 'How dark the corners get.' },
    { key: 'reach', label: 'Reach', type: 'number', min: 0, max: 1, step: 0.01, default: 0.45, help: 'How far in from the corners it starts.' },
    { key: 'soft', label: 'Softness', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, help: 'How gradual it is.' },
    { key: 'white', label: 'White', type: 'bool', default: false, help: 'Fade to white instead of black (a dreamy look).' },
  ],
};

export const lightLeak: PixelEffectDef = {
  kind: 'pixel',
  type: 'lightLeak',
  name: 'Light Leak',
  icon: 'LKS',
  color: '#ffab6b',
  description: 'Warm glows drift in from the edges, like light getting into an old camera.',
  params: [
    { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 1.5, step: 0.01, default: 0.6, intensity: 'up', help: 'How bright the leaks are.' },
    { key: 'speed', label: 'Drift', type: 'number', min: 0, max: 4, step: 0.05, default: 1, intensity: 'up', help: 'How fast they move.' },
    { key: 'hue', label: 'Colour', type: 'number', min: 0, max: 1, step: 0.01, default: 0.2, help: 'From red-orange to golden (and cool blue at the top).' },
  ],
};

export const gateWeave: PixelEffectDef = {
  kind: 'pixel',
  type: 'gateWeave',
  name: 'Gate Weave',
  icon: 'GTE',
  color: '#c4b59a',
  description: 'The picture jitters and drifts like film in a projector, with flicker and dust.',
  params: [
    { key: 'amount', label: 'Weave', type: 'number', min: 0, max: 4, step: 0.05, default: 1, unit: 'px', intensity: 'up', help: 'How far it wanders.' },
    { key: 'flicker', label: 'Flicker', type: 'number', min: 0, max: 1, step: 0.01, default: 0.4, intensity: 'up', help: 'Brightness that changes frame to frame.' },
    { key: 'dust', label: 'Dust', type: 'number', min: 0, max: 1, step: 0.01, default: 0.3, intensity: 'up', help: 'Specks of dust on the film.' },
  ],
};

export const dvTape: PixelEffectDef = {
  kind: 'pixel',
  type: 'dvTape',
  name: 'DV Tape',
  icon: 'DV',
  color: '#a8c8a0',
  description: 'A 2000s camcorder: colour in blocks, over-sharpened edges, interlaced lines and a cheap cast.',
  params: [
    { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 1, step: 0.01, default: 0.7, intensity: 'up', help: 'How strong the look is.' },
    { key: 'res', label: 'Pixel size', type: 'number', min: 1, max: 4, step: 0.25, default: 1.5, unit: 'px', intensity: 'up', help: 'Lower resolution (bigger pixels).' },
    { key: 'lines', label: 'Interlaced', type: 'bool', default: true, help: 'Every other line a little out of step.' },
  ],
};

export const trails: PixelEffectDef = {
  kind: 'pixel',
  type: 'trails',
  name: 'Light Trails',
  icon: 'TRL',
  color: '#b0f0ff',
  description: 'Bright things leave trails that fade away, like a long exposure.',
  params: [
    { key: 'decay', label: 'Length', type: 'number', min: 0.5, max: 0.99, step: 0.01, default: 0.88, intensity: 'up', help: 'How long the trails last.' },
    { key: 'add', label: 'Glowing', type: 'bool', default: false, help: 'Trails add light instead of keeping the brightest.' },
  ],
};

export const hold: PixelEffectDef = {
  kind: 'pixel',
  type: 'hold',
  name: 'Step Print',
  icon: 'STP',
  color: '#d0b8f0',
  description: 'Holds each picture for a few frames: the choppy, low-frame-rate look of step-printed film and anime.',
  params: [{ key: 'every', label: 'Hold for', type: 'int', min: 2, max: 8, default: 2, unit: 'frames', intensity: 'up', help: 'How many frames each picture is held (2: like 12 fps at 24).' }],
};

export const pixelEffects: PixelEffectDef[] = [vectorWarp, chromaDrift, pixelSort, rawBend, flowPaint, vhs, crt, grain, posterize, threshold, halftone, lineArt, glow, vignette, lightLeak, gateWeave, dvTape, trails, hold, subjectGuard];
