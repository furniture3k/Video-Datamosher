<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import Field from '../components/Field.svelte';
  import { store } from '../lib/store.svelte';
  import { exportVideo, Cancelled } from '../lib/renderer';
  import { markedRange } from '../lib/edit';
  import { tc } from '../lib/timecode';
  import { ffmpeg } from '../lib/ffmpeg';
  import { download, localGet, localSet } from '../lib/storage';
  import { isDesktop } from '../lib/platform';
  import { blobToDisk, saveFromDisk, revealFile } from '../lib/ffmpeg-native';
  import { defaultExport, outputSize, even, type ExportOptions } from '../engine/args';
  import type { Project } from '../engine/types';
  import { audioSources } from '../engine/timeline';

  const marked = markedRange();
  let onlyRange = $state(!!marked);
  let o = $state<ExportOptions>({ ...defaultExport(), ...localGet<Partial<ExportOptions>>('exportOpts', {}) });
  let running = $state(false);
  let stage = $state('');
  let progress = $state(0);
  /** url: web preview/download; file: desktop, the export on disk until saved; savedTo: where it was saved */
  let result = $state<{ url?: string; file?: string; savedTo?: string; name: string; size: number; type: string } | null>(null);
  let error = $state('');
  let signal = { cancelled: false };
  const hasPixel = $derived(store.project.effects.some((e) => e.enabled && ['vectorWarp', 'chroma', 'pixelSort'].includes(e.type)));
  const hasAudio = $derived(audioSources(store.project).length > 0);
  const mosh = $derived(outputSize(store.project, store.project.encoder.width));
  const outW = $derived(o.width ? even(o.width) : mosh.w);
  const outH = $derived(even((outW * mosh.h) / mosh.w));
  const duration = $derived(store.duration);
  const pixels = $derived(mosh.w * mosh.h * duration * store.project.encoder.fps);
  const heavy = $derived(pixels > 1920 * 1080 * 24 * 90 || (outW >= 2560 && duration > 20));
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  const FORMATS = [
    { id: 'mp4', label: 'MP4', desc: 'H.264' },
    { id: 'webm', label: 'WebM', desc: 'VP8 + Vorbis' },
    { id: 'gif', label: 'GIF', desc: 'no sound' },
    { id: 'avi', label: 'AVI', desc: 'the broken file' },
    { id: 'png', label: 'PNG', desc: 'zip of frames' },
  ] as const;

  async function go() {
    localSet('exportOpts', $state.snapshot(o));
    running = true;
    error = '';
    result = null;
    signal = { cancelled: false };
    try {
      const r = await exportVideo($state.snapshot(store.project) as Project, { ...$state.snapshot(o), range: onlyRange ? marked : null }, (s, p) => ((stage = s), (progress = p)), signal);
      if (isDesktop) {
        result = { file: r.file ?? (await blobToDisk(r.blob!, r.name)), name: r.name, size: r.size, type: r.type };
        running = false;
        await save();
      } else {
        result = { url: URL.createObjectURL(r.blob!), name: r.name, size: r.size, type: r.type };
        download(r.blob!, r.name);
      }
    } catch (e) {
      if (!(e instanceof Cancelled)) error = (e as Error).message;
    } finally {
      running = false;
    }
  }
  /** Desktop: native Save dialog; the export is moved to the chosen place. */
  async function save() {
    if (!result?.file) return;
    try {
      const to = await saveFromDisk(result.file, result.name);
      if (to) result = { ...result, file: undefined, savedTo: to };
    } catch (e) {
      error = 'Could not save: ' + ((e as Error)?.message ?? e);
    }
  }
  function cancel() {
    signal.cancelled = true;
    ffmpeg.cancel();
    running = false;
    stage = '';
  }
  const mb = (n: number) => (n / 1048576).toFixed(n > 1e7 ? 0 : 1) + ' MB';
</script>

<Modal title="Export" onclose={() => (running ? cancel() : null, (store.ui.dialog = null))}>
  <div class="col">
    <div class="formats">
      {#each FORMATS as f}
        <button class="fmt" class:on={o.format === f.id} onclick={() => (o.format = f.id)} disabled={running}>
          <b>{f.label}</b><span class="small muted">{f.desc}</span>
        </button>
      {/each}
    </div>

    <div class="small muted">
      Moshed at {mosh.w}×{mosh.h} (Encode → Mosh resolution){#if o.width && o.format !== 'avi'}, saved at {outW}×{outH}{o.width > mosh.w ? ' (upscaled)' : ''}{/if} · {fmt(duration)} at {store.project.encoder.fps} fps{#if hasPixel}{#if o.format === 'avi'}. Pixel effects (Vector Warp, Chroma, Pixel Sort) can't live inside the raw broken file, so the AVI holds only the bitstream mosh{:else}, including pixel effects{/if}{/if}.
    </div>
    {#if heavy && !isDesktop}
      <div class="small warn">This is a big render for a browser ({Math.round(pixels / 1e6)} megapixel-frames). Expect it to take a while; keep this tab in front. Lower the mosh resolution or use "Ultra fast" to speed it up.</div>
    {/if}

    {#if o.format !== 'avi'}
      <Field
        type="select"
        label="Output size"
        value={o.width}
        options={[{ value: 0, label: `Same as mosh (${mosh.w}px)` }, ...[480, 640, 854, 1280, 1920, 2560, 3840].map((w) => ({ value: w, label: ({ 854: '480p', 1280: '720p HD', 1920: '1080p Full HD', 2560: '1440p QHD', 3840: '4K UHD' } as Record<number, string>)[w] ? `${({ 854: '480p', 1280: '720p HD', 1920: '1080p Full HD', 2560: '1440p QHD', 3840: '4K UHD' } as Record<number, string>)[w]} (${w}px)` : `${w}px wide` }))]}
        help="Rescale the final video. Use 'Nearest' scaling for crisp, chunky pixel-art upscales of a low-res mosh."
        onchange={(v: number) => (o.width = v)}
      />
      {#if o.width}
        <Field
          type="select"
          label="Scaling"
          value={o.scaler}
          options={[
            { value: 'neighbor', label: 'Nearest (crisp blocks)' },
            { value: 'bicubic', label: 'Bicubic (smooth)' },
            { value: 'lanczos', label: 'Lanczos (sharp)' },
          ]}
          help="How pixels are resized."
          onchange={(v: string) => (o.scaler = v as never)}
        />
      {/if}
    {/if}
    {#if o.format === 'mp4' || o.format === 'webm'}
      <Field label="Quality (CRF)" min={0} max={40} step={1} value={o.crf} help="Lower = better quality and bigger file. 18 is visually lossless." onchange={(v: number) => (o.crf = v)} />
      {#if o.format === 'mp4'}
        <Field
          type="select"
          label="Encoding speed"
          value={o.preset}
          options={[
            { value: 'ultrafast', label: 'Ultra fast' },
            { value: 'veryfast', label: 'Very fast' },
            { value: 'medium', label: 'Medium' },
            { value: 'slow', label: 'Slow (smallest file)' },
          ]}
          help="Slower presets give smaller files at the same quality."
          onchange={(v: string) => (o.preset = v as never)}
        />
      {/if}
    {/if}
    {#if o.format === 'gif'}
      <Field label="GIF frame rate" unit="fps" min={5} max={30} step={1} value={o.gifFps} help="Lower = smaller file." onchange={(v: number) => (o.gifFps = v)} />
      <Field label="Colours" min={8} max={256} step={8} value={o.gifColors} help="Fewer colours give a smaller, posterised GIF." onchange={(v: number) => (o.gifColors = v)} />
      <Field
        type="select"
        label="Dithering"
        value={o.gifDither}
        options={[
          { value: 'bayer', label: 'Bayer (retro pattern)' },
          { value: 'floyd_steinberg', label: 'Floyd–Steinberg (smooth)' },
          { value: 'sierra2_4a', label: 'Sierra (soft)' },
          { value: 'none', label: 'None (banding)' },
        ]}
        help="How missing colours are simulated."
        onchange={(v: string) => (o.gifDither = v as never)}
      />
      <Field type="bool" label="Loop forever" value={o.loop} help="Play the GIF on repeat." onchange={(v: boolean) => (o.loop = v)} />
    {/if}
    {#if marked && o.format !== 'avi'}
      <Field type="bool" label="Only the In–Out range" value={onlyRange} help="Export just the part marked with I and O ({tc(marked[0], store.fps)} → {tc(marked[1], store.fps)}). The mosh is still worked out from the start, so it looks exactly as it does in the full video." onchange={(v: boolean) => (onlyRange = v)} />
    {/if}
    {#if o.format !== 'gif' && o.format !== 'png' && hasAudio}
      <Field type="bool" label="Include audio" value={o.audio} help="Uses the settings from the Audio tab." onchange={(v: boolean) => (o.audio = v)} />
    {/if}

    {#if running}
      <div class="prog">
        <div class="bar"><div style="width:{Math.round(progress * 100)}%"></div></div>
        <span class="small mono">{stage}… {Math.round(progress * 100)}%</span>
      </div>
    {/if}
    {#if error}<div class="err small">{error}</div>{/if}
    {#if result}
      <div class="done">
        {#if !result.url}
          <!-- desktop: nothing to preview here, the file is on disk -->
        {:else if result.type.startsWith('video/mp4') || result.type.startsWith('video/webm')}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={result.url} controls loop autoplay muted></video>
        {:else if result.type === 'image/gif'}
          <img src={result.url} alt="export preview" />
        {/if}
        <div class="row small">
          <span class="grow mono">{result.savedTo ?? result.name} · {mb(result.size)}</span>
          {#if result.savedTo}
            <button class="link" onclick={() => revealFile(result!.savedTo!)}>Show in folder</button>
          {:else if result.file}
            <button class="link" onclick={save}>Save…</button>
          {:else}
            <a href={result.url} download={result.name}>Download again</a>
          {/if}
        </div>
      </div>
    {/if}
  </div>
  {#snippet footer()}
    {#if running}
      <button onclick={cancel}>Cancel</button>
    {:else}
      <button onclick={() => (store.ui.dialog = null)}>Close</button>
      <button class="primary" onclick={go}>Export {o.format.toUpperCase()}</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .formats {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    border: 1px solid var(--line-2);
    border-radius: var(--r);
    overflow: hidden;
  }
  .fmt {
    height: auto;
    flex-direction: column;
    gap: 1px;
    padding: 7px 4px;
    border: none;
    border-radius: 0;
    background: var(--surface-2);
  }
  .fmt + .fmt {
    border-left: 1px solid var(--line-2);
  }
  .fmt span {
    font-size: 11px;
  }
  .fmt.on {
    background: var(--surface-3);
    box-shadow: inset 0 -2px 0 var(--accent);
    color: var(--text);
  }
  .prog {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .bar {
    flex: 1;
    height: 2px;
    background: var(--line-2);
  }
  .bar div {
    height: 100%;
    background: var(--accent);
  }
  .warn {
    color: var(--warn);
    line-height: 1.4;
  }
  .err {
    color: var(--danger);
    white-space: pre-wrap;
  }
  .done {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .done video,
  .done img {
    width: 100%;
    max-height: 300px;
    background: #000;
    object-fit: contain;
  }
  a,
  .link {
    color: var(--text);
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    height: auto;
    font: inherit;
    text-decoration: underline;
  }
  @media (max-width: 560px) {
    .formats {
      grid-template-columns: repeat(3, 1fr);
    }
  }
</style>
