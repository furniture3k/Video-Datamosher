<script lang="ts">
  // A short loop of your own timeline with an effect added: what it will really look like on your
  // footage, rendered with the same engine (at preview size, reusing the prepared clips).
  import { onDestroy, onMount } from 'svelte';
  import { store } from '../lib/store.svelte';
  import { renderPreview, Cancelled } from '../lib/renderer';
  import { makeEffect } from '../engine/presets';
  import { EFFECTS } from '../engine/effects';
  import type { Project } from '../engine/types';

  let { type, range }: { type: string; range: [number, number] } = $props();

  /** seconds of the result to loop, from where the effect starts */
  const LOOP = 3;
  let urls = $state<string[]>([]);
  let frame = $state(0);
  let phase = $state<'rendering' | 'ready' | 'error'>('rendering');
  let progress = $state(0);
  let signal = { cancelled: false };
  let timer = 0;

  function clear() {
    clearInterval(timer);
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
  }

  async function render(t: string, r: [number, number]) {
    signal.cancelled = true;
    const my = (signal = { cancelled: false });
    clear();
    phase = 'rendering';
    progress = 0;
    const p = $state.snapshot(store.project) as Project;
    const fx = makeEffect(t, r[0], Math.max(r[0] + 1, r[1]));
    try {
      const res = await renderPreview({ ...p, effects: [...p.effects, fx] }, store.previewWidth, (_s, v) => (progress = v), my);
      if (my.cancelled) return;
      const fps = res.fps;
      const a = r[0];
      const b = Math.min(r[1], a + Math.round(LOOP * fps));
      const picked = res.frames.map((f, i) => ({ pos: f.at ?? f.src, i })).filter((x) => x.pos >= a && x.pos < Math.max(b, a + 1));
      const list = (picked.length ? picked : res.frames.slice(0, Math.round(LOOP * fps)).map((_, i) => ({ i }))).map((x) => res.jpegs[x.i]).filter(Boolean);
      urls = list.map((j) => URL.createObjectURL(new Blob([j as BlobPart], { type: 'image/jpeg' })));
      frame = 0;
      phase = 'ready';
      timer = window.setInterval(() => (frame = (frame + 1) % Math.max(1, urls.length)), 1000 / fps);
    } catch (e) {
      if (!(e instanceof Cancelled) && !my.cancelled) phase = 'error';
    }
  }

  // once per effect (the picker makes a new preview for each effect it shows)
  onMount(() => {
    render(type, range);
  });
  onDestroy(() => {
    signal.cancelled = true;
    clear();
  });
</script>

<div class="pv">
  {#if phase === 'ready' && urls.length}
    <img src={urls[frame]} alt="{EFFECTS[type]?.name} on your timeline" />
  {:else}
    <div class="wait small faint">{phase === 'error' ? "Couldn't make a preview." : `Rendering on your footage… ${Math.round(progress * 100)}%`}</div>
  {/if}
  <span class="tag small">{EFFECTS[type]?.name} · your footage</span>
</div>

<style>
  .pv {
    position: relative;
    aspect-ratio: 16 / 9;
    background: #000;
    border-radius: var(--r);
    overflow: hidden;
    display: grid;
    place-items: center;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .wait {
    padding: 12px;
    text-align: center;
  }
  .tag {
    position: absolute;
    left: 8px;
    bottom: 8px;
    padding: 1px 7px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
  }
</style>
