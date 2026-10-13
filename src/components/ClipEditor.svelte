<script lang="ts">
  import { store } from '../lib/store.svelte';
  import Field from './Field.svelte';
  import { clipDuration } from '../engine/mosh';
  const c = $derived(store.selectedClip);
  const isStill = $derived(c?.source.kind === 'file' && c.source.isImage);
  const isGen = $derived(c?.source.kind === 'generator');
</script>

{#if !c}
  <div class="muted small">Select a clip in the Media panel.</div>
  {#if store.project.clips.length}
    <div class="col">
      {#each store.project.clips as cl, i}
        <button onclick={() => (store.ui.selectedClip = cl.id)}>{i + 1}. {cl.source.name}</button>
      {/each}
    </div>
  {/if}
{:else}
  <div class="col">
    {#if c.thumb}<img src={c.thumb} alt="" class="th" />{/if}
    <div class="row">
      <b class="grow nm">{c.source.name}</b>
      <span class="small muted mono">{c.width}×{c.height}{c.hasAudio ? ' · audio' : ''}</span>
    </div>
    {#if isStill || isGen}
      <Field label="Duration" unit="s" min={0.2} max={60} step={0.1} value={c.out} help="How long this still image / generated clip lasts." onchange={(v: number) => store.edit(() => ((c.in = 0), (c.out = v)), 'clipout' + c.id)} />
    {:else}
      <Field label="In" unit="s" min={0} max={c.duration} step={0.04} value={c.in} help="Where the clip starts in the source file." onchange={(v: number) => store.edit(() => (c.in = Math.min(v, c.out - 0.1)), 'clipin' + c.id)} />
      <Field label="Out" unit="s" min={0} max={c.duration} step={0.04} value={c.out} help="Where the clip ends in the source file." onchange={(v: number) => store.edit(() => (c.out = Math.max(v, c.in + 0.1)), 'clipout' + c.id)} />
    {/if}
    <Field label="Speed" unit="×" min={0.1} max={4} step={0.05} value={c.speed} help="Slow down or speed up the clip before moshing. Slow clips have smaller motion; fast clips have bigger, wilder vectors." onchange={(v: number) => store.edit(() => (c.speed = Math.max(0.05, v)), 'clipspd' + c.id)} />
    <Field type="bool" label="Reverse" value={c.reverse} help="Play the clip backwards." onchange={(v: boolean) => store.edit(() => (c.reverse = v))} />
    <Field
      type="select"
      label="Fit to frame"
      value={c.fit}
      options={[
        { value: 'fit', label: 'Fit (letterbox)' },
        { value: 'fill', label: 'Fill (crop)' },
        { value: 'stretch', label: 'Stretch' },
      ]}
      help="How the clip is scaled if its shape differs from the project's."
      onchange={(v: string) => store.edit(() => (c.fit = v as never))}
    />
    <div class="small faint mono">{clipDuration(c).toFixed(2)} s on the timeline</div>
  </div>
{/if}

<style>
  .th {
    width: 100%;
    max-height: 160px;
    object-fit: cover;
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
