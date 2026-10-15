import type { MoshCodec } from './bitstream';
import type { Keys, Ramp } from './keys';

export type FrameType = 'I' | 'P' | 'B' | 'S' | '?';

/** Tag describing what the mosh engine did to a frame (drives the frame strip colours). */
export type FrameTag = 'orig' | 'dup' | 'glitch' | 'moved' | 'spliced' | 'replaced';

export interface Frame {
  data: Uint8Array;
  type: FrameType;
  /** index of the source frame in the prepared (un-moshed) stream (its picture data and sound) */
  src: number;
  /** timeline frame this frame is shown at, when it differs from `src` (repeats, moves, transfers) */
  at?: number;
  tag: FrameTag;
  payloadStart: number;
  /**
   * Disk-backed frames (desktop exports): `data` holds only the first bytes (enough for the frame
   * header) and the payload is `size` bytes at `off` in the engine file `file`.
   */
  size?: number;
  off?: number;
  file?: string;
}

/** What's inside a compound clip: a timeline of its own (media is shared with the project). */
export interface Sequence {
  clips: Clip[];
  tracks: Track[];
  texts: TextClip[];
  effects: EffectInstance[];
  markers?: Marker[];
  /** the compound's own mosh effects are rendered into it */
  moshInside?: boolean;
}

export type ClipSource =
  /** `compound`: the file is the rendered sequence (re-rendered when it's edited) */
  | { kind: 'file'; fileId: string; name: string; mime: string; isImage: boolean; ext: string; compound?: Sequence; stale?: boolean }
  | { kind: 'generator'; generator: string; name: string }
  /** adjustment layer: no picture, applies its colour and look to everything below it */
  | { kind: 'adjust'; name: string };

export type FitMode = 'fit' | 'fill' | 'stretch';

/** Position, size, rotation and crop of a clip's picture (all optional, identity when missing). */
export interface Transform {
  /** 1 = the clip fitted to the frame */
  zoom: number;
  /** offset of the centre, as a share of the frame width / height */
  x: number;
  y: number;
  /** degrees, clockwise */
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  /** share of the fitted picture cut away at each edge */
  cropL: number;
  cropR: number;
  cropT: number;
  cropB: number;
}

/** Basic colour correction. */
export interface Grade {
  /** -1..1, added */
  brightness: number;
  /** 0..3, 1 = unchanged */
  contrast: number;
  /** 0..3, 1 = unchanged */
  saturation: number;
  /** 0.2..5, 1 = unchanged */
  gamma: number;
  /** degrees */
  hue: number;
  /** id of an imported .cube LUT, and how much of it (0..1) */
  lut?: string;
  lutAmount?: number;
}

/** Green / blue screen: pixels near `color` become transparent. */
export interface ChromaKey {
  color: string;
  /** 0..1: how far from the colour still counts */
  similarity: number;
  /** 0..1: soft edge */
  blend: number;
  /** remove the colour's spill from the edges */
  spill: boolean;
}

/** An imported look-up table. */
export interface LutRef {
  id: string;
  name: string;
}

export type BlendMode = 'normal' | 'screen' | 'add' | 'multiply' | 'difference';

/** A file (or generator) in the media library. The same media can be used by many clips. */
export interface MediaItem {
  id: string;
  source: ClipSource;
  /** full source duration (s); stills get a long nominal duration */
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
  thumb?: string;
}

export type TransitionType =
  | 'dissolve'
  | 'dip'
  | 'dipwhite'
  | 'wipeleft'
  | 'wiperight'
  | 'wipeup'
  | 'wipedown'
  | 'slideleft'
  | 'slideright'
  | 'circleopen'
  | 'pixelize'
  | 'melt'
  | 'bloom'
  | 'glitch'
  | 'stutter'
  | 'liquid'
  | 'ghost'
  | 'rewind';

export interface Transition {
  type: TransitionType;
  /** seconds */
  duration: number;
  /** 0..1, how hard mosh transitions hit */
  intensity: number;
  /** mosh transitions: a fresh keyframe at the end brings the next shot back clean (default on) */
  resolve?: boolean;
}

/** A clip on the timeline. */
export interface Clip {
  id: string;
  mediaId: string;
  /** 'v1' (the magnetic main video track) or an audio track id */
  track: string;
  /** timeline start in seconds (audio tracks only; video clips follow each other) */
  start: number;
  /** trim points in source seconds */
  in: number;
  out: number;
  speed: number;
  reverse: boolean;
  fit: FitMode;
  volume: number;
  /** video clips: their own sound is muted (or detached to an audio track) */
  muted: boolean;
  /** audio fades, seconds */
  fadeIn: number;
  fadeOut: number;
  /** video clips: transition from the previous clip into this one */
  transition?: Transition;
  /** false: the clip stays in place but is not seen or heard */
  enabled?: boolean;
  /** label colour on the timeline */
  label?: string;
  /** freeze frame: shows the picture at `in` for out - in seconds */
  freeze?: boolean;
  /** picture */
  opacity?: number;
  blend?: BlendMode;
  transform?: Partial<Transform>;
  grade?: Partial<Grade>;
  /** video fades (to black on the main track, to transparent on upper tracks), seconds */
  vfadeIn?: number;
  vfadeOut?: number;
  /** animated position / zoom / rotation / opacity (clip-local seconds) */
  keys?: Keys;
  /** speed ramp: speed over the clip (replaces `speed`) */
  ramp?: Ramp;
  /** chroma key (upper video tracks) */
  key?: ChromaKey;
  /** tracked objects: [source seconds, centre x 0..1, centre y 0..1] */
  paths?: { id: string; name: string; pts: [number, number, number][] }[];
  /** stabilization: corrections over source seconds (shift as shares of the frame, rotation in °), and the zoom that hides the edges */
  stab?: { x: [number, number][]; y: [number, number][]; r: [number, number][]; zoom: number };
}

/** A marker on the timeline ruler. */
export interface Marker {
  id: string;
  /** seconds */
  t: number;
  color: string;
  name: string;
}

export interface Track {
  id: string;
  kind: 'video' | 'audio';
  name: string;
  /** audio: silent. video: not shown */
  muted: boolean;
  solo: boolean;
  volume: number;
  /** audio follows the mosh (stutters with it) instead of playing clean */
  mosh: boolean;
  /** clips on a locked track can't be selected, moved or edited */
  locked?: boolean;
}

export interface TextClip {
  id: string;
  text: string;
  start: number;
  duration: number;
  /** font size as a fraction of frame height */
  size: number;
  color: string;
  font: 'sans' | 'serif' | 'mono' | 'impact';
  bold: boolean;
  /** position of the text centre, 0..1 */
  x: number;
  y: number;
  align: 'left' | 'center' | 'right';
  shadow: boolean;
  box: boolean;
  fade: number;
  /** burn into the video before moshing so the text melts too */
  moshed: boolean;
  /** made by auto captions */
  caption?: boolean;
  /** word timings (seconds from the title's start), for word-by-word highlighting */
  words?: { t0: number; t1: number; text: string }[];
  /** colour of the word being spoken */
  highlight?: string;
  /** follow a tracked object: [timeline seconds, x 0..1, y 0..1] */
  follow?: [number, number, number][];
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
  /** feedback: mosh the result again this many times (1 = once) */
  generations?: number;
  /** quality steps lost on each extra generation */
  genCrush?: number;
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

export type AudioBand = 'low' | 'mid' | 'high' | 'full' | 'onset' | 'beat';

export type Automation =
  | { kind: 'curve'; points: [number, number][]; interp: AutoInterp }
  | { kind: 'lfo'; shape: LfoShape; rate: number; min: number; max: number; phase: number }
  /**
   * follows the music: `track` is 'auto' (the music track), 'mix' (everything) or an audio track
   * id; attack / release in frames, threshold 0..1
   */
  | { kind: 'audio'; track: string; band: AudioBand; min: number; max: number; attack: number; release: number; threshold: number }
  /** one value per frame of the effect's range (audio automation, worked out at render time) */
  | { kind: 'samples'; values: number[]; min: number };

export type ParamValue = number | boolean | string;

export interface EffectInstance {
  id: string;
  type: string;
  name?: string;
  enabled: boolean;
  solo: boolean;
  /** timeline-frame range [start, end) */
  start: number;
  end: number;
  /** generated by a transition (not stored in the project) */
  transition?: string;
  seed: number;
  params: Record<string, ParamValue>;
  auto: Record<string, Automation>;
  locks: string[];
  /** structured settings that aren't single values (sequencer patterns, painted strokes…) */
  data?: Record<string, unknown>;
}

export interface AudioSettings {
  mode: 'follow' | 'original';
  crossfade: boolean;
  volume: number;
  bitcrush: number;
  downsample: number;
  glitch: number;
  reverseChunks: number;
}

export interface Project {
  version: 2;
  name: string;
  media: MediaItem[];
  clips: Clip[];
  tracks: Track[];
  texts: TextClip[];
  encoder: EncoderSettings;
  decoder: DecoderSettings;
  effects: EffectInstance[];
  audio: AudioSettings;
  globalSeed: number;
  markers?: Marker[];
  /** the Chaos dial: 0 calm .. 1 as authored .. 2 destroyed */
  chaos?: number;
  /** where beats come from for beat-triggered effects: 'auto' (the music track), 'mix' or a track id */
  beatSource?: string;
  /** imported LUTs (the files are kept with the media) */
  luts?: LutRef[];
}

export const defaultEncoder = (): EncoderSettings => ({
  codec: 'mpeg4',
  width: 1280,
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
  mode: 'follow',
  crossfade: true,
  volume: 1,
  bitcrush: 16,
  downsample: 1,
  glitch: 0,
  reverseChunks: 0,
});

export const VIDEO_TRACK = 'v1';

export const identityTransform = (): Transform => ({ zoom: 1, x: 0, y: 0, rotate: 0, flipH: false, flipV: false, cropL: 0, cropR: 0, cropT: 0, cropB: 0 });
export const identityGrade = (): Grade => ({ brightness: 0, contrast: 1, saturation: 1, gamma: 1, hue: 0 });
export const transformOf = (c: Pick<Clip, 'transform'>): Transform => ({ ...identityTransform(), ...(c.transform ?? {}) });
export const gradeOf = (c: Pick<Clip, 'grade'>): Grade => ({ ...identityGrade(), ...(c.grade ?? {}) });
export const isIdentityTransform = (t: Transform) => t.zoom === 1 && !t.x && !t.y && !t.rotate && !t.flipH && !t.flipV && !t.cropL && !t.cropR && !t.cropT && !t.cropB;
export const isIdentityGrade = (g: Grade) => !g.brightness && g.contrast === 1 && g.saturation === 1 && g.gamma === 1 && !g.hue && !(g.lut && (g.lutAmount ?? 1) > 0);
export const clipOn = (c: Pick<Clip, 'enabled'>) => c.enabled !== false;
export const CLIP_AUDIO = 'a0';

export const defaultTracks = (): Track[] => [
  { id: VIDEO_TRACK, kind: 'video', name: 'Video', muted: false, solo: false, volume: 1, mosh: true },
  { id: CLIP_AUDIO, kind: 'audio', name: 'Clip audio', muted: false, solo: false, volume: 1, mosh: true },
  { id: 'a1', kind: 'audio', name: 'Music', muted: false, solo: false, volume: 1, mosh: false },
];

export const newProject = (): Project => ({
  version: 2,
  name: 'Untitled mosh',
  media: [],
  clips: [],
  tracks: defaultTracks(),
  texts: [],
  encoder: defaultEncoder(),
  decoder: defaultDecoder(),
  effects: [],
  audio: defaultAudio(),
  globalSeed: 1337,
  markers: [],
});
