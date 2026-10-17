<script lang="ts">
  import { t as tr } from '../lib/i18n.svelte';
  import { store } from '../lib/store.svelte';
  import { EFFECTS } from '../engine/effects';
  import { randomizeEffect } from '../engine/presets';
  import { makeRng, randomSeed } from '../engine/rng';
  import ParamControl from './ParamControl.svelte';
  import SequencerGrid from './SequencerGrid.svelte';
  import Icon from './Icon.svelte';
  import type { EffectInstance } from '../engine/types';
  import { layoutVideo } from '../engine/timeline';
  import { markedRange } from '../lib/edit';
  import { usesBeats } from '../engine/audiofx';
  import { audioSources, mediaOf } from '../engine/timeline';
  import { FLOW_TOOLS } from '../engine/flowfield';
  import { beatInfo } from '../lib/beatinfo.svelte';
  import { fxPrefs, saveFxPreset, deleteFxPreset, applyFxPreset } from '../lib/fxprefs.svelte';
  import { ask, askText } from '../lib/ask';
  import { SCRIPT_EXAMPLES } from '../engine/effects/script';
  import { scripts, approve } from '../lib/scripts.svelte';

  let { effect }: { effect: EffectInstance } = $props();
  const def = $derived(EFFECTS[effect.type]);
  // settings that don't apply to the current mode are left out entirely
  const applicable = $derived(def.params.filter((p) => !p.show || p.show(effect.params)));
  const params = $derived(applicable.filter((p) => store.ui.advanced || !p.advanced));
  const hidden = $derived(applicable.length - params.length);
  const playSrc = $derived(store.playFrame);
  const total = $derived(store.totalFrames);
  const sec = (f: number) => (f / store.fps).toFixed(2);

  function randomize() {
    const r = randomizeEffect($state.snapshot(effect) as EffectInstance, makeRng(randomSeed()), total);
    store.edit(() => {
      effect.params = r.params;
      effect.seed = r.seed;
    });
  }
  const rangeLocked = $derived(effect.locks.includes('__range'));
  let showInfo = $state(false);
  const marked = $derived(store.ui.inPoint !== null || store.ui.outPoint !== null ? markedRange() : null);
  const clipUnder = $derived(layoutVideo(store.project).find((p) => store.ui.time >= p.start && store.ui.time < p.end));
  function fitTo(a: number, b: number) {
    const f = store.fps;
    store.edit(() => {
      effect.start = Math.max(0, Math.round(a * f));
      effect.end = Math.max(effect.start + 1, Math.min(total, Math.round(b * f)));
    });
  }
  const info = $derived(showInfo || store.ui.tips);
  const hasSound = $derived(audioSources(store.project).length > 0);
  /** tracked objects in the project, for Subject Guard */
  const trackedPaths = $derived(store.project.clips.flatMap((c) => (c.paths ?? []).map((p) => ({ clipId: c.id, pathId: p.id, name: `${mediaOf(store.project, c.mediaId)?.source.name ?? 'clip'} · ${p.name}` }))));
  const strokeCount = $derived(((effect.data?.strokes as unknown[]) ?? []).length);
  const maskStrokes = $derived(((effect.data?.maskStrokes as unknown[]) ?? []).length);
  /** pictures and videos that can be a Mosh Map */
  const mapMedia = $derived(store.project.media.filter((m) => m.source.kind === 'file' && (m.hasVideo || m.source.isImage)));

  // settings saved for this kind of effect
  const saved = $derived(fxPrefs.presets[effect.type] ?? []);
  async function onSaved(v: string) {
    if (v.startsWith('use:')) {
      const p = saved.find((x) => x.name === v.slice(4));
      if (p) applyFxPreset(effect, p);
    } else if (v === 'save') {
      const name = await askText(`Name these ${def.name} settings`, `My ${def.name}`);
      if (name?.trim()) {
        saveFxPreset(effect, name.trim());
        store.toast(`Saved. Any ${def.name} can use “${name.trim()}” from Saved…`, 'ok');
      }
    } else if (v.startsWith('del:') && (await ask(`Delete the saved settings “${v.slice(4)}”?`, 'Delete'))) deleteFxPreset(effect.type, v.slice(4));
  }

</script>

<div class="editor" style="--c:{def.color}">
  <div class="title">
    <span class="code">{def.icon}</span>
    <input
      class="name"
      value={effect.name || tr(def.name)}
      aria-label="Effect name"
      spellcheck="false"
      onchange={(e) => store.edit(() => (effect.name = [def.name, tr(def.name)].includes((e.target as HTMLInputElement).value) ? undefined : (e.target as HTMLInputElement).value))}
    />
    <button class="icon ghost" class:on={info} title="What does this do?" aria-label="About this effect" onclick={() => (store.ui.tips ? store.setPref('tips', false) : (showInfo = !showInfo))}><Icon name="help" size={14} /></button>
    <button class="icon ghost" title="Randomize unlocked settings" aria-label="Randomize settings" onclick={randomize}><Icon name="dice" size={14} /></button>
    <select class="saved" aria-label="Saved settings" title="Settings you saved for {def.name}" value="" onchange={(e) => (onSaved((e.target as HTMLSelectElement).value), ((e.target as HTMLSelectElement).value = ''))}>
      <option value="">Saved…</option>
      {#each saved as p (p.name)}<option value={'use:' + p.name}>{p.name}</option>{/each}
      <option value="save">Save these settings…</option>
      {#if saved.length}
        <optgroup label="Delete">
          {#each saved as p (p.name)}<option value={'del:' + p.name}>Delete “{p.name}”</option>{/each}
        </optgroup>
      {/if}
    </select>
  </div>
  {#if info}<p class="desc small muted">{def.description}</p>{/if}
  {#if usesBeats(effect) && !hasSound}
    <p class="small warn">Set to the beat, but there is no music on the timeline yet: drop a song on an audio track.</p>
  {:else if usesBeats(effect) && beatInfo.status === 'ready'}
    <p class="small faint">Following {Math.round(beatInfo.bpm)} BPM. Change the music under Audio → Beats.</p>
  {/if}

  <section>
    <div class="sh">
      <span class="label">Range</span>
      <span class="mono faint small">{sec(effect.start)}–{sec(effect.end)}s · {effect.end - effect.start}f</span>
      <button
        class="icon ghost tiny"
        class:on={rangeLocked}
        title={rangeLocked ? 'Range locked for Nudge' : 'Lock range for Nudge'}
        aria-label="Lock range"
        onclick={() => store.edit(() => (effect.locks = rangeLocked ? effect.locks.filter((l) => l !== '__range') : [...effect.locks, '__range']))}
        ><Icon name={rangeLocked ? 'lock' : 'unlock'} size={12} /></button
      >
    </div>
    <div class="range">
      <label class="small">
        <span class="faint">In</span>
        <input type="number" min="0" max={total} value={effect.start} onchange={(e) => store.edit(() => (effect.start = Math.max(0, Math.min(effect.end - 1, Math.round(+(e.target as HTMLInputElement).value)))))} />
      </label>
      <button class="tiny" title="Set in point to playhead" onclick={() => store.edit(() => (effect.start = Math.min(effect.end - 1, playSrc)))}>Mark in</button>
      <label class="small">
        <span class="faint">Out</span>
        <input type="number" min="1" max={total} value={effect.end} onchange={(e) => store.edit(() => (effect.end = Math.max(effect.start + 1, Math.min(total, Math.round(+(e.target as HTMLInputElement).value)))))} />
      </label>
      <button class="tiny" title="Set out point to playhead" onclick={() => store.edit(() => (effect.end = Math.max(effect.start + 1, playSrc + 1)))}>Mark out</button>
      <div class="fit">
        <button class="tiny ghost" title="Cover the whole timeline" onclick={() => store.edit(() => ((effect.start = 0), (effect.end = total)))}>All</button>
        {#if marked}
          <button class="tiny ghost" title="Cover the In–Out range marked with I and O" onclick={() => fitTo(marked[0], marked[1])}>In–Out</button>
        {/if}
        {#if clipUnder}
          <button class="tiny ghost" title="Cover the clip under the playhead" onclick={() => fitTo(clipUnder.start, clipUnder.end)}>Clip</button>
        {/if}
      </div>
    </div>
    <div class="small faint">{((effect.end - effect.start) / store.fps).toFixed(2)} s long. Drag the bar's ends on the timeline to change it.</div>
  </section>

  {#if effect.type === 'mask'}
    <section>
      <div class="sh"><span class="label">Subject</span></div>
      {#if effect.params.source === 'track'}
        {#if trackedPaths.length}
          <select class="full" value={effect.data?.pathId ?? ''} aria-label="Tracked object" onchange={(e) => { const v = (e.target as HTMLSelectElement).value; const tp = trackedPaths.find((x) => x.pathId === v); store.edit(() => (effect.data = { ...(effect.data ?? {}), clipId: tp?.clipId, pathId: tp?.pathId })); }}>
            <option value="">Pick a tracked object…</option>
            {#each trackedPaths as tp}<option value={tp.pathId}>{tp.name}</option>{/each}
          </select>
        {:else}
          <p class="small warn">No tracked objects yet: select a clip, open the Clip tab and use Track an object.</p>
        {/if}
      {:else if effect.params.source === 'chroma'}
        <label class="row small">Colour <input type="color" value={String(effect.data?.color ?? '#00ff00')} oninput={(e) => store.edit(() => (effect.data = { ...(effect.data ?? {}), color: (e.target as HTMLInputElement).value }), 'guardcol' + effect.id)} /></label>
      {:else if effect.params.source === 'person'}
        <p class="small faint">The people model (a few MB) is downloaded the first time and runs on this device. Shows in the Mosh view.</p>
      {:else if effect.params.source === 'paint'}
        <div class="row">
          <button class="tiny" class:on={store.ui.paintEffect === effect.id && !store.ui.maskErase} onclick={() => ((store.ui.maskErase = false), (store.ui.paintEffect = store.ui.paintEffect === effect.id && !store.ui.maskErase ? null : effect.id))} title="Paint where the picture stays clean">{store.ui.paintEffect === effect.id && !store.ui.maskErase ? 'Painting…' : 'Paint clean'}</button>
          <button class="tiny" class:on={store.ui.paintEffect === effect.id && store.ui.maskErase} onclick={() => ((store.ui.paintEffect = store.ui.paintEffect === effect.id && store.ui.maskErase ? null : effect.id), (store.ui.maskErase = true))} title="Paint where it moshes again">Erase</button>
        </div>
        <label class="row small">Size <input type="range" min="0.01" max="0.3" step="0.005" bind:value={store.ui.brush.radius} /></label>
        <div class="row">
          <span class="small faint grow">{maskStrokes} stroke{maskStrokes === 1 ? '' : 's'}</span>
          <button class="tiny" disabled={!maskStrokes} onclick={() => store.edit(() => (effect.data = { ...(effect.data ?? {}), maskStrokes: ((effect.data?.maskStrokes as unknown[]) ?? []).slice(0, -1) }))}>Undo stroke</button>
          <button class="tiny" disabled={!maskStrokes} onclick={() => store.edit(() => (effect.data = { ...(effect.data ?? {}), maskStrokes: [] }))}>Clear</button>
        </div>
      {:else if effect.params.source === 'media'}
        {#if mapMedia.length}
          <select class="full" value={effect.data?.mediaId ?? ''} aria-label="Map picture or video" onchange={(e) => { const v = (e.target as HTMLSelectElement).value; store.edit(() => (effect.data = { ...(effect.data ?? {}), mediaId: v || undefined })); }}>
            <option value="">Pick a picture or video…</option>
            {#each mapMedia as m}<option value={m.id}>{m.source.name}</option>{/each}
          </select>
          <p class="small faint">Its grey levels say where the picture stays clean (white) or moshes (black). Import any picture or video to use it; it doesn't need to be on the timeline.</p>
        {:else}
          <p class="small warn">Import a picture or video to use as the map (it doesn't need to be on the timeline).</p>
        {/if}
      {:else if effect.params.source === 'depth'}
        <p class="small faint">The depth model (about 25 MB) is downloaded the first time and runs on this device. Near things stay clean; flip it with Keep clean. Shows in the Mosh view.</p>
      {/if}
    </section>
  {/if}
  {#if effect.type === 'flowPaint' || effect.type === 'mvedit'}
    <section>
      <div class="sh"><span class="label">Brush</span>
        <button class="tiny" class:on={store.ui.paintEffect === effect.id} onclick={() => (store.ui.paintEffect = store.ui.paintEffect === effect.id ? null : effect.id)} title="Paint strokes on the player">{store.ui.paintEffect === effect.id ? 'Painting…' : 'Paint on the player'}</button>
      </div>
      <div class="tools">
        {#each FLOW_TOOLS as t}
          <button class="tiny" class:on={store.ui.brush.tool === t.id} title={t.hint} onclick={() => (store.ui.brush.tool = t.id)}>{t.name}</button>
        {/each}
      </div>
      <label class="row small">Size <input type="range" min="0.02" max="0.4" step="0.01" bind:value={store.ui.brush.radius} /></label>
      <label class="row small">Flow <input type="range" min="0.002" max="0.04" step="0.001" bind:value={store.ui.brush.strength} /></label>
      <div class="row">
        <span class="small faint grow">{strokeCount} stroke{strokeCount === 1 ? '' : 's'}</span>
        <button class="tiny" disabled={!strokeCount} onclick={() => store.edit(() => (effect.data = { ...(effect.data ?? {}), strokes: ((effect.data?.strokes as unknown[]) ?? []).slice(0, -1) }))}>Undo stroke</button>
        <button class="tiny" disabled={!strokeCount} onclick={() => store.edit(() => (effect.data = { ...(effect.data ?? {}), strokes: [] }))}>Clear</button>
      </div>
    </section>
  {/if}

  {#if effect.type === 'script'}
    <section>
      <div class="sh">
        <span class="label">Code</span>
        <select class="examples" aria-label="Examples" value="" onchange={(e) => { const x = SCRIPT_EXAMPLES.find((s) => s.name === (e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ''; if (x) store.edit(() => (effect.data = { ...(effect.data ?? {}), code: x.code, name: x.name })); }}>
          <option value="">Examples…</option>
          {#each SCRIPT_EXAMPLES as x}<option value={x.name}>{x.name}</option>{/each}
        </select>
      </div>
      <textarea
        class="code mono"
        spellcheck="false"
        aria-label="Script code"
        value={String(effect.data?.code ?? '')}
        oninput={(e) => {
          const code = (e.target as HTMLTextAreaElement).value;
          // typed here: yours, so it may run
          approve(code);
          store.edit(() => (effect.data = { ...(effect.data ?? {}), code }), 'code' + effect.id);
        }}
      ></textarea>
      {#if scripts.errors[effect.id]}<p class="small err">{scripts.errors[effect.id]}</p>{/if}
      <details class="small faint">
        <summary>How it works</summary>
        <p>Write <code>function mosh(frames, ctx)</code>. <code>frames</code> are the frames under the bar: <code>{'{'} type, src, pos, size {'}'}</code> (type 'I' is a full picture, 'P' motion). Return the frames to play, as their numbers in that list: repeat them, reorder them, leave them out. <code>{'{'} i, glitch: 3 {'}'}</code> also damages 3 bytes of frame <code>i</code>.</p>
        <p><code>ctx</code> has <code>amount</code> (the setting below, which can be automated or put on a knob), <code>random()</code> (repeatable), <code>fps</code>, <code>start</code>, <code>end</code> and <code>total</code>.</p>
        <p>It runs in a sandbox with no network and no access to the editor or your files, for at most 3 seconds a render.</p>
      </details>
    </section>
  {/if}

  {#if effect.type === 'sequence'}
    <section>
      <div class="sh"><span class="label">Pattern</span></div>
      <SequencerGrid {effect} />
    </section>
  {/if}

  <section>
    <div class="sh"><span class="label">Settings</span></div>
    {#each params as p (p.key)}
      <ParamControl {effect} def={p} />
    {/each}
    {#if hidden}
      <button class="ghost more small" onclick={() => store.setPref('advanced', true)}>Show {hidden} more</button>
    {/if}
  </section>

  {#if store.ui.advanced}
    <section>
      <div class="sh">
        <span class="label">Seed</span>
        <input class="seed" type="number" value={effect.seed} onchange={(e) => store.edit(() => (effect.seed = +(e.target as HTMLInputElement).value))} />
        <button class="icon ghost tiny" title="New seed" aria-label="New seed" onclick={() => store.edit(() => (effect.seed = randomSeed()))}><Icon name="reset" size={12} /></button>
        <button
          class="icon ghost tiny"
          class:on={effect.locks.includes('__seed')}
          title="Lock seed"
          aria-label="Lock seed"
          onclick={() => store.edit(() => (effect.locks = effect.locks.includes('__seed') ? effect.locks.filter((l) => l !== '__seed') : [...effect.locks, '__seed']))}
          ><Icon name={effect.locks.includes('__seed') ? 'lock' : 'unlock'} size={12} /></button
        >
      </div>
    </section>
  {/if}
</div>

<style>
  /* (textarea only: the effect's code badge in the title is a .code too) */
  textarea.code {
    width: 100%;
    min-height: 180px;
    resize: vertical;
    font-size: 11.5px;
    line-height: 1.45;
    tab-size: 2;
    white-space: pre;
  }
  .examples {
    margin-left: auto;
    max-width: 60%;
  }
  .err {
    color: var(--danger);
    white-space: pre-wrap;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin-bottom: 4px;
  }
  .full {
    width: 100%;
  }
  .warn {
    color: var(--warn);
    margin: 0;
  }
  .editor {
    display: flex;
    flex-direction: column;
    padding-bottom: 24px;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 6px 6px 12px;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    font-size: 14px;
    background: transparent;
    border-color: transparent;
    padding-left: 2px;
  }
  .name:hover,
  .name:focus {
    border-color: var(--line-2);
  }
  .desc {
    padding: 0 12px 8px;
    line-height: 1.5;
  }
  section {
    padding: 0 12px;
    border-top: 1px solid var(--line);
  }
  .sh {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
  }
  .sh .label {
    flex: 1;
  }
  .range {
    display: grid;
    grid-template-columns: auto auto 1fr;
    gap: 6px 8px;
    align-items: center;
    padding-bottom: 10px;
  }
  .range label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .range input {
    width: 70px;
  }
  /* All / In–Out / Clip share the right-hand column (one button per cell would overlap) */
  .range .fit {
    grid-column: 3;
    grid-row: 1 / span 2;
    justify-self: end;
    align-self: start;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
  }
  .tiny {
    height: 22px;
    padding: 0 7px;
    font-size: 11.5px;
  }
  button.icon.tiny {
    width: 22px;
    padding: 0;
  }
  .more {
    align-self: flex-start;
    margin: 6px 0 2px -6px;
    color: var(--text-2);
  }
  .seed {
    width: 100px;
  }
  .saved {
    width: 74px;
    height: 26px;
    font-size: 11.5px;
    padding: 0 4px;
    flex: none;
  }
</style>
