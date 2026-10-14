<script lang="ts">
  // Draws a clip's waveform from precomputed peaks for its source range.
  import { PEAKS_PER_SEC } from '../lib/mediastate.svelte';
  let { peaks, from, to, reverse = false, width, height, color = 'currentColor' }: { peaks?: Uint8Array; from: number; to: number; reverse?: boolean; width: number; height: number; color?: string } = $props();
  let canvas: HTMLCanvasElement;

  $effect(() => {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.min(4096, Math.round(width * dpr)));
    const H = Math.max(1, Math.round(height * dpr));
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    if (!peaks?.length) return;
    ctx.fillStyle = color === 'currentColor' ? getComputedStyle(canvas).color : color;
    const a = from * PEAKS_PER_SEC;
    const b = to * PEAKS_PER_SEC;
    const mid = H / 2;
    for (let x = 0; x < W; x++) {
      const t0 = reverse ? b - ((x + 1) / W) * (b - a) : a + (x / W) * (b - a);
      const t1 = t0 + (b - a) / W;
      let mx = 0;
      for (let i = Math.floor(t0); i <= Math.ceil(t1) && i < peaks.length; i++) if (i >= 0 && peaks[i] > mx) mx = peaks[i];
      const hh = Math.max(dpr * 0.5, (mx / 255) * mid);
      ctx.fillRect(x, mid - hh, 1, hh * 2);
    }
  });
</script>

<canvas bind:this={canvas} style="width:{width}px;height:{height}px"></canvas>

<style>
  canvas {
    display: block;
    pointer-events: none;
  }
</style>
