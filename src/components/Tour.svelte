<script lang="ts">
  // First-run tour: a few steps that light up the real parts of the editor. Skippable, shown once,
  // and replayable from Help. Steps whose element isn't on screen are skipped.
  import { onMount } from 'svelte';
  import { store } from '../lib/store.svelte';
  import { localSet } from '../lib/storage';

  let { phone = false }: { phone?: boolean } = $props();

  interface Step {
    at: string;
    title: string;
    text: string;
  }
  const DESKTOP: Step[] = [
    { at: 'media', title: 'Your clips', text: 'Import or drop videos, photos and music here, then drag them onto the timeline (or press + on one).' },
    { at: 'looks', title: 'Templates', text: 'Seen an edit you like? Templates make yours like it in one go, from your clips: words behind a cut-out subject, lyrics on the beat, a pop-up collage, a tour poster, red notes. Type your words and it does the rest.' },
    { at: 'preview', title: 'Add things right on the picture', text: 'Right-click the picture for a title, a box, an arrow, a cut-out or a sticker exactly there. Drag anything on it to move it.' },
    { at: 'timeline', title: 'Cut it together', text: 'Drag to reorder, drag edges to trim, S splits. The + on a cut adds a Melt: the next shot drags the last picture around.' },
    { at: 'mosh', title: 'Mosh it', text: 'Not sure where to start? Pick a preset, or press Randomize until something good happens. Undo is always there.' },
    { at: 'export', title: 'Export', text: 'MP4, WebM, GIF, PNG frames or the raw broken AVI, sized for wherever it\'s going.' },
  ];
  const PHONE: Step[] = [
    { at: 'preview', title: 'Preview', text: 'Tap the picture to play or pause. Hold it to add a title, a box, an arrow or a cut-out right there.' },
    { at: 'looks', title: 'Templates', text: 'Make it look like an edit you have seen, from your clips: lyrics on the beat, words behind the subject, a collage, red notes. Type your words and it does the rest.' },
    { at: 'timeline', title: 'Timeline', text: 'Swipe to scrub, pinch to zoom, hold a clip to move it. Tap the little squares on cuts to Melt them.' },
    { at: 'tools', title: 'Tools', text: 'They change with what you select. Mosh, Presets and Randomize are here when nothing is selected.' },
    { at: 'export', title: 'Export', text: 'Save it as a video or GIF when it looks right.' },
  ];

  const steps = (phone ? PHONE : DESKTOP).filter((s) => document.querySelector(`[data-tour="${s.at}"]`));
  let i = $state(0);
  let rect = $state<DOMRect | null>(null);
  const step = $derived(steps[i]);

  function measure() {
    const el = step && document.querySelector(`[data-tour="${step.at}"]`);
    rect = el ? el.getBoundingClientRect() : null;
  }
  $effect(() => {
    void i;
    measure();
  });
  onMount(() => {
    if (!steps.length) done();
    const ro = () => measure();
    window.addEventListener('resize', ro);
    return () => window.removeEventListener('resize', ro);
  });

  function done() {
    store.ui.welcome = false;
    localSet('seenWelcome', true);
  }
  const next = () => (i < steps.length - 1 ? i++ : done());

  // the card sits beside the lit-up part, on whichever side has room
  const PAD = 8;
  const card = $derived.by(() => {
    if (!rect) return 'left:50%;top:50%;transform:translate(-50%,-50%)';
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cw = Math.min(320, W - 32);
    if (phone) {
      // above or below, full width
      const below = rect.bottom + 150 < H;
      return `left:16px;right:16px;${below ? `top:${rect.bottom + PAD + 6}px` : `bottom:${H - rect.top + PAD + 6}px`}`;
    }
    if (rect.right + cw + 24 < W) return `left:${rect.right + PAD + 10}px;top:${Math.max(16, Math.min(H - 220, rect.top))}px;width:${cw}px`;
    if (rect.left - cw - 24 > 0) return `left:${rect.left - cw - PAD - 10}px;top:${Math.max(16, Math.min(H - 220, rect.top))}px;width:${cw}px`;
    if (rect.top > 240) return `left:${Math.max(16, Math.min(W - cw - 16, rect.left))}px;bottom:${H - rect.top + PAD + 10}px;width:${cw}px`;
    return `left:${Math.max(16, Math.min(W - cw - 16, rect.left))}px;top:${rect.bottom + PAD + 10}px;width:${cw}px`;
  });
</script>

<svelte:window onkeydown={(e) => {
  const el = e.target as HTMLElement | null;
  if (el?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (e.key === 'Enter' || e.key === 'ArrowRight') (e.preventDefault(), e.stopPropagation(), next());
  else if (e.key === 'ArrowLeft' && i > 0) (e.preventDefault(), i--);
}} />

{#if step}
  <div class="tour" role="dialog" aria-modal="true" aria-label="Quick tour">
    {#if rect}
      <div class="hole" style="left:{rect.left - PAD}px;top:{rect.top - PAD}px;width:{rect.width + PAD * 2}px;height:{rect.height + PAD * 2}px"></div>
    {:else}
      <div class="dim"></div>
    {/if}
    <div class="card" style={card}>
      <div class="count mono small faint">{i + 1} / {steps.length}</div>
      <h4>{step.title}</h4>
      <p>{step.text}</p>
      <div class="row">
        <button class="ghost small" onclick={done}>Skip tour</button>
        <span class="grow"></span>
        {#if i > 0}<button class="small" onclick={() => i--}>Back</button>{/if}
        <button class="primary small" onclick={next}>{i === steps.length - 1 ? 'Got it' : 'Next'}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .tour {
    position: fixed;
    inset: 0;
    z-index: 150;
  }
  .hole {
    position: absolute;
    border-radius: 12px;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.62);
    outline: 2px solid var(--accent);
    transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
    pointer-events: none;
  }
  .dim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.62);
  }
  .card {
    position: absolute;
    background: var(--surface);
    border: 1px solid var(--line-2);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  h4 {
    font-size: 15px;
  }
  p {
    line-height: 1.45;
    color: var(--text-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }
  .grow {
    flex: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .hole,
    .card {
      transition: none;
    }
  }
</style>
