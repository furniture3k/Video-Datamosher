// Ways to start: templates (your clips, a ready-made mosh), examples (generated footage, nothing to
// import) and the automatic first mosh when clips land on an empty timeline.
import { store } from './store.svelte';
import { addFiles, addToTimeline } from './media';
import { renderGenerator, cutsOf } from './renderer';
import { startProject } from './projects.svelte';
import { addShape, arrangeGrid, newText } from './edit';
import { beatInfo, refreshBeats } from './beatinfo.svelte';
import { BUILTIN_STYLES, applyStyle } from '../engine/styles';
import { CANVAS_PRESETS, cardRect } from '../engine/canvas';
import { beatPoints, phrases, splitWords, wordSlots, wordTitles } from '../engine/wordbeats';
import { freeRow, nextRow, type BuiltinFont, type Layer, type TextLayer } from '../engine/layers';
import { clipLen, layoutVideo, makeClip, mediaOf, uid } from '../engine/timeline';
import { GENERATORS, even, outputSize } from '../engine/args';
import { widthForShape } from '../engine/social';
import { generatorName } from '../engine/scenes';
import { aspectRatio } from '../engine/reframe';
import { PRESETS, applyPreset } from '../engine/presets';
import { beatEdit, defaultBeatEdit } from '../engine/beatedit';
import { applyRecipe, type Recipe } from '../engine/recipe';
import { newProject, VIDEO_TRACK, type Aspect, type Clip, type MediaItem, type Project, type TransitionType } from '../engine/types';
import { newShape, type ShapeLook } from '../engine/shapes';
import { popKeys } from '../engine/keys';
import { addGoogleFont } from './fonts.svelte';
import { autoTrack, markTracked } from './motion.svelte';
import { cutOutThroughClip } from './cutout.svelte';
import { setObjectBackend } from './objectseg';

export interface Starter {
  id: string;
  name: string;
  description: string;
  /** looping preview in public/app/examples/<thumb>.webm (poster .jpg) */
  thumb: string;
  aspect?: Aspect;
  /** generated footage used for examples, and for templates when no clips are picked: [generator, seconds] */
  sample: [string, number][];
  /** shapes the timeline once the footage is on it (`words`: what the person typed, for templates that ask) */
  build: (media: MediaItem[], words: string) => Promise<void> | void;
}

export interface Template extends Starter {
  /** how many clips it's made for */
  clips: [number, number];
  /** what the picker says about the footage */
  hint: string;
  /** a song makes it better (it cuts to the beat) */
  music?: boolean;
  /** asks for words: what the box starts with, and what it says about them */
  words?: string;
  wordsHint?: string;
  /** one of the looks made from posted edits: shown first, under "Make a video like this", and in the editor's Templates dialog */
  look?: boolean;
  /** it works things out from the footage (finds and follows things, cuts the subject out): it takes a little while */
  slow?: boolean;
}

// ---------------------------------------------------------------- building blocks

const mainClips = () => store.project.clips.filter((c) => c.track === VIDEO_TRACK);

/** A mosh transition (or blend) on every cut of the main track. */
function onCuts(type: TransitionType, duration = 1, intensity = 0.5) {
  store.edit((p) => {
    p.clips
      .filter((c) => c.track === VIDEO_TRACK)
      .slice(1)
      .forEach((c) => (c.transition = { type, duration, intensity }));
  });
}

/** Shorten every main-track clip to at most `seconds` (from its start), for quick-cut templates. */
function trimTo(seconds: number) {
  store.edit((p) => {
    for (const c of p.clips) if (c.track === VIDEO_TRACK && (c.out - c.in) / (c.speed || 1) > seconds) c.out = c.in + seconds * (c.speed || 1);
  });
}

/** One of the built-in presets over the whole timeline. */
function preset(id: string) {
  const pr = PRESETS.find((x) => x.id === id);
  if (!pr) return;
  const p = $state.snapshot(store.project) as Project;
  store.set(applyPreset(p, pr, store.totalFrames, cutsOf(p)));
}

function title(text: string, start = 0, duration = 2.5, moshed = true) {
  store.edit((p) => p.layers.push({ ...newText(start), text, duration, moshed, size: 0.14, row: freeRow(p.layers, start, start + duration) }));
}

/** Clips cut to the beat of the song, with melts on the bars; plain melts when there's no beat. */
async function toTheBeat(media: MediaItem[]) {
  const f = media.some((m) => !m.hasVideo) ? await refreshBeats().catch(() => null) : null;
  if (!f || !f.beats.length) {
    onCuts('melt');
    return false;
  }
  const visual = media.filter((m) => m.hasVideo).map((m) => m.id);
  store.set(beatEdit($state.snapshot(store.project) as Project, f, { ...defaultBeatEdit(visual), every: 2 }));
  return true;
}

/** The video clips on the main track that can be analysed (not stills, generators or freeze frames). */
function footageClips(): Clip[] {
  const p = store.project;
  return mainClips().filter((c) => {
    const m = mediaOf(p, c.mediaId);
    return !!m && m.source.kind === 'file' && !m.source.isImage && !!m.hasVideo && !c.freeze;
  });
}

/** Where each main-track clip starts and ends on the timeline. */
function spans(): { clip: Clip; start: number; end: number }[] {
  const placed = layoutVideo(store.project);
  // a clip's span ends where the next one starts (in a transition, the next one's words take over)
  return placed.map((pl, i) => ({ clip: pl.clip, start: pl.start, end: Math.max(pl.start + 0.1, Math.min(pl.end, placed[i + 1]?.start ?? Infinity)) }));
}

/** The beats of the music, if there is music with a beat (else null): the beats are worked out first. */
async function musicBeats(media: MediaItem[]): Promise<number[] | null> {
  if (!media.some((m) => !m.hasVideo) && !store.project.clips.some((c) => mediaOf(store.project, c.mediaId)?.hasVideo === false)) return null;
  const f = await refreshBeats().catch(() => null);
  return f && f.beats.length ? beatInfo.beats : null;
}

/** Steps from `t0` to `t1`: on the beats in between, else every `fallback` seconds. */
function steps(t0: number, t1: number, beats: number[] | null, fallback: number): number[] {
  const on = beats?.filter((b) => b >= t0 - 1e-3 && b < t1 - 0.05) ?? [];
  if (on.length >= 2) return on;
  const out: number[] = [];
  for (let t = t0; t < t1 - 0.05; t += fallback) out.push(Math.round(t * 1000) / 1000);
  return out;
}

/** A Google font for titles if it can be fetched (the first time it is downloaded), else a built-in one. */
async function webFont(family: string, fallback: BuiltinFont): Promise<TextLayer['font']> {
  try {
    const f = await addGoogleFont(family);
    return `font:${f.id}`;
  } catch {
    return fallback;
  }
}

/** A title in one of the built-in styles. */
function styled(styleId: string, text: string, start: number, duration: number, extra: Partial<TextLayer> = {}): TextLayer {
  const l = newText(start);
  const st = BUILTIN_STYLES.find((x) => x.id === styleId);
  if (st) applyStyle(l, st);
  Object.assign(l, { text, duration }, extra);
  return l;
}

/** The frame's width over its height. */
const frameAspect = () => {
  const { w, h } = outputSize(store.project, 640);
  return w / h;
};

/** Put layers on the timeline, each on the lowest graphics row that is free while it is on. */
function addLayers(made: Layer[]) {
  if (!made.length) return;
  store.edit((p) => {
    for (const l of made) {
      l.row = freeRow(p.layers, l.start, l.start + l.duration);
      p.layers.push(l);
    }
  });
}

/** One of the built-in canvases on the whole timeline. */
function canvas(id: string) {
  const c = CANVAS_PRESETS.find((x) => x.id === id)?.canvas;
  if (c) store.edit((p) => (p.canvas = { ...c }));
}

/** Words one after another on the beat (or on the cuts), in a style, on a row of their own. */
function wordsOnBeats(text: string, styleId: string, beats: number[] | null) {
  const p = store.project;
  const pieces = splitWords(text, 'word');
  // no beat: a word every 0.4 s through the whole video (the cuts alone would be too few)
  const end = layoutVideo(p).at(-1)?.end ?? 0;
  const points = beats?.length ? beats : [...steps(0, end, null, 0.4), end];
  const slots = wordSlots(pieces.length, points, 0);
  const base = styled(styleId, '', 0, 1);
  const { id: _i, text: _t, start: _s, duration: _d, row: _r, ...like } = base;
  const titles = wordTitles(pieces, slots, like, nextRow(p.layers), uid);
  store.edit((q) => q.layers.push(...titles));
}

// ---------------------------------------------------------------- templates

/** The look of Red notes: thin red lines that wobble and draw themselves on. */
const NOTES_LOOK: ShapeLook = { color: '#ff1f1f', width: 0.006, boil: 0.6, drawOn: 0.35 };

export const TEMPLATES: Template[] = [
  {
    id: 'behind',
    name: 'Behind the subject',
    description: 'Your subject is cut out of each clip, with handwritten words and drawn rings between it and the background.',
    thumb: 'behind',
    clips: [1, 6],
    look: true,
    slow: true,
    words: 'I am both wound and knife\nconsume me\nmy life, my blood\nyou must destroy yourself to blossom',
    wordsHint: 'One line for each clip.',
    hint: 'Clips with one clear subject in the middle (a person, an animal, a thing). It is cut out by itself; the first time, a small model is downloaded.',
    sample: [['figure', 3], ['figure', 3]],
    build: async (media, words) => {
      const lines = phrases(words);
      const font = await webFont('Pinyon Script', 'serif');
      // the subject in the middle of each clip, cut out and followed through it
      const cut = new Set<string>();
      setObjectBackend(store.ui.cutModel);
      for (const c of footageClips().slice(0, 6)) {
        const m = mediaOf(store.project, c.mediaId);
        if (!m) continue;
        if (!(m.mattes ?? []).length) {
          try {
            if (!(await cutOutThroughClip(c.id, [[0.5, 0.5, 1]], c.in + (c.out - c.in) * 0.3, true))) continue;
          } catch (e) {
            // nothing in the middle of this one: try the next
            if (/could not find/i.test(String((e as Error)?.message))) continue;
            // the model couldn't load (offline, say): the other clips would fail the same way
            console.warn('cut-out failed', e);
            break;
          }
        }
        cut.add(c.mediaId);
      }
      const beats = await musicBeats(media);
      const aspect = frameAspect();
      const made: Layer[] = [];
      spans().forEach(({ clip, start, end }, i) => {
        const depth = cut.has(clip.mediaId) ? ('behind' as const) : undefined;
        const len = end - start;
        made.push(styled('story', lines[i % lines.length], start, len, { font, fit: 'width', color: '#f6f2ea', anim: 'type', animIn: Math.min(0.8, len / 3), fx: { shadow: { dx: 0, dy: 0.004, blur: 0.012, color: 'rgba(0,0,0,0.45)' } }, ...(depth ? { depth } : {}) }));
        // rings drawn round the middle, a new one on each step (the beat, or a third of a second)
        steps(start, end, beats, 0.33)
          .slice(0, 3)
          .forEach((t, k) => {
            const ring = newShape('circle', uid(), '', t, aspect, { color: k % 2 ? '#ffffff' : '#a9c4ff', width: 0.007, drawOn: 0.3, boil: 0.3 });
            const size = 0.5 + k * 0.12;
            Object.assign(ring, { duration: Math.max(0.2, end - t), w: Math.min(0.95, size / aspect), h: size, rotate: k * 40, ...(depth ? { depth } : {}) });
            made.push(ring);
          });
      });
      addLayers(made);
      if (footageClips().length && !cut.size) store.toast("Couldn't cut the subject out (the model needs the internet the first time), so the words are in front. Right-click the picture → Cut out to try again.", 'info', 9000);
    },
  },
  {
    id: 'kinetic',
    name: 'Kinetic lyrics',
    description: 'Big pink words slam in one per beat over quick cuts, 9:16.',
    thumb: 'kinetic',
    aspect: '9:16',
    clips: [2, 12],
    music: true,
    look: true,
    words: 'EVERYTHING WORKS IN MY FAVOR BECAUSE I WORK FOR EVERYTHING',
    wordsHint: 'One word lands on each beat.',
    hint: 'A few clips and a song.',
    sample: [['sunset', 2], ['nightdrive', 2], ['citylights', 2]],
    build: async (media, words) => {
      const cut = await toTheBeat(media);
      const beats = cut ? beatPoints(beatInfo.beats, 1) : null;
      wordsOnBeats(words.trim() || 'YOUR WORDS HERE', 'slam', beats);
    },
  },
  {
    id: 'collage',
    name: 'Pop-up collage',
    description: 'Your clips pop up on the beat as white-bordered cards, each leaving stepped copies behind it.',
    thumb: 'collage',
    clips: [2, 8],
    music: true,
    look: true,
    hint: 'Photos, screenshots and short clips. With a song, the cards land on its beat.',
    sample: [['citylights', 4], ['figure', 4], ['sunset', 4]],
    build: async (media) => {
      const beats = await musicBeats(media);
      const all = spans();
      if (!all.length) return;
      const p = store.project;
      const cards: Clip[] = [];
      all.forEach(({ start, end }, i) => {
        // the next shot pops up over this one, three times, stepping down and left
        const src = all[(i + 1) % all.length].clip;
        const m = mediaOf(p, src.mediaId);
        if (!m?.hasVideo || m.source.kind === 'adjust') return;
        steps(start + 0.15, end, beats, 0.47)
          .slice(0, 3)
          .forEach((t, k) => {
            const zoom = 0.5;
            const x = 0.14 - k * 0.05;
            const y = -0.12 + k * 0.06;
            const len = Math.max(0.1, end - t);
            const still = m.source.kind === 'file' && m.source.isImage;
            const pop = { mode: 'pop' as const, dur: 0.16, ease: false };
            cards.push(
              makeClip(m, 'v' + (2 + k), {
                start: Math.round(t * 1000) / 1000,
                in: src.in,
                out: still ? src.in + len : Math.min(m.duration, src.in + len),
                fit: 'fit',
                muted: true,
                transform: { zoom, x, y },
                card: { border: 0.012, borderColor: '#ffffff', radius: 0, shadow: 0.45 },
                pop,
                keys: popKeys({ zoom, x, y }, pop),
              }),
            );
          });
      });
      store.edit((q) => {
        // each copy on a track above the one before it, free while it is on (the project may have clips up there already)
        const free = (id: string, c: Clip) => !q.clips.some((x) => x.track === id && x.start < c.start + clipLen(c) - 1e-3 && x.start + clipLen(x) > c.start + 1e-3);
        let above = 2;
        cards.forEach((c, i) => {
          if (i > 0 && c.track === 'v2') above = 2;
          let n = above;
          while (!free('v' + n, c)) n++;
          c.track = 'v' + n;
          above = n + 1;
          if (!q.tracks.some((tr) => tr.id === c.track)) q.tracks.push({ id: c.track, kind: 'video', name: `Video ${n}`, muted: false, solo: false, volume: 1, mosh: true });
          q.clips.push(c);
        });
      });
    },
  },
  {
    id: 'tour',
    name: 'Tour poster',
    description: 'A magazine layout: your clips framed on off-white paper, blue type that types itself in, outline type, choppy 16 fps and shape wipes.',
    thumb: 'tour',
    clips: [1, 8],
    look: true,
    words: "What's on the star?\nALL IN MOTION\nlive tonight",
    wordsHint: 'One line for each clip.',
    hint: 'Portraits, fashion, stage or product shots.',
    sample: [['nightdrive', 3], ['sunset', 3]],
    build: async (_media, words) => {
      const lines = phrases(words);
      const cv = { bg: 'color' as const, color: '#eeede8', inset: 0.12, shift: 0.05, radius: 0, shadow: 0.15 };
      store.edit((p) => {
        p.canvas = cv;
        for (const c of p.clips) if (c.track === VIDEO_TRACK) c.stepFps = 16;
      });
      onCuts('circlecrop', 0.4);
      const font = await webFont('Archivo Black', 'sans');
      const { w: W, h: H } = outputSize(store.project, 640);
      const top = cardRect(cv, W, H).y / H;
      const made: Layer[] = [];
      spans().forEach(({ start, end }, i) => {
        const line = lines[i % lines.length];
        const len = end - start;
        made.push(styled('poster', line, start, len, { font, y: top / 2, size: Math.min(0.085, top * 0.6), animIn: Math.min(0.5, len / 3) }));
        made.push(styled('hollow', line.toUpperCase(), start + Math.min(0.4, len / 4), len - Math.min(0.4, len / 4), { font, y: 0.62, fit: 'width', color: '#1f3f72', strokeColor: '#1f3f72' }));
      });
      addLayers(made);
    },
  },
  {
    id: 'rednotes',
    name: 'Red notes',
    description: 'Hand-drawn red boxes, arrows and notes find things in your footage and follow them, one more on every beat.',
    thumb: 'rednotes',
    clips: [1, 6],
    look: true,
    slow: true,
    words: 'everything feels connected\nhope!!\nfind a way back home\nwhere is the void?\nwhy did you stop?\ncall now!!',
    wordsHint: 'Short notes: one for each thing that is marked.',
    hint: 'Footage with things in it: a street, a room, a sky with the moon. Things that move are followed.',
    sample: [['bars', 4]],
    build: async (media, words) => {
      const notes = phrases(words);
      const beats = await musicBeats(media);
      const notesText = BUILTIN_STYLES.find((x) => x.id === 'notes')!;
      const tracked = new Set(footageClips().map((c) => c.id));
      let n = 0;
      for (const { clip, start, end } of spans()) {
        const at = steps(start + 0.1, end, beats, 0.5);
        const ids = tracked.has(clip.id) ? await autoTrack(clip.id, 3).catch(() => [] as string[]) : [];
        const groups = ids.map((pid) => markTracked(clip.id, pid, undefined, undefined, notes[n++ % notes.length], true, NOTES_LOOK)).filter((g) => g.length);
        // one more on each step: a mark's box, arrow and label keep their spacing and end where they did
        store.edit((p) => {
          groups.forEach((g, k) => {
            const t = at[Math.min(k, at.length - 1)] ?? start;
            const shift = t - g[0].start;
            for (const made of g) {
              const l = p.layers.find((x) => x.id === made.id);
              if (!l) continue;
              const endT = l.start + l.duration;
              l.start = Math.round((l.start + shift) * 1000) / 1000;
              l.duration = Math.max(0.2, endT - l.start);
              if (l.kind === 'text') Object.assign(l, { boil: notesText.boil, color: (n + k) % 3 === 1 ? '#2a3bff' : NOTES_LOOK.color });
            }
          });
        });
        if (!groups.length) {
          // nothing to follow (a still, or nothing found): a box, an arrow and a note that stay put
          const t = at[0] ?? start;
          const aspect = frameAspect();
          const box = Object.assign(newShape('rect', uid(), '', t, aspect, NOTES_LOOK), { x: 0.45, y: 0.52, duration: Math.max(0.3, end - t) });
          const arrow = Object.assign(newShape('arrow', uid(), '', t + 0.3, aspect, NOTES_LOOK), { x: 0.68, y: 0.3, rotate: 90, duration: Math.max(0.3, end - t - 0.3) });
          addLayers([box, arrow, styled('notes', notes[n++ % notes.length], t + 0.6, Math.max(0.3, end - t - 0.6), { x: 0.76, y: 0.18 })]);
        }
        // a tunnel of boxes on a later step
        if (at.length > 3) {
          const aspect = frameAspect();
          const tunnel = Object.assign(newShape('tunnel', uid(), '', at[3], aspect, NOTES_LOOK), { x: 0.24, y: 0.5, w: Math.min(0.9, 0.34 / aspect), h: 0.34, count: 6, duration: Math.max(0.3, end - at[3]) });
          addLayers([tunnel]);
        }
      }
    },
  },
  {
    id: 'scrapbook',
    name: 'Scrapbook',
    description: 'Your clips as a paper card on cream with a handwritten caption above, soft dissolves, film grain.',
    thumb: 'scrapbook',
    aspect: '9:16',
    clips: [1, 8],
    hint: 'Holiday clips, pets, friends.',
    words: 'summer, finally',
    wordsHint: 'The caption above the card.',
    sample: [['sunset', 3], ['citylights', 3]],
    build: async (_media, words) => {
      const font = await webFont('Caveat', 'serif');
      canvas('card');
      // the card a little lower, so the caption has the cream above it to itself
      store.edit((p) => (p.canvas = { ...p.canvas!, inset: 0.07, shift: 0.07 }));
      onCuts('dissolve', 0.3);
      const end = layoutVideo(store.project).at(-1)?.end ?? 3;
      const caption = words.split('\n').map((l) => l.trim()).find(Boolean) ?? 'summer';
      store.edit((p) => p.layers.push(styled('story', caption, 0.2, Math.max(1, end - 0.2), { font, size: 0.07, color: '#2b2118', x: 0.5, y: 0.056 })));
      preset('eightmm');
    },
  },
  {
    id: 'productdemo',
    name: 'Product demo',
    description: 'Your screen recording plays in a browser window, with a cursor and a title.',
    thumb: 'productdemo',
    clips: [1, 4],
    hint: 'A screen recording or app footage.',
    sample: [['bars', 4]],
    build: () => {
      canvas('browser');
      store.edit((p) => p.layers.push(styled('poster', 'Meet the new thing', 0.2, 2.5, { y: 0.07, size: 0.06 })));
      store.seek(0.3);
      const c = addShape('cursor');
      store.edit((p) => Object.assign(p.layers.find((l) => l.id === c.id)!, { x: 0.62, y: 0.6, duration: 3.5 }));
      store.seek(0);
    },
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    description: 'Halation, grain and gate weave, with whip pans between the shots.',
    thumb: 'cinematic',
    clips: [2, 10],
    hint: 'Nature, travel, slow movement.',
    sample: [['sunset', 3], ['nightdrive', 3]],
    build: () => {
      onCuts('whipleft', 0.3);
      preset('cinefilm');
    },
  },
  {
    id: 'degraded',
    name: 'Degraded film',
    description: 'Held, choppy motion, heavy grain, dust and light leaks, with a lyric that strobes.',
    thumb: 'degraded',
    aspect: '9:16',
    clips: [1, 8],
    hint: 'Concert clips, night drives, home videos.',
    sample: [['citylights', 3], ['nightdrive', 3]],
    build: () => {
      preset('eightmm');
      store.edit((p) => p.layers.push(styled('bleed', 'I CANT FEEL MY FACE', 0.3, 3)));
    },
  },
  {
    id: 'splitscreen',
    name: 'Split screen',
    description: 'Two clips stacked, one above the other, with a gap.',
    thumb: 'splitscreen',
    aspect: '9:16',
    clips: [2, 2],
    hint: 'Two clips to compare or pair.',
    sample: [['nightdrive', 3], ['figure', 3]],
    build: () => {
      // the second clip goes on a track above, at the same time as the first
      const [, second] = mainClips();
      if (!second) return;
      store.edit((p) => {
        const c = p.clips.find((x) => x.id === second.id)!;
        c.track = 'v2';
        c.start = 0;
        if (!p.tracks.some((t) => t.id === 'v2')) p.tracks.push({ id: 'v2', kind: 'video', name: 'Video 2', muted: false, solo: false, volume: 1, mosh: true });
      });
      store.seek(0.1);
      arrangeGrid('stack', 0.02);
      store.seek(0);
    },
  },
  {
    id: 'meltcuts',
    name: 'Melt transitions',
    description: 'Every cut melts: the next shot drags the last picture around until it resolves.',
    thumb: 'melt',
    clips: [2, 8],
    hint: 'Two or more clips with plenty of movement.',
    sample: [['nightdrive', 3], ['figure', 3], ['sunset', 3]],
    build: () => onCuts('melt', 1),
  },
  {
    id: 'beatmelt',
    name: 'Beat-synced melt',
    description: 'Your clips cut on the beat of a song, melting on every bar and blooming where it drops.',
    thumb: 'beat',
    clips: [2, 12],
    music: true,
    hint: 'A few clips, and a song with a clear beat to cut them to.',
    sample: [['citylights', 4], ['sunset', 4], ['nightdrive', 4]],
    build: async (media) => {
      if (!(await toTheBeat(media))) store.toast('Add a song to cut this to the beat (Audio tab → Auto-edit to the beat).', 'info', 6000);
    },
  },
  {
    id: 'verticalloop',
    name: 'Vertical loop',
    description: '9:16 for TikTok, Reels and Shorts. Quick cuts that liquid-melt into each other.',
    thumb: 'loop',
    aspect: '9:16',
    clips: [1, 6],
    hint: 'Short clips. Vertical footage fits best.',
    sample: [['sunset', 2], ['citylights', 2]],
    build: () => {
      trimTo(2.5);
      onCuts('liquid', 0.8);
      preset('echo');
    },
  },
  {
    id: 'bloomdrop',
    name: 'Bloom drop',
    description: 'Movement repeats and piles up until the picture erupts outward.',
    thumb: 'bloom',
    clips: [1, 4],
    hint: 'One or two clips with strong, one-direction movement.',
    sample: [['nightdrive', 5]],
    build: () => {
      onCuts('bloom', 1.2);
      preset('bloom');
    },
  },
  {
    id: 'glitchintro',
    name: 'Glitch intro',
    description: 'A title that melts into your footage, with hard glitch cuts after it.',
    thumb: 'glitchintro',
    clips: [1, 6],
    hint: 'Any clips. Change the title text after.',
    sample: [['citylights', 3], ['nightdrive', 3]],
    build: () => {
      title('YOUR TITLE', 0, 2.5, true);
      onCuts('glitch', 0.6);
      preset('crunch');
    },
  },
  {
    id: 'motionswap',
    name: 'Motion swap',
    description: "One shot's picture moves with another shot's motion.",
    thumb: 'swap',
    clips: [2, 2],
    hint: 'Two clips: a still-ish one, then one with lots of movement.',
    sample: [['nightdrive', 3], ['figure', 4]],
    build: () => preset('transfer'),
  },
  {
    id: 'vhs',
    name: 'VHS memory',
    description: 'Tape-damaged colour, smeared tracking and dropped frames.',
    thumb: 'vhs',
    clips: [1, 8],
    hint: 'Home videos and old phone clips look great.',
    sample: [['sunset', 4], ['nightdrive', 3]],
    build: () => {
      onCuts('ghost', 0.8);
      preset('vhs');
    },
  },
  {
    id: 'vortex',
    name: 'Vortex',
    description: 'The picture is pulled into a spinning drain.',
    thumb: 'vortex',
    clips: [1, 3],
    hint: 'Any footage; it brings its own motion.',
    sample: [['citylights', 4]],
    build: () => preset('vortex'),
  },
];

// ---------------------------------------------------------------- examples (no import needed)

export const EXAMPLES: Starter[] = [
  {
    id: 'ex-melt',
    name: 'Test pattern melt',
    description: 'Colour bars melt into a Mandelbrot zoom, then bloom into the next shot.',
    thumb: 'melt',
    sample: [['bars', 3], ['mandelbrot', 4], ['gradients', 3]],
    build: () => {
      store.edit((p) => {
        const v = p.clips.filter((c) => c.track === VIDEO_TRACK);
        if (v[1]) v[1].transition = { type: 'melt', duration: 1, intensity: 0.5 };
        if (v[2]) v[2].transition = { type: 'bloom', duration: 1.2, intensity: 0.6 };
      });
      title('moshpit', 0, 2, true);
    },
  },
  {
    id: 'ex-vortex',
    name: 'Vortex',
    description: 'A test pattern pulled into a spinning drain by a motion pack.',
    thumb: 'vortex',
    sample: [['bars', 5]],
    build: () => preset('vortex'),
  },
  {
    id: 'ex-life',
    name: 'Datastorm of Life',
    description: "Conway's Game of Life with corrupted, raining blocks.",
    thumb: 'glitch',
    sample: [['life', 4], ['cellauto', 3]],
    build: () => {
      onCuts('glitch', 0.6);
      preset('storm');
    },
  },
  {
    id: 'ex-bloom',
    name: 'Gradient bloom',
    description: 'Soft gradients repeat their motion until they erupt.',
    thumb: 'bloom',
    sample: [['gradients', 5]],
    build: () => preset('bloom'),
  },
];

// ---------------------------------------------------------------- running them

/** Generated footage as files, ready to import. */
async function sampleFiles(sample: [string, number][], aspect?: Aspect): Promise<File[]> {
  const w = 640;
  const ar = aspect === '9:16' ? 9 / 16 : aspect === '1:1' ? 1 : 16 / 9;
  const h = even(w / ar);
  const files: File[] = [];
  for (const [id, seconds] of sample) {
    const name = generatorName(id, GENERATORS);
    store.status.engine = `Generating ${name}…`;
    try {
      files.push(new File([await renderGenerator(id, seconds, w, h, 24)], `${name}.mp4`, { type: 'video/mp4' }));
    } finally {
      store.status.engine = '';
    }
  }
  return files;
}

/** A fresh project from a starter: your files (or its sample footage), then its edit. */
async function run(s: Starter, files: File[] | null, words = '') {
  const enc = newProject().encoder;
  await startProject({ ...newProject(), name: s.name, encoder: { ...enc, ...(s.aspect ? { aspect: s.aspect, width: widthForShape(enc.width, 16 / 9, aspectRatio(s.aspect)) } : {}) } });
  const media = await addFiles(files?.length ? files : await sampleFiles(s.sample, s.aspect), 'none', undefined, { recipes: false });
  if (!media.length) return;
  // pictures on the main track in the order given, sound on the music track
  for (const m of media.filter((x) => x.hasVideo)) addToTimeline(m);
  for (const m of media.filter((x) => !x.hasVideo)) addToTimeline(m);
  // the whole look is one undo step
  await store.group(() => s.build(media, words || (s as Template).words || ''));
  store.ui.selectedClips = [];
  store.seek(0);
  store.commit();
}

/** Files the person picks (an empty list if they don't): for buttons that aren't next to a file input. */
export function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = accept;
    input.hidden = true;
    // (older iOS opens the picker only for an input that is in the page)
    document.body.appendChild(input);
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.onchange = () => done([...(input.files ?? [])]);
    // closing the picker without choosing: some browsers say so, the rest never answer (nothing waits on it)
    input.addEventListener('cancel', () => done([]));
    input.click();
  });
}

/** What a template's file picker takes. */
export const templateAccept = (t: Template) => (t.music ? 'video/*,image/*,audio/*,.mkv,.mov,.avi,.gif,.mp3,.wav,.m4a,.flac,.ogg' : 'video/*,image/*,.mkv,.mov,.avi,.gif');

export async function useTemplate(t: Template, files: File[] | null, words = '') {
  await run(t, files, words);
  if (files?.length) return store.toast(`${t.name} is ready. Change anything you like.`, 'ok', 5000);
  // sample footage: one tap to make it again with the person's own clips
  store.toast(`${t.name} with sample footage. Use your own clips to make it again with them.`, 'ok', 9000, {
    label: 'Use my clips',
    run: async () => {
      const picked = await pickFiles(templateAccept(t));
      if (picked.length) await useTemplate(t, picked, words).catch((e) => store.toast('Could not set up the template: ' + ((e as Error)?.message ?? e), 'error', 6000));
    },
  });
}

/**
 * Put a look on the open project, on the clips already there (one undo step). Its aspect is used
 * when it has one. Throws if there is nothing to put it on.
 */
export async function applyLook(t: Template, words = '') {
  if (!mainClips().length) throw new Error('Add some clips to the timeline first: the look is made from them.');
  await store.group(async () => {
    if (t.aspect && store.project.encoder.aspect !== t.aspect)
      store.edit((p) => {
        const from = outputSize(p, p.encoder.width);
        p.encoder.aspect = t.aspect!;
        p.encoder.width = widthForShape(p.encoder.width, from.w / from.h, aspectRatio(t.aspect!));
      });
    // the media on the timeline (not everything ever imported): a beat cut is made from these
    const used = store.project.media.filter((m) => store.project.clips.some((c) => c.mediaId === m.id));
    await t.build($state.snapshot(used) as MediaItem[], words || t.words || '');
  });
  store.ui.selectedClips = [];
  store.seek(0);
  store.toast(`${t.name} is on. Change anything you like, or undo to take it off.`, 'ok', 7000, { label: 'Undo', run: () => store.undo() });
}

export async function openExample(e: Starter) {
  await run(e, null);
}

/** A recipe from a link (the gallery): on sample footage in a new project, ready for your own clips. */
export async function openRecipe(code: string) {
  const { applyShareCode } = await import('./projectio.svelte');
  await run({ id: 'recipe', name: 'Shared recipe', description: '', thumb: '', sample: [['bars', 3], ['mandelbrot', 4]], build: () => applyShareCode(code) }, null);
  store.toast('The recipe is on sample footage. Drop your own clips in and it follows them.', 'ok', 7000);
}

/** A recipe file opened from the home screen: the same, under its own name. */
export async function openRecipeData(data: Recipe, name = 'Recipe') {
  await run({ id: 'recipe', name, description: '', thumb: '', sample: [['bars', 3], ['mandelbrot', 4]], build: () => store.set(applyRecipe(store.project, data, store.totalFrames)) }, null);
  store.toast('The recipe is on sample footage. Drop your own clips in and it follows them.', 'ok', 7000);
}

// ---------------------------------------------------------------- the automatic first mosh

/**
 * Clips imported into an empty project: put a mosh on them straight away, so there's something
 * to see before anything is learned (melts on the cuts; one clip blooms). One Undo takes it off.
 */
export function firstMosh() {
  if (!store.ui.autoMosh) return;
  const p = store.project;
  const vids = mainClips();
  if (!vids.length || p.effects.length || vids.some((c) => c.transition)) return;
  if (vids.length >= 2) {
    onCuts('melt', 1);
    store.toast('Melted the cuts so you can see it work. Undo to take it off.', 'ok', 6000, { label: 'Undo', run: () => store.undo() });
  } else {
    preset('bloom');
    store.toast('Put a Bloom on it so you can see it work. Undo to take it off.', 'ok', 6000, { label: 'Undo', run: () => store.undo() });
  }
}
