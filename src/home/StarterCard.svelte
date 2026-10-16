<script lang="ts">
  // A template or example: a looping preview (plays while it's on screen), its name and what it does.
  import { onMount } from 'svelte';
  import type { Starter } from '../lib/starters.svelte';
  import Logo from '../components/Logo.svelte';

  let { s, badge = '', busy = false, onclick }: { s: Starter; badge?: string; busy?: boolean; onclick: () => void } = $props();
  let video = $state<HTMLVideoElement>();
  let missing = $state(false);
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  onMount(() => {
    if (!video || reduced) return;
    // only play what can be seen (a grid of videos all playing at once is heavy on phones)
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? video!.play().catch(() => {}) : video!.pause()), { threshold: 0.4 });
    io.observe(video);
    return () => io.disconnect();
  });
</script>

<button class="starter" {onclick} disabled={busy} aria-label="{s.name}: {s.description}">
  <div class="thumb">
    {#if !missing}
      <video bind:this={video} src="examples/{s.thumb}.webm" poster="examples/{s.thumb}.jpg" muted loop playsinline preload="none" onerror={() => (missing = true)}></video>
    {:else}
      <div class="ph"><Logo size={30} color="var(--line-2)" /></div>
    {/if}
    {#if badge}<span class="badge mono">{badge}</span>{/if}
    {#if busy}<span class="busy">Making it…</span>{/if}
  </div>
  <div class="name">{s.name}</div>
  <div class="desc small faint">{s.description}</div>
</button>

<style>
  .starter {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    height: auto;
    padding: 0;
    background: none;
    border: none;
    text-align: left;
    white-space: normal;
  }
  .thumb {
    position: relative;
    aspect-ratio: 4 / 3;
    border-radius: var(--r-lg);
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--line);
    transition: border-color 0.12s, transform 0.12s;
  }
  .starter:hover:not(:disabled) .thumb,
  .starter:focus-visible .thumb {
    border-color: var(--accent);
  }
  video,
  .ph {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: grid;
    place-items: center;
  }
  .badge {
    position: absolute;
    left: 6px;
    top: 6px;
    font-size: 10.5px;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
  }
  .busy {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 12px;
  }
  .name {
    font-weight: 600;
  }
  .desc {
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
