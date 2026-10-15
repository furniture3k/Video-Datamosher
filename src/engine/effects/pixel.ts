// Pixel / flow effects run on decoded frames (after the bitstream mosh).
import type { PixelEffectDef } from './types';

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

export const pixelEffects: PixelEffectDef[] = [vectorWarp, chromaDrift, pixelSort];
