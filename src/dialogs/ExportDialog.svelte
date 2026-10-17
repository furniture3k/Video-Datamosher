<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import Field from '../components/Field.svelte';
  import { store } from '../lib/store.svelte';
  import { exportVideo, Cancelled } from '../lib/renderer';
  import { markedRange } from '../lib/edit';
  import { tc } from '../lib/timecode';
  import { ffmpeg } from '../lib/ffmpeg';
  import { download, localGet, localSet, saveAs, hasSavePicker, canShareFile, shareFile } from '../lib/storage';
  import { busy } from '../lib/recovery';
  import { enqueue } from '../lib/exportqueue.svelte';
  import { reportProblem } from '../lib/report';
  import { shareCode } from '../lib/projectio.svelte';
  import { REPO } from '../lib/about';

  /** A gallery post on GitHub with this mosh's recipe filled in (the video is attached there). */
  async function submitToGallery() {
    try {
      const q = new URLSearchParams({ category: 'show-and-tell', title: `My mosh: ${store.project.name || 'Untitled'}`, recipe: await shareCode() });
      window.open(`${REPO}/discussions/new?${q}`, '_blank', 'noopener');
    } catch (e) {
      store.toast('Could not make the recipe: ' + (e as Error).message, 'error');
    }
  }
  import { onDestroy } from 'svelte';
  import { isDesktop, isAndroidApp } from '../lib/platform';
  import { blobToDisk, saveFromDisk, revealFile } from '../lib/ffmpeg-native';
  import { defaultExport, outputSize, even, type ExportOptions } from '../engine/args';
  import type { Project } from '../engine/types';
  import { audioSources } from '../engine/timeline';
  import { SOCIAL_PRESETS, bitrateFor } from '../engine/social';
  import { EFFECTS } from '../engine/effects';
  import { hasWebCodecs, hardwareCodec, encodedSize } from '../lib/webcodecs';

  const marked = markedRange();
  let onlyRange = $state(!!marked);
  let o = $state<ExportOptions>({ ...defaultExport(), ...localGet<Partial<ExportOptions>>('exportOpts', {}) });
  let running = $state(false);
  let stage = $state('');
  let progress = $state(0);
  /** url: web preview/download; file: desktop, the export on disk until saved; savedTo: where it was saved */
  let result = $state<{ url?: string; blob?: Blob; file?: string; savedTo?: string; name: string; size: number; type: string; hardware?: boolean } | null>(null);
  const shareable = $derived(result?.blob ? new File([result.blob], result.name, { type: result.type }) : null);
  let error = $state('');
  let signal = { cancelled: false };
  const hasPixel = $derived(store.project.effects.some((e) => e.enabled && EFFECTS[e.type]?.kind === 'pixel'));
  const hasAudio = $derived(audioSources(store.project).length > 0);
  const mosh = $derived(outputSize(store.project, store.project.encoder.width));
  const outW = $derived(o.width ? even(o.width) : mosh.w);
  const outH = $derived(even((outW * mosh.h) / mosh.w));
  const duration = $derived(store.duration);
  const pixels = $derived(mosh.w * mosh.h * duration * store.project.encoder.fps);
  const heavy = $derived(pixels > 1920 * 1080 * 24 * 90 || (outW >= 2560 && duration > 20));
  let social = $state(localGet<string>('exportSocial', ''));
  const sp = $derived(SOCIAL_PRESETS.find((p) => p.id === social) ?? null);
  const span = $derived(onlyRange && marked ? marked[1] - marked[0] : duration);
  const tooLong = $derived(!!sp?.maxSec && span > sp.maxSec + 0.05);
  const wrongShape = $derived(!!sp?.aspect && store.project.encoder.aspect !== sp.aspect);
  const sizedKbps = $derived(o.maxMB && (o.format === 'mp4' || o.format === 'webm') ? bitrateFor(o.maxMB, span, o.audio && hasAudio) : 0);
  function useSocial(id: string) {
    social = id;
    localSet('exportSocial', id);
    const p = SOCIAL_PRESETS.find((x) => x.id === id);
    if (!p) {
      o.maxMB = undefined;
      return;
    }
    Object.assign(o, p.opts);
    // GIFs can't aim at a size: the limit is shown as a warning instead
    o.maxMB = p.opts.format === 'gif' ? undefined : p.maxMB;
    store.ui.guides = p.guides ?? null;
  }
  function fitShape() {
    if (!sp?.aspect) return;
    const aspect = sp.aspect;
    store.edit((p) => {
      p.encoder.aspect = aspect;
      for (const c of p.clips) if (c.track === 'v1' && c.fit === 'fit') c.fit = 'fill';
    });
    store.toast(`The project is now ${aspect}. Clips on the main track fill the frame; adjust their position in the Clip tab.`, 'ok', 6000);
  }
  // whether the browser's hardware encoder can take this export (else ffmpeg encodes it)
  const webCodecs = hasWebCodecs();
  let hwCodec = $state<string | null>(null);
  $effect(() => {
    const f = o.format;
    const { w, h } = encodedSize({ srcW: mosh.w, srcH: mosh.h, width: o.width });
    if (!webCodecs || (f !== 'mp4' && f !== 'webm')) return void (hwCodec = null);
    // a slower answer for an older format or size mustn't overwrite the current one
    let stale = false;
    hardwareCodec(f, w, h).then(
      (c) => !stale && (hwCodec = c),
      () => !stale && (hwCodec = null),
    );
    return () => (stale = true);
  });
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  const FORMATS = [
    { id: 'mp4', label: 'MP4', desc: 'H.264' },
    { id: 'webm', label: 'WebM', desc: 'VP8/9 + Vorbis' },
    { id: 'gif', label: 'GIF', desc: 'no sound' },
    { id: 'avi', label: 'AVI', desc: 'the broken file' },
    { id: 'png', label: 'PNG', desc: 'zip of frames' },
  ] as const;

  async function go() {
    localSet('exportOpts', $state.snapshot(o));
    running = true;
    error = '';
    if (result?.url) URL.revokeObjectURL(result.url);
    result = null;
    const my = (signal = { cancelled: false });
    const done = busy('export');
    try {
      const r = await exportVideo($state.snapshot(store.project) as Project, { ...($state.snapshot(o) as ExportOptions), range: onlyRange ? marked : null }, (s, p) => my === signal && ((stage = s), (progress = p)), my);
      // cancelled (or the dialog closed) just as it finished: don't save it anyway
      if (my.cancelled) return;
      if (isDesktop) {
        result = { file: r.file ?? (await blobToDisk(r.blob!, r.name)), name: r.name, size: r.size, type: r.type };
        running = false;
        await save();
      } else {
        result = { url: URL.createObjectURL(r.blob!), blob: r.blob!, name: r.name, size: r.size, type: r.type, hardware: r.hardware };
        download(r.blob!, r.name);
      }
    } catch (e) {
      if (!(e instanceof Cancelled) && !my.cancelled) error = (e as Error).message;
    } finally {
      done();
      // a cancelled export that ends late mustn't mark a newer one as finished
      if (my === signal) running = false;
    }
  }
  /** Export in the background (on the second engine) and close: editing carries on meanwhile. */
  function queue() {
    localSet('exportOpts', $state.snapshot(o));
    enqueue($state.snapshot(store.project) as Project, { ...($state.snapshot(o) as ExportOptions), range: onlyRange ? marked : null });
    store.toast('Added to the export queue (bottom right). Keep editing.', 'ok');
    store.ui.dialog = null;
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
  onDestroy(() => {
    // closed mid-export (also by the editor's Escape, which skips onclose): stop it
    if (running) cancel();
    if (result?.url) URL.revokeObjectURL(result.url);
  });
  const mb = (n: number) => (n / 1048576).toFixed(n > 1e7 ? 0 : 1) + ' MB';
</script>

<Modal title="Export" onclose={() => (running ? cancel() : null, (store.ui.dialog = null))}>
  <div class="col">
    <label class="row social">
      <span class="label">Made for</span>
      <select value={social} onchange={(e) => useSocial((e.target as HTMLSelectElement).value)} disabled={running}>
        <option value="">Custom settings</option>
        {#each SOCIAL_PRESETS as p}<option value={p.id}>{p.name}</option>{/each}
      </select>
    </label>
    {#if sp}
      <div class="small muted">{sp.note}{#if sizedKbps} Video bitrate {sizedKbps} kbit/s to stay under {sp.maxMB} MB.{/if}</div>
      {#if wrongShape}
        <div class="small warn row">
          <span class="grow">{sp.name} wants {sp.aspect}; this project is {store.project.encoder.aspect === 'auto' ? 'the shape of its first clip' : store.project.encoder.aspect}.{o.reframeTo === sp.aspect ? ' It will be reframed to follow the action.' : ' It will be exported as it is.'}</span>
          {#if o.reframeTo !== sp.aspect}<button onclick={() => (o.reframeTo = sp!.aspect!)} disabled={running} title="Crop to {sp.aspect} on export, following the movement">Reframe</button>{/if}
          <button onclick={fitShape} disabled={running} title="Change the project itself to {sp.aspect}">Make it {sp.aspect}</button>
        </div>
      {/if}
      {#if tooLong}
        <div class="small warn">This is {fmt(span)} long; {sp.name} takes up to {fmt(sp.maxSec!)}. Mark an In–Out range (I and O) to export a part.</div>
      {/if}
      {#if sp.guides}
        <label class="row small"><input type="checkbox" checked={store.ui.guides === sp.guides} onchange={(e) => (store.ui.guides = (e.target as HTMLInputElement).checked ? sp!.guides! : null)} />Show the app's safe zones in the player</label>
      {/if}
      {#if sp.opts.format === 'gif' && sp.maxMB}
        <div class="small faint">GIFs can't be aimed at a size. If it comes out over {sp.maxMB} MB, lower the colours, frame rate or size.</div>
      {/if}
    {/if}
    <div class="formats">
      {#each FORMATS as f}
        <button class="fmt" class:on={o.format === f.id} onclick={() => ((o.format = f.id), sp && sp.opts.format !== f.id && useSocial(''))} disabled={running}>
          <b>{f.label}</b><span class="small muted">{f.desc}</span>
        </button>
      {/each}
    </div>

    <div class="small muted">
      Moshed at {mosh.w}×{mosh.h} (Encode → Mosh resolution){#if o.width && o.format !== 'avi'}, saved at {outW}×{outH}{o.width > mosh.w ? ' (upscaled)' : ''}{/if} · {fmt(duration)} at {store.project.encoder.fps} fps{#if hasPixel}{#if o.format === 'avi'}. Picture effects (Vector Warp, Chroma, Pixel Sort, Raw Bend) can't live inside the raw broken file, so the AVI holds only the bitstream mosh{:else}, including pixel effects{/if}{/if}.
    </div>
    {#if heavy && !isDesktop}
      <div class="small warn">This is a big render for a browser ({Math.round(pixels / 1e6)} megapixel-frames). Expect it to take a while; keep this tab in front. Lower the mosh resolution or use "Ultra fast" to speed it up.</div>
    {/if}

    {#if o.format !== 'avi'}
      <Field
        type="select"
        label="Output size"
        value={o.width}
        options={[{ value: 0, label: `Same as mosh (${mosh.w}px)` }, ...[...new Set([480, 640, 720, 854, 1080, 1280, 1920, 2560, 3840, ...(o.width ? [o.width] : [])])].sort((a, b) => a - b).map((w) => ({ value: w, label: ({ 854: '480p', 1280: '720p HD', 1920: '1080p Full HD', 2560: '1440p QHD', 3840: '4K UHD' } as Record<number, string>)[w] ? `${({ 854: '480p', 1280: '720p HD', 1920: '1080p Full HD', 2560: '1440p QHD', 3840: '4K UHD' } as Record<number, string>)[w]} (${w}px)` : `${w}px wide` }))]}
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
      {#if !o.maxMB}
        <Field label="Quality (CRF)" min={0} max={40} step={1} value={o.crf} help="Lower = better quality and bigger file. 18 is visually lossless." onchange={(v: number) => (o.crf = v)} />
      {/if}
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
    {#if webCodecs && (o.format === 'mp4' || o.format === 'webm')}
      <Field
        type="bool"
        label="Hardware encoding"
        value={o.hardware ?? true}
        help={hwCodec
          ? `Encode with your device's own ${hwCodec === 'avc' ? 'H.264' : hwCodec.toUpperCase()} encoder: several times faster. Turn off to use the built-in encoder (slower, follows Encoding speed exactly).`
          : `This browser has no ${o.format === 'mp4' ? 'H.264' : 'VP8/VP9'} encoder of its own at this size, so the built-in one is used.`}
        onchange={(v: boolean) => (o.hardware = v)}
      />
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
    {#if o.format !== 'avi'}
      <Field
        type="select"
        label="Shape"
        value={o.reframeTo ?? ''}
        options={[{ value: '', label: 'As the project' }, ...['9:16', '4:5', '1:1', '16:9', '21:9'].map((a) => ({ value: a, label: `${a} (reframe)` }))]}
        help="Export in another shape: the picture is cropped, and the crop slides to follow where the movement is."
        onchange={(v: string) => (o.reframeTo = v || undefined)}
      />
    {/if}
    {#if o.format === 'mp4' || o.format === 'webm' || o.format === 'gif'}
      <Field
        type="select"
        label="Loop"
        value={o.loopMode ?? 'off'}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'crossfade', label: 'Seamless (crossfade)', hint: 'The end fades into the start, so the video loops without a jump. It gets a little shorter.' },
          { value: 'melt', label: 'Seamless (melt)', hint: 'The start melts out of the end picture, datamosh style, so the loop flows on.' },
        ]}
        help="For GIFs, Reels and anything that plays on repeat."
        onchange={(v: 'off' | 'crossfade' | 'melt') => (o.loopMode = v)}
      />
      {#if o.loopMode && o.loopMode !== 'off'}
        <Field label="Seam" unit="s" min={0.1} max={3} step={0.05} value={o.loopSeconds ?? 0.5} help="How long the end blends or melts into the start." onchange={(v: number) => (o.loopSeconds = v)} />
      {/if}
    {/if}
    {#if marked && o.format !== 'avi' && (!o.loopMode || o.loopMode === 'off')}
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
    {#if error}<div class="err small">{error} <button class="link" onclick={() => reportProblem(`Exporting ${o.format.toUpperCase()} failed: ${error}`)}>Report this</button></div>{/if}
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
          <span class="grow mono">{result.savedTo ?? result.name} · {mb(result.size)}{#if result.hardware} · hardware encoded{/if}</span>
          {#if result.savedTo}
            <button class="link" onclick={() => revealFile(result!.savedTo!)}>Show in folder</button>
          {:else if result.file}
            <button class="link" onclick={save}>Save…</button>
          {:else}
            {#if shareable && canShareFile(shareable)}<button class="link" onclick={() => shareFile(shareable!, 'Made with moshpit')}>Share…</button>{/if}
            {#if hasSavePicker() && result.blob}<button class="link" onclick={() => saveAs(result!.blob!, result!.name)}>Save as…</button>{/if}
            {#if isAndroidApp}<button class="link" onclick={() => download(result!.blob!, result!.name)}>Save again</button>{:else}<a href={result.url} download={result.name}>Download again</a>{/if}
          {/if}
        </div>
        <p class="small faint">Proud of it? <button class="link" onclick={submitToGallery}>Share it in the gallery</button>: it goes up with its recipe, so others can use it on their footage.</p>
      </div>
    {/if}
  </div>
  {#snippet footer()}
    {#if running}
      <button onclick={cancel}>Cancel</button>
    {:else}
      <button onclick={() => (store.ui.dialog = null)}>Close</button>
      <button onclick={queue} title="Export in the background and keep editing; you'll be told when it's ready">Add to queue</button>
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
  .social select {
    flex: 1;
  }
  .warn.row {
    gap: 8px;
    align-items: center;
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
