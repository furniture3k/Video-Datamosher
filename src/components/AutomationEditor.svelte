<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { evalAutomation } from '../engine/automation';
  import { hashSeed } from '../engine/rng';
  import type { ParamDef } from '../engine/effects';
  import type { Automation, EffectInstance, Project } from '../engine/types';
  import { audioFeatures } from '../lib/renderer';
  import { audioKey } from '../engine/audiofx';
  import { audioEnvelope } from '../engine/beats';
  import { beatInputs } from '../lib/beatinfo.svelte';

  let { effect: fx, def }: { effect: EffectInstance; def: ParamDef } = $props();
  const a = $derived(fx.auto[def.key]);
  const lo = $derived(def.type === 'number' || def.type === 'int' ? def.min : 0);
  const hi = $derived(def.type === 'number' || def.type === 'int' ? def.max : 1);
  const key = $derived('auto' + fx.id + def.key);
  let canvas = $state<HTMLCanvasElement>();
  const H = 70;

  function setAuto(fn: (a: Automation) => void, k: string | null = key) {
    store.edit(() => fn(fx.auto[def.key]), k);
  }
  function switchKind(kind: 'curve' | 'lfo' | 'audio') {
    store.edit(() => {
      fx.auto[def.key] =
        kind === 'curve'
          ? { kind: 'curve', interp: 'smooth', points: [[0, lo], [1, hi]] }
          : kind === 'lfo'
            ? { kind: 'lfo', shape: 'sine', rate: 2, min: lo, max: hi, phase: 0 }
            : { kind: 'audio', track: 'auto', band: 'low', min: lo, max: hi, attack: 0, release: 4, threshold: 0.1 };
    });
  }

  // ---- audio: the real envelope of the music under the effect's bar
  let env = $state.raw<Float32Array | null>(null);
  let envNote = $state('');
  const audioDeps = $derived(a?.kind === 'audio' ? JSON.stringify([a.track, a.band, a.attack, a.release, a.threshold, fx.start, fx.end, beatInputs(store.project)]) : '');
  $effect(() => {
    if (!audioDeps || a?.kind !== 'audio') {
      env = null;
      return;
    }
    const au = $state.snapshot(a) as Extract<Automation, { kind: 'audio' }>;
    const p = $state.snapshot(store.project) as Project;
    const [s, e] = [fx.start, fx.end];
    envNote = 'listening…';
    audioFeatures(p, audioKey(p, au.track)).then(
      (f) => {
        env = f ? audioEnvelope(f, au, s, e) : null;
        envNote = f ? '' : 'No sound on that track yet: drop music on the timeline.';
      },
      () => (envNote = 'Could not read the sound.'),
    );
  });
  const audioTracks = $derived(store.project.tracks.filter((t) => t.kind === 'audio'));
  const BANDS: [string, string][] = [
    ['low', 'Bass'],
    ['mid', 'Mids'],
    ['high', 'Highs'],
    ['full', 'Loudness'],
    ['onset', 'Hits'],
    ['beat', 'Beats'],
  ];
  function shape(name: string) {
    const pts: Record<string, [number, number][]> = {
      up: [[0, lo], [1, hi]],
      down: [[0, hi], [1, lo]],
      peak: [[0, lo], [0.5, hi], [1, lo]],
      dip: [[0, hi], [0.5, lo], [1, hi]],
      steps: [[0, lo], [0.33, (lo + hi) / 2], [0.66, hi], [1, lo]],
    };
    setAuto((x) => {
      if (x.kind === 'curve') x.points = pts[name];
    }, null);
  }

  // draw
  $effect(() => {
    const au = a;
    void env;
    void JSON.stringify(au);
    void store.ui.theme;
    if (!canvas || !au) return;
    const w = canvas.clientWidth || 300;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    ctx.fillStyle = css('--bg');
    ctx.fillRect(0, 0, w, H);
    ctx.strokeStyle = css('--line');
    for (let g = 1; g < 4; g++) {
      ctx.beginPath();
      ctx.moveTo(0, (g * H) / 4);
      ctx.lineTo(w, (g * H) / 4);
      ctx.stroke();
    }
    const yOf = (v: number) => H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8);
    ctx.strokeStyle = css('--accent');
    ctx.lineWidth = au.kind === 'audio' ? 1 : 2;
    ctx.beginPath();
    const ev = env;
    for (let i = 0; i <= w; i++) {
      const v = au.kind === 'audio' ? au.min + (au.max - au.min) * (ev?.length ? ev[Math.min(ev.length - 1, Math.round((i / w) * (ev.length - 1)))] : 0) : evalAutomation(au, i / w, hashSeed(fx.seed, def.key));
      if (i === 0) ctx.moveTo(i, yOf(v));
      else ctx.lineTo(i, yOf(v));
    }
    ctx.stroke();
    if (au.kind === 'curve') {
      ctx.fillStyle = css('--text');
      for (const [t, v] of au.points) {
        ctx.beginPath();
        ctx.arc(t * w, yOf(v), 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });

  let dragIdx = -1;
  function pos(e: PointerEvent | MouseEvent): [number, number] {
    const r = canvas!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    let v = lo + (1 - Math.min(1, Math.max(0, (e.clientY - r.top - 4) / (r.height - 8)))) * (hi - lo);
    if (def.type === 'int') v = Math.round(v);
    else v = Math.round(v * 1000) / 1000;
    return [t, v];
  }
  function nearest(e: PointerEvent | MouseEvent) {
    if (a?.kind !== 'curve') return -1;
    const r = canvas!.getBoundingClientRect();
    const [t] = pos(e);
    let best = -1;
    let bd = 12 / r.width;
    a.points.forEach(([pt], i) => {
      if (Math.abs(pt - t) < bd) ((bd = Math.abs(pt - t)), (best = i));
    });
    return best;
  }
  function down(e: PointerEvent) {
    if (a?.kind !== 'curve') return;
    if (e.button === 2) return;
    let i = nearest(e);
    if (i < 0) {
      const p = pos(e);
      setAuto((x) => {
        if (x.kind === 'curve') {
          x.points.push(p);
          x.points.sort((m, n) => m[0] - n[0]);
        }
      });
      i = a.points.findIndex((q) => q[0] === p[0]);
    }
    dragIdx = i;
    canvas!.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (dragIdx < 0 || a?.kind !== 'curve') return;
    const p = pos(e);
    setAuto((x) => {
      if (x.kind !== 'curve') return;
      const isEnd = dragIdx === 0 || dragIdx === x.points.length - 1;
      x.points[dragIdx] = [isEnd ? x.points[dragIdx][0] : p[0], p[1]];
    });
  }
  function ctxmenu(e: MouseEvent) {
    e.preventDefault();
    const i = nearest(e);
    if (i > 0 && a?.kind === 'curve' && i < a.points.length - 1) setAuto((x) => x.kind === 'curve' && x.points.splice(i, 1), null);
  }
</script>

{#if a}
  <div class="ae">
    <div class="row">
      <div class="seg">
        <button class:on={a.kind === 'curve'} onclick={() => switchKind('curve')}>Curve</button>
        <button class:on={a.kind === 'lfo'} onclick={() => switchKind('lfo')}>LFO</button>
        <button class:on={a.kind === 'audio'} onclick={() => switchKind('audio')} title="Follow the music: bass, loudness, hits or beats">Audio</button>
      </div>
      {#if a.kind === 'curve'}
        <select value={a.interp} onchange={(e) => setAuto((x) => x.kind === 'curve' && (x.interp = (e.target as HTMLSelectElement).value as never), null)}>
          <option value="smooth">Smooth</option>
          <option value="linear">Linear</option>
          <option value="step">Steps</option>
        </select>
      {:else if a.kind === 'lfo'}
        <select value={a.shape} onchange={(e) => setAuto((x) => x.kind === 'lfo' && (x.shape = (e.target as HTMLSelectElement).value as never), null)}>
          {#each ['sine', 'triangle', 'square', 'saw', 'random', 'noise'] as s}<option value={s}>{s}</option>{/each}
        </select>
      {:else if a.kind === 'audio'}
        <select value={a.band} aria-label="Follow" onchange={(e) => setAuto((x) => x.kind === 'audio' && (x.band = (e.target as HTMLSelectElement).value as never), null)}>
          {#each BANDS as [v, l]}<option value={v}>{l}</option>{/each}
        </select>
      {/if}
    </div>
    <canvas bind:this={canvas} style="height:{H}px" class:audio={a.kind === 'audio'} onpointerdown={down} onpointermove={move} onpointerup={() => (dragIdx = -1)} oncontextmenu={ctxmenu}></canvas>
    {#if a.kind === 'curve'}
      <div class="row shapes small">
        <span class="faint grow">click adds a point, right-click removes</span>
        {#each [['up', '⟋'], ['down', '⟍'], ['peak', '⋀'], ['dip', '⋁'], ['steps', '⌐']] as [n, g]}
          <button class="mini" title={n} onclick={() => shape(n)}>{g}</button>
        {/each}
      </div>
    {:else if a.kind === 'lfo'}
      <div class="grid small">
        <label>Cycles <input type="number" min="0.1" max="64" step="0.1" value={a.rate} onchange={(e) => setAuto((x) => x.kind === 'lfo' && (x.rate = +(e.target as HTMLInputElement).value))} /></label>
        <label>Phase <input type="number" min="0" max="1" step="0.05" value={a.phase} onchange={(e) => setAuto((x) => x.kind === 'lfo' && (x.phase = +(e.target as HTMLInputElement).value))} /></label>
        <label>Min <input type="number" min={lo} max={hi} step="any" value={a.min} onchange={(e) => setAuto((x) => x.kind === 'lfo' && (x.min = +(e.target as HTMLInputElement).value))} /></label>
        <label>Max <input type="number" min={lo} max={hi} step="any" value={a.max} onchange={(e) => setAuto((x) => x.kind === 'lfo' && (x.max = +(e.target as HTMLInputElement).value))} /></label>
      </div>
    {:else if a.kind === 'audio'}
      {#if envNote}<div class="small faint">{envNote}</div>{/if}
      <div class="grid small">
        <label class="wide">Listen to
          <select value={a.track} onchange={(e) => setAuto((x) => x.kind === 'audio' && (x.track = (e.target as HTMLSelectElement).value), null)}>
            <option value="auto">The music</option>
            <option value="mix">Everything</option>
            {#each audioTracks as t}<option value={t.id}>{t.name}</option>{/each}
          </select>
        </label>
        <label title="Quiet value: what the setting is when the music is quiet">Quiet <input type="number" min={lo} max={hi} step="any" value={a.min} onchange={(e) => setAuto((x) => x.kind === 'audio' && (x.min = +(e.target as HTMLInputElement).value))} /></label>
        <label title="Loud value: what the setting reaches on the loudest parts">Loud <input type="number" min={lo} max={hi} step="any" value={a.max} onchange={(e) => setAuto((x) => x.kind === 'audio' && (x.max = +(e.target as HTMLInputElement).value))} /></label>
        <label title="Frames to rise (0 = instant)">Attack <input type="number" min="0" max="48" step="1" value={a.attack} onchange={(e) => setAuto((x) => x.kind === 'audio' && (x.attack = +(e.target as HTMLInputElement).value))} /></label>
        <label title="Frames to fall back after a hit">Release <input type="number" min="0" max="96" step="1" value={a.release} onchange={(e) => setAuto((x) => x.kind === 'audio' && (x.release = +(e.target as HTMLInputElement).value))} /></label>
        <label class="wide" title="Ignore sound quieter than this">Threshold <input type="range" min="0" max="0.95" step="0.01" value={a.threshold} oninput={(e) => setAuto((x) => x.kind === 'audio' && (x.threshold = +(e.target as HTMLInputElement).value))} /></label>
      </div>
    {/if}
  </div>
{/if}

<style>
  .ae {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
  }
  canvas {
    width: 100%;
    border: 1px solid var(--line);
    cursor: crosshair;
    touch-action: none;
  }
  .seg button {
    padding: 0 8px;
    font-size: 11px;
    height: 22px;
  }
  .mini {
    padding: 0 6px;
    height: 20px;
    font-size: 12px;
    min-width: 0;
    background: none;
    border-color: transparent;
    color: var(--text-2);
  }
  select {
    height: 24px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .grid label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 4px;
  }
  .grid input {
    width: 64px;
  }
  .shapes {
    gap: 2px;
  }
  .grid .wide {
    grid-column: 1 / -1;
  }
  .grid .wide select,
  .grid .wide input[type='range'] {
    flex: 1;
    width: auto;
  }
  canvas.audio {
    cursor: default;
  }
</style>
