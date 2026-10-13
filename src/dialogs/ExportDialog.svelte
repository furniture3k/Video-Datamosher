<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import Field from '../components/Field.svelte';
  import { store } from '../lib/store.svelte';
  import { exportVideo, Cancelled } from '../lib/renderer';
  import { ffmpeg } from '../lib/ffmpeg';
  import { download, localGet, localSet } from '../lib/storage';
  import { defaultExport, type ExportOptions } from '../engine/args';
  import type { Project } from '../engine/types';

  let o = $state<ExportOptions>({ ...defaultExport(), ...localGet<Partial<ExportOptions>>('exportOpts', {}) });
  let running = $state(false);
  let stage = $state('');
  let progress = $state(0);
  let result = $state<{ url: string; name: string; size: number; type: string } | null>(null);
  let error = $state('');
  let signal = { cancelled: false };
  const hasPixel = $derived(store.project.effects.some((e) => e.enabled && ['vectorWarp', 'chroma', 'pixelSort'].includes(e.type)));
  const hasAudio = $derived(store.project.audio.source !== 'none' && store.project.clips.some((c) => c.hasAudio));

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
      const { blob, name } = await exportVideo($state.snapshot(store.project) as Project, $state.snapshot(o), (s, p) => ((stage = s), (progress = p)), signal);
      result = { url: URL.createObjectURL(blob), name, size: blob.size, type: blob.type };
      download(blob, name);
    } catch (e) {
      if (!(e instanceof Cancelled)) error = (e as Error).message;
    } finally {
      running = false;
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
      Renders at {store.project.encoder.width}px (set in Encode → Export width){#if hasPixel}{#if o.format === 'avi'}. Pixel effects (Vector Warp, Chroma, Pixel Sort) can't live inside the raw broken file, so the AVI holds only the bitstream mosh{:else}, including pixel effects{/if}{/if}.
    </div>

    {#if o.format !== 'avi'}
      <Field
        type="select"
        label="Output size"
        value={o.width}
        options={[{ value: 0, label: 'Same as project' }, ...[320, 480, 640, 960, 1280, 1920, 2560, 3840].map((w) => ({ value: w, label: `${w}px wide` }))]}
        help="Rescale the final video. Use 'Nearest' scaling for crisp, chunky pixel-art upscales."
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
        {#if result.type.startsWith('video/mp4') || result.type.startsWith('video/webm')}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={result.url} controls loop autoplay muted></video>
        {:else if result.type === 'image/gif'}
          <img src={result.url} alt="export preview" />
        {/if}
        <div class="row small">
          <span class="grow mono">{result.name} · {mb(result.size)}</span>
          <a href={result.url} download={result.name}>Download again</a>
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
  a {
    color: var(--text);
  }
  @media (max-width: 560px) {
    .formats {
      grid-template-columns: repeat(3, 1fr);
    }
  }
</style>
