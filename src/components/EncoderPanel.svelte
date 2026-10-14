<script lang="ts">
  import { store } from '../lib/store.svelte';
  import Field from './Field.svelte';
  import type { EncoderSettings, DecoderSettings } from '../engine/types';
  const e = $derived(store.project.encoder);
  const d = $derived(store.project.decoder);
  const setE = <K extends keyof EncoderSettings>(k: K) => (v: EncoderSettings[K]) => store.edit((p) => (p.encoder[k] = v), 'enc' + k);
  const setD = <K extends keyof DecoderSettings>(k: K) => (v: DecoderSettings[K]) => store.edit((p) => (p.decoder[k] = v), 'dec' + k);
  const adv = $derived(store.ui.advanced);
</script>

<div class="col">
  <p class="small muted intro">Clips are re-encoded into an old codec before moshing. These settings decide the texture: block size, how motion is tracked, how often clean frames appear.</p>

  <div class="label">Look</div>
  <Field
    type="select"
    label="Mosh codec"
    value={e.codec}
    options={[
      { value: 'mpeg4', label: 'MPEG-4 Part 2 (Xvid)' },
      { value: 'mpeg2', label: 'MPEG-2' },
      { value: 'mpeg1', label: 'MPEG-1' },
    ]}
    help="Xvid is the classic datamosh codec. MPEG-1/2 give chunkier, older-looking smears."
    onchange={setE('codec')}
  />
  <Field label="Quality → crunch" min={1} max={31} step={1} value={e.quality} help="1 = clean and detailed, 31 = huge blocky artefacts. Mid values (4–10) look the most 'datamoshy'." onchange={setE('quality')} />
  <Field label="Keyframe interval" unit="frames" min={1} max={600} step={1} value={e.gop} help="How often the encoder inserts a clean full picture (I-frame). Long intervals (300+) give long melts; short ones (12–30) give lots of keyframes for Keyframe Killer to remove." onchange={setE('gop')} />
  <Field type="bool" label="Keyframe at every clip cut" value={e.keyAtCuts} help="Forces a keyframe where each clip starts, so 'Cut Transitions' can find and remove it." onchange={setE('keyAtCuts')} />
  <Field type="bool" label="Scene-cut detection" value={e.sceneCut} help="Let the encoder add keyframes when the picture changes a lot. Usually off for moshing." onchange={setE('sceneCut')} />
  <Field
    type="select"
    label="Motion search"
    value={e.motionEst}
    options={[
      { value: 'epzs', label: 'EPZS (accurate)' },
      { value: 'xone', label: 'X1 (rough, jumpy)' },
      { value: 'zero', label: 'Zero (no motion: ghosting)' },
    ]}
    help="How the encoder looks for movement. 'Zero' stores no motion at all, so moshes become ghostly dissolves; 'X1' gives jumpier vectors."
    onchange={setE('motionEst')}
  />

  <div class="label sect">Size & time</div>
  <Field
    type="select"
    label="Mosh resolution"
    value={e.width}
    options={[320, 480, 640, 854, 960, 1280, 1920, 2560, 3840].map((w) => ({ value: w, label: `${w}px${({ 854: ' (480p)', 1280: ' (720p)', 1920: ' (1080p)', 2560: ' (1440p, slow)', 3840: ' (4K, very slow)' } as Record<number, string>)[w] ?? ''}` }))}
    help="Resolution the export is moshed at. The codec moves 16-pixel blocks, so lower resolutions give chunkier, bigger smears; you can still export at a higher size (Export → Output size) to upscale the result."
    onchange={setE('width')}
  />
  <Field
    type="select"
    label="Preview width"
    value={e.previewWidth}
    options={[240, 320, 480, 640, 854].map((w) => ({ value: w, label: `${w}px` }))}
    help="Lower = faster previews while you experiment. The mosh looks the same, just smaller."
    onchange={setE('previewWidth')}
  />
  <Field
    type="select"
    label="Aspect ratio"
    value={e.aspect}
    options={['auto', '16:9', '4:3', '1:1', '9:16', '4:5', '21:9'].map((a) => ({ value: a, label: a === 'auto' ? 'Match first clip' : a }))}
    help="Shape of the output video."
    onchange={setE('aspect')}
  />
  <Field type="select" label="Frame rate" value={e.fps} options={[8, 12, 15, 24, 25, 30, 50, 60].map((f) => ({ value: f, label: `${f} fps` }))} help="Lower frame rates make every mosh step bigger and choppier." onchange={(v: number) => store.editTimeline((p) => (p.encoder.fps = v))} />

  <div class="row small">
    <span class="grow">Forced keyframes: {e.keyMarkers.length}</span>
    {#if e.keyMarkers.length}<button class="small" onclick={() => store.edit((p) => (p.encoder.keyMarkers = []))}>Clear</button>{/if}
  </div>
  <div class="small faint">Press <span class="kbd">K</span> or double-click the keyframe lane to force a clean frame at that point.</div>

  {#if adv}
    <div class="label sect">Encoder internals</div>
    <Field label="B-frames" min={0} max={2} step={1} value={e.bframes} help="Bi-directional frames. Usually 0 for moshing; turning them on gives odd forward/backward artefacts." onchange={setE('bframes')} />
    <Field label="Motion range" min={0} max={64} step={1} value={e.meRange} help="Max motion search distance (0 = encoder default). Small values limit how far blocks can travel." onchange={setE('meRange')} />
    <Field
      type="select"
      label="Macroblock decision"
      value={e.mbd}
      options={[
        { value: 'simple', label: 'Simple' },
        { value: 'bits', label: 'Fewest bits' },
        { value: 'rd', label: 'Rate-distortion' },
      ]}
      help="How each 16×16 block chooses between coding modes."
      onchange={setE('mbd')}
    />
    <Field
      type="select"
      label="Compare function"
      value={e.cmp}
      options={['sad', 'sse', 'satd', 'dct', 'rd', 'zero', 'vsad', 'nsse'].map((v) => ({ value: v, label: v.toUpperCase() }))}
      help="Metric used for motion search. 'ZERO' makes motion search meaningless, which can give bizarre vectors."
      onchange={setE('cmp')}
    />
    {#if e.codec === 'mpeg4'}
      <Field type="bool" label="4 motion vectors / block" value={e.mv4} help="Allows 8×8 motion blocks: finer, more fluid smears." onchange={setE('mv4')} />
      <Field type="bool" label="Quarter-pixel motion" value={e.qpel} help="Sub-pixel accurate motion: smoother, silkier drift." onchange={setE('qpel')} />
    {/if}
    <Field type="bool" label="Trellis quantisation" value={e.trellis} help="Slower, cleaner compression." onchange={setE('trellis')} />

    <div class="label sect">Decoder</div>
    <Field type="bool" label="Guess missing motion" value={d.guessMvs} help="When data is damaged, invent motion from neighbours (error concealment)." onchange={setD('guessMvs')} />
    <Field type="bool" label="Deblock damage" value={d.deblock} help="Smooth over damaged blocks." onchange={setD('deblock')} />
    <Field type="bool" label="Favour inter prediction" value={d.favorInter} help="Prefer motion over intra when concealing errors." onchange={setD('favorInter')} />
    <Field type="bool" label="Ignore errors" value={d.ignoreErrors} help="Keep decoding through heavy corruption." onchange={setD('ignoreErrors')} />
    <Field type="bool" label="Show all frames" value={d.showAll} help="Output frames even when the decoder thinks they are invalid." onchange={setD('showAll')} />
  {:else}
    <button class="ghost small" style="align-self:flex-start;margin-left:-6px" onclick={() => store.setPref('advanced', true)}>Show encoder internals</button>
  {/if}
</div>

<style>
  .intro {
    margin: 0;
    line-height: 1.45;
  }
  .sect {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
</style>
