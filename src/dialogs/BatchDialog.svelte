<script lang="ts">
  // Batch: put this project's mosh (or a recipe file's) on many videos and export them all, through
  // the export queue so you can carry on editing.
  import Modal from '../components/Modal.svelte';
  import Field from '../components/Field.svelte';
  import { store } from '../lib/store.svelte';
  import { batchExport } from '../lib/batch';
  import { localGet } from '../lib/storage';
  import { defaultExport, type ExportOptions } from '../engine/args';
  import { recipePayload, parseRecipeFile, RECIPE_EXT, type Recipe } from '../engine/recipe';
  import type { Project } from '../engine/types';

  let files = $state<File[]>([]);
  let from = $state<'project' | 'file'>(store.project.effects.length ? 'project' : 'file');
  let fileRecipe = $state<{ name: string; recipe: Recipe } | null>(null);
  let format = $state<'mp4' | 'webm' | 'gif'>((localGet<Partial<ExportOptions>>('exportOpts', {}).format as 'mp4') ?? 'mp4');
  let keepShape = $state(true);
  let status = $state('');
  let error = $state('');
  let videoInput: HTMLInputElement;
  let recipeInput: HTMLInputElement;

  const fxCount = store.project.effects.length + store.project.clips.filter((c) => c.transition).length;
  const recipe = $derived(from === 'project' ? recipePayload($state.snapshot(store.project) as Project, store.totalFrames) : fileRecipe?.recipe ?? null);

  async function pickRecipe(f: File | undefined) {
    if (!f) return;
    try {
      fileRecipe = parseRecipeFile(await f.text());
      from = 'file';
      error = '';
    } catch (e) {
      error = `${f.name}: ${(e as Error).message}`;
    }
  }

  async function go() {
    if (!recipe || !files.length) return;
    error = '';
    const o: ExportOptions = { ...defaultExport(), ...localGet<Partial<ExportOptions>>('exportOpts', {}), format, range: null };
    const r = await batchExport(files, recipe, o, { keepShape, onStatus: (s) => (status = s) });
    if (r.skipped.length) store.toast(`Skipped (no video): ${r.skipped.join(', ')}`, 'error', 7000);
    if (r.queued) {
      store.toast(`${r.queued} export${r.queued === 1 ? '' : 's'} added to the queue (bottom right).`, 'ok', 6000);
      store.ui.dialog = null;
    }
  }
</script>

<Modal title="Batch" onclose={() => (store.ui.dialog = null)}>
  <div class="col">
    <p class="small muted">The same mosh on many videos: each one gets it fitted to its own length and is exported in the background, one after another.</p>

    <div class="label">Videos</div>
    <input bind:this={videoInput} type="file" multiple accept="video/*,.mkv,.avi,.mov,.gif" hidden onchange={(e) => (files = [...((e.target as HTMLInputElement).files ?? [])])} />
    <div class="row">
      <button onclick={() => videoInput.click()} disabled={!!status}>{files.length ? 'Choose others…' : 'Choose videos…'}</button>
      <span class="small faint grow">{files.length ? `${files.length} video${files.length === 1 ? '' : 's'}` : 'None yet'}</span>
    </div>
    {#if files.length}
      <ul class="files small mono">
        {#each files as f}<li>{f.name}</li>{/each}
      </ul>
    {/if}

    <div class="label">Mosh</div>
    <label class="row small"><input type="radio" name="from" value="project" bind:group={from} disabled={!fxCount} />This project's ({fxCount} effect{fxCount === 1 ? '' : 's'} and its settings)</label>
    <label class="row small"><input type="radio" name="from" value="file" bind:group={from} />A recipe file{#if fileRecipe}: <b>{fileRecipe.name}</b>{/if}</label>
    <input bind:this={recipeInput} type="file" accept="{RECIPE_EXT},.json,application/json" hidden onchange={(e) => pickRecipe((e.target as HTMLInputElement).files?.[0])} />
    {#if from === 'file'}
      <button class="small" style="align-self:flex-start" onclick={() => recipeInput.click()}>{fileRecipe ? 'Another recipe…' : 'Choose a recipe…'}</button>
    {/if}

    <Field
      type="select"
      label="Format"
      value={format}
      options={[
        { value: 'mp4', label: 'MP4' },
        { value: 'webm', label: 'WebM' },
        { value: 'gif', label: 'GIF' },
      ]}
      help="The rest of the settings are the ones last used in Export."
      onchange={(v: 'mp4' | 'webm' | 'gif') => (format = v)}
    />
    <Field type="bool" label="Keep each video's shape" value={keepShape} help="Off: every video takes the recipe's shape (cropped or padded)." onchange={(v: boolean) => (keepShape = v)} />
    {#if status}<div class="small mono">{status}</div>{/if}
    {#if error}<div class="small err">{error}</div>{/if}
  </div>
  {#snippet footer()}
    <button onclick={() => (store.ui.dialog = null)}>Close</button>
    <button class="primary" onclick={go} disabled={!files.length || !recipe || !!status}>Export {files.length || ''} {files.length === 1 ? 'video' : 'videos'}</button>
  {/snippet}
</Modal>

<style>
  .files {
    margin: 0;
    padding: 6px 10px;
    max-height: 120px;
    overflow: auto;
    background: var(--surface-2);
    border-radius: var(--r);
    list-style: none;
  }
  .err {
    color: var(--danger);
  }
  .grow {
    flex: 1;
  }
</style>
