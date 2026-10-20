<script lang="ts">
  // The script: write lines (or words) and they become titles one after another, or on the beats.
  // The titles stay linked to what is written: edit the text and they change with it, keeping any
  // look you gave them.
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { beatInfo, refreshBeats } from '../lib/beatinfo.svelte';
  import { allStyles } from '../lib/styles.svelte';
  import { newText } from '../lib/edit';
  import { applyStyle } from '../engine/styles';
  import { applyScript, newScript, scriptPieces, scriptSlots, type Script } from '../engine/script';
  import { beatPoints } from '../engine/wordbeats';
  import { uid } from '../engine/timeline';
  import { tc } from '../lib/timecode';

  let script = $state<Script>(JSON.parse(JSON.stringify($state.snapshot(store.project.script) ?? newScript(Math.round(store.ui.time * 100) / 100))));
  let styleId = $state('slam');
  if (beatInfo.status !== 'ready' && beatInfo.status !== 'working') refreshBeats();
  const fps = $derived(store.project.encoder.fps);
  const pieces = $derived(scriptPieces(script));
  const points = $derived(script.mode === 'beats' && beatInfo.status === 'ready' ? beatPoints(beatInfo.beats, script.every) : []);
  const slots = $derived(scriptSlots(pieces.length, script, points));

  /** make the titles match what is written now (one undo step for a run of typing) */
  function apply() {
    const base = newText(0);
    applyStyle(base, allStyles().find((s) => s.id === styleId) ?? allStyles()[0]);
    const { id: _i, text: _t, start: _s, duration: _d, row: _r, ...like } = base;
    let made: Script | null = null;
    store.edit((p) => {
      const r = applyScript(p.layers, JSON.parse(JSON.stringify(script)), points, like, uid);
      p.layers = r.layers;
      p.script = r.script;
      made = r.script;
    }, 'script');
    if (made) script.ids = (made as Script).ids;
  }
  function set<K extends keyof Script>(k: K, v: Script[K]) {
    script[k] = v;
    apply();
  }
  function unlink() {
    store.edit((p) => delete p.script);
    store.ui.dialog = null;
  }
</script>

<Modal title="Script" onclose={() => (store.ui.dialog = null)}>
  <div class="col">
    <p class="small muted">Write your lines. Each becomes a title, one after another from {tc(script.start, fps)}. Change the words here and the titles change with them; change a title's look in the inspector and it stays.</p>
    <textarea rows="6" value={script.text} oninput={(e) => set('text', (e.target as HTMLTextAreaElement).value)} placeholder="First line&#10;Second line&#10;Third line" aria-label="Script"></textarea>
    <div class="grid">
      <label>One title per
        <select value={script.per} onchange={(e) => set('per', (e.target as HTMLSelectElement).value as Script['per'])} aria-label="One title per">
          <option value="line">Line</option>
          <option value="word">Word</option>
        </select>
      </label>
      <label>Timing
        <select value={script.mode} onchange={(e) => set('mode', (e.target as HTMLSelectElement).value as Script['mode'])} aria-label="Timing">
          <option value="after">One after another</option>
          <option value="beats">On the beats</option>
        </select>
      </label>
      {#if script.mode === 'after'}
        <label>Each stays (s)
          <input type="number" min="0.2" max="20" step="0.1" value={script.hold} oninput={(e) => set('hold', Math.max(0.2, Number((e.target as HTMLInputElement).value) || 1))} aria-label="Each stays" />
        </label>
      {:else}
        <label>Every
          <select value={script.every} onchange={(e) => set('every', Number((e.target as HTMLSelectElement).value))} aria-label="Every">
            {#each [0.25, 0.5, 1, 2, 4] as n}<option value={n}>{n === 0.25 ? '¼ beat' : n === 0.5 ? '½ beat' : n === 1 ? 'beat' : `${n} beats`}</option>{/each}
          </select>
        </label>
      {/if}
      <label>Starts at (s)
        <input type="number" min="0" step="0.1" value={script.start} oninput={(e) => set('start', Math.max(0, Number((e.target as HTMLInputElement).value) || 0))} aria-label="Starts at" />
      </label>
      <label>Look of new titles
        <select bind:value={styleId} aria-label="Look">{#each allStyles() as s}<option value={s.id}>{s.name}</option>{/each}</select>
      </label>
    </div>
    <div class="small faint" aria-live="polite">
      {#if script.mode === 'beats' && beatInfo.status === 'working'}Listening for the beat…
      {:else if script.mode === 'beats' && beatInfo.status !== 'ready'}No beat yet: put some music on an audio track (or pick one after another).
      {:else if !pieces.length}Type a line.
      {:else}{slots.length} title{slots.length === 1 ? '' : 's'}, {tc(slots[0]?.[0] ?? 0, fps)} to {tc((slots.at(-1)?.[0] ?? 0) + (slots.at(-1)?.[1] ?? 0), fps)}{slots.length < pieces.length ? ` (the last ${pieces.length - slots.length} don't fit before the end)` : ''}.{/if}
    </div>
    <div class="row end">
      {#if store.project.script}<button class="ghost" onclick={unlink} title="Keep the titles but stop them following this text">Unlink the titles</button>{/if}
      <button class="primary" onclick={() => (store.ui.dialog = null)}>Done</button>
    </div>
  </div>
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
  }
  .grid label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }
  textarea {
    width: 100%;
    resize: vertical;
  }
  .end {
    justify-content: flex-end;
  }
</style>
