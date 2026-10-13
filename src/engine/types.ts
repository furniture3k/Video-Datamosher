import type { MoshCodec } from './bitstream';

export type FrameType = 'I' | 'P' | 'B' | 'S' | '?';

/** Tag describing what the mosh engine did to a frame (drives the frame strip colours). */
export type FrameTag = 'orig' | 'dup' | 'glitch' | 'moved' | 'spliced' | 'replaced';

export interface Frame {
  data: Uint8Array;
  type: FrameType;
  /** index of the source frame in the prepared (un-moshed) stream */
  src: number;
  tag: FrameTag;
  payloadStart: number;
}

export type ClipSource =
  | { kind: 'file'; fileId: string; name: string; mime: string; isImage: boolean; ext: string }
  | { kind: 'generator'; generator: string; name: string };

export type FitMode = 'fit' | 'fill' | 'stretch';

export interface Clip {
  id: string;
  source: ClipSource;
  /** full source duration (s) */
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  /** trim points in source seconds */
  in: number;
  out: number;
  speed: number;
  reverse: boolean;
  fit: FitMode;
  thumb?: string;
}

export type Aspect = 'auto' | '16:9' | '4:3' | '1:1' | '9:16' | '4:5' | '21:9';

export interface EncoderSettings {
  codec: MoshCodec;
  width: number;
  aspect: Aspect;
  fps: number;
  /** qscale 1 (best) .. 31 (crunchy) */
  quality: number;
  /** keyframe interval in frames */
  gop: number;
  sceneCut: boolean;
  bframes: number;
  motionEst: 'zero' | 'epzs' | 'xone';
  meRange: number;
  mbd: 'simple' | 'bits' | 'rd';
  mv4: boolean;
  qpel: boolean;
  trellis: boolean;
  cmp: 'sad' | 'sse' | 'satd' | 'dct' | 'rd' | 'zero' | 'vsad' | 'nsse';
  keyAtCuts: boolean;
  /** extra forced keyframes (frame numbers) */
  keyMarkers: number[];
  previewWidth: number;
}

export interface DecoderSettings {
  guessMvs: boolean;
  deblock: boolean;
  favorInter: boolean;
  ignoreErrors: boolean;
  showAll: boolean;
}

export type AutoInterp = 'linear' | 'smooth' | 'step';
export type LfoShape = 'sine' | 'triangle' | 'square' | 'saw' | 'random' | 'noise';

export type Automation =
  | { kind: 'curve'; points: [number, number][]; interp: AutoInterp }
  | { kind: 'lfo'; shape: LfoShape; rate: number; min: number; max: number; phase: number };

export type ParamValue = number | boolean | string;

export interface EffectInstance {
  id: string;
  type: string;
  name?: string;
  enabled: boolean;
  solo: boolean;
  /** source-frame range [start, end) */
  start: number;
  end: number;
  seed: number;
  params: Record<string, ParamValue>;
  auto: Record<string, Automation>;
  locks: string[];
}

export interface AudioSettings {
  source: 'none' | 'timeline' | 'clip';
  clipId: string | null;
  mode: 'follow' | 'original';
  crossfade: boolean;
  volume: number;
  bitcrush: number;
  downsample: number;
  glitch: number;
  reverseChunks: number;
}

export interface Project {
  version: 1;
  name: string;
  clips: Clip[];
  encoder: EncoderSettings;
  decoder: DecoderSettings;
  effects: EffectInstance[];
  audio: AudioSettings;
  globalSeed: number;
}

export const defaultEncoder = (): EncoderSettings => ({
  codec: 'mpeg4',
  width: 640,
  aspect: 'auto',
  fps: 24,
  quality: 4,
  gop: 600,
  sceneCut: false,
  bframes: 0,
  motionEst: 'epzs',
  meRange: 0,
  mbd: 'simple',
  mv4: false,
  qpel: false,
  trellis: false,
  cmp: 'sad',
  keyAtCuts: true,
  keyMarkers: [],
  previewWidth: 480,
});

export const defaultDecoder = (): DecoderSettings => ({
  guessMvs: true,
  deblock: false,
  favorInter: true,
  ignoreErrors: true,
  showAll: false,
});

export const defaultAudio = (): AudioSettings => ({
  source: 'timeline',
  clipId: null,
  mode: 'follow',
  crossfade: true,
  volume: 1,
  bitcrush: 16,
  downsample: 1,
  glitch: 0,
  reverseChunks: 0,
});

export const newProject = (): Project => ({
  version: 1,
  name: 'Untitled mosh',
  clips: [],
  encoder: defaultEncoder(),
  decoder: defaultDecoder(),
  effects: [],
  audio: defaultAudio(),
  globalSeed: 1337,
});
