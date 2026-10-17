// Ways to start: templates (your clips, a ready-made mosh), examples (generated footage, nothing to
// import) and the automatic first mosh when clips land on an empty timeline.
import { store } from './store.svelte';
import { addFiles, addToTimeline } from './media';
import { renderGenerator, cutsOf } from './renderer';
import { startProject } from './projects.svelte';
import { refreshBeats } from './beatinfo.svelte';
import { newText } from './edit';
import { GENERATORS, even } from '../engine/args';
import { PRESETS, applyPreset } from '../engine/presets';
import { beatEdit, defaultBeatEdit } from '../engine/beatedit';
import { applyRecipe, type Recipe } from '../engine/recipe';
import { newProject, VIDEO_TRACK, type Aspect, type MediaItem, type Project, type TransitionType } from '../engine/types';

export interface Starter {
  id: string;
  name: string;
  description: string;
  /** looping preview in public/app/examples/<thumb>.webm (poster .jpg) */
  thumb: string;
  aspect?: Aspect;
  /** generated footage used for examples, and for templates when no clips are picked: [generator, seconds] */
  sample: [string, number][];
  /** shapes the timeline once the footage is on it */
  build: (media: MediaItem[]) => Promise<void> | void;
}

export interface Template extends Starter {
  /** how many clips it's made for */
  clips: [number, number];
  /** what the picker says about the footage */
  hint: string;
  /** a song makes it better (it cuts to the beat) */
  music?: boolean;
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
  store.edit((p) => p.texts.push({ ...newText(start), text, duration, moshed, size: 0.14 }));
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

// ---------------------------------------------------------------- templates

export const TEMPLATES: Template[] = [
  {
    id: 'meltcuts',
    name: 'Melt transitions',
    description: 'Every cut melts: the next shot drags the last picture around until it resolves.',
    thumb: 'melt',
    clips: [2, 8],
    hint: 'Two or more clips with plenty of movement.',
    sample: [['testsrc2', 3], ['mandelbrot', 3], ['gradients', 3]],
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
    sample: [['mandelbrot', 4], ['gradients', 4], ['life', 4]],
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
    sample: [['gradients', 2], ['mandelbrot', 2]],
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
    sample: [['mandelbrot', 5]],
    build: () => {
      onCuts('bloom', 1.2);
      preset('bloom');
    },
  },
  {
    id: 'glitchintro',
    name: 'Glitch intro',
    description: 'A title that melts into your footage, with hard glitch cuts after it.',
    thumb: 'glitch',
    clips: [1, 6],
    hint: 'Any clips. Change the title text after.',
    sample: [['testsrc2', 3], ['cellauto', 3]],
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
    sample: [['testsrc2', 3], ['mandelbrot', 4]],
    build: () => preset('transfer'),
  },
  {
    id: 'vhs',
    name: 'VHS memory',
    description: 'Tape-damaged colour, smeared tracking and dropped frames.',
    thumb: 'vhs',
    clips: [1, 8],
    hint: 'Home videos and old phone clips look great.',
    sample: [['gradients', 4], ['testsrc2', 3]],
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
    sample: [['testsrc2', 4]],
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
    sample: [['testsrc2', 3], ['mandelbrot', 4], ['gradients', 3]],
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
    sample: [['testsrc2', 5]],
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
    const g = GENERATORS.find((x) => x.id === id) ?? GENERATORS[0];
    store.status.engine = `Generating ${g.name}…`;
    try {
      files.push(new File([await renderGenerator(g.id, seconds, w, h, 24)], `${g.name}.mp4`, { type: 'video/mp4' }));
    } finally {
      store.status.engine = '';
    }
  }
  return files;
}

/** A fresh project from a starter: your files (or its sample footage), then its edit. */
async function run(s: Starter, files: File[] | null) {
  await startProject({ ...newProject(), name: s.name, encoder: { ...newProject().encoder, ...(s.aspect ? { aspect: s.aspect } : {}) } });
  const media = await addFiles(files?.length ? files : await sampleFiles(s.sample, s.aspect), 'none', undefined, { recipes: false });
  if (!media.length) return;
  // pictures on the main track in the order given, sound on the music track
  for (const m of media.filter((x) => x.hasVideo)) addToTimeline(m);
  for (const m of media.filter((x) => !x.hasVideo)) addToTimeline(m);
  await s.build(media);
  store.ui.selectedClips = [];
  store.seek(0);
  store.commit();
}

export async function useTemplate(t: Template, files: File[] | null) {
  await run(t, files);
  store.toast(files?.length ? `${t.name} is ready. Change anything you like.` : `${t.name} with sample footage. Drop your own clips in to replace them.`, 'ok', 5000);
}

export async function openExample(e: Starter) {
  await run(e, null);
}

/** A recipe from a link (the gallery): on sample footage in a new project, ready for your own clips. */
export async function openRecipe(code: string) {
  const { applyShareCode } = await import('./projectio.svelte');
  await run({ id: 'recipe', name: 'Shared recipe', description: '', thumb: '', sample: [['testsrc2', 3], ['mandelbrot', 4]], build: () => applyShareCode(code) }, null);
  store.toast('The recipe is on sample footage. Drop your own clips in and it follows them.', 'ok', 7000);
}

/** A recipe file opened from the home screen: the same, under its own name. */
export async function openRecipeData(data: Recipe, name = 'Recipe') {
  await run({ id: 'recipe', name, description: '', thumb: '', sample: [['testsrc2', 3], ['mandelbrot', 4]], build: () => store.set(applyRecipe(store.project, data, store.totalFrames)) }, null);
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
