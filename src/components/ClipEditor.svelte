<script lang="ts">
  import { store } from '../lib/store.svelte';
  import Field from './Field.svelte';
  import Icon from './Icon.svelte';
  import { clipLen, mediaOf, layoutVideo, BLEND_TRANSITIONS, MOSH_TRANSITIONS, isMoshTransition } from '../engine/timeline';
  import { VIDEO_TRACK, type Clip, type TextClip, type TransitionType } from '../engine/types';
  import { setTransition, detach, splitAtPlayhead, deleteSelected } from '../lib/edit';

  const c = $derived(store.selectedClip);
  const media = $derived(c ? mediaOf(store.project, c.mediaId) : undefined);
  const text = $derived(store.ui.selectedClips.length === 1 ? store.project.texts.find((t) => t.id === store.ui.selectedClips[0]) : undefined);
  const trClip = $derived(store.ui.selectedTransition ? store.project.clips.find((x) => x.id === store.ui.selectedTransition) : undefined);
  const isStill = $derived(media?.source.kind === 'file' && media.source.isImage);
  const isVideo = $derived(c?.track === VIDEO_TRACK);
  const placedStart = $derived(c && isVideo ? (layoutVideo(store.project).find((p) => p.clip.id === c.id)?.start ?? 0) : (c?.start ?? 0));
  const prevName = $derived.by(() => {
    if (!trClip) return '';
    const vids = store.project.clips.filter((x) => x.track === VIDEO_TRACK);
    const prev = vids[vids.indexOf(trClip) - 1];
    return prev ? (mediaOf(store.project, prev.mediaId)?.source.name ?? '') : '';
  });

  const setC = <K extends keyof Clip>(k: K, layout = false) => (v: Clip[K]) => {
    const id = c!.id;
    const f = () => {
      const x = store.project.clips.find((y) => y.id === id);
      if (x) x[k] = v;
    };
    if (layout) store.editTimeline(f, 'clip' + k + id);
    else store.edit(f, 'clip' + k + id);
  };
  const setT = <K extends keyof TextClip>(k: K) => (v: TextClip[K]) => store.edit(() => (text![k] = v), 'text' + k + text!.id);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
</script>

{#if trClip}
  {@const t = trClip.transition}
  <div class="col">
    <div class="row"><b class="grow">Transition</b><span class="small muted nm">{prevName} → {mediaOf(store.project, trClip.mediaId)?.source.name}</span></div>
    <div class="label">Mosh</div>
    <div class="grid">
      {#each Object.entries(MOSH_TRANSITIONS) as [id, d]}
        <button class:on={t?.type === id} title={d.description} onclick={() => setTransition(trClip.id, id as TransitionType)}>{d.name}</button>
      {/each}
    </div>
    <div class="label">Classic</div>
    <div class="grid">
      <button class:on={!t} onclick={() => setTransition(trClip.id, null)}>Cut</button>
      {#each Object.entries(BLEND_TRANSITIONS) as [id, d]}
        <button class:on={t?.type === id} onclick={() => setTransition(trClip.id, id as TransitionType)}>{d.name}</button>
      {/each}
    </div>
    {#if t}
      <Field label="Length" unit="s" min={0.1} max={6} step={0.05} value={t.duration} help={isMoshTransition(t) ? 'How long the melt effect runs after the cut.' : 'How long both shots overlap. The timeline gets shorter by this much.'} onchange={(v: number) => setTransition(trClip.id, t.type, { duration: v })} />
      {#if isMoshTransition(t)}
        <Field label="Intensity" min={0} max={1} step={0.01} value={t.intensity} help="How hard the melt hits: more repeats, more corruption, stronger warp." onchange={(v: number) => setTransition(trClip.id, t.type, { intensity: v })} />
        <p class="small muted">{MOSH_TRANSITIONS[t.type].description} You'll see it in the mosh view once it has rendered.</p>
      {/if}
      <button class="ghost" onclick={() => setTransition(trClip.id, null)}><Icon name="x" />Remove transition</button>
    {/if}
  </div>
{:else if text}
  <div class="col">
    <div class="row"><b class="grow">Text</b><span class="small faint mono">{fmt(text.start)}</span></div>
    <textarea rows="3" value={text.text} oninput={(e) => setT('text')((e.target as HTMLTextAreaElement).value)} aria-label="Text"></textarea>
    <Field label="Start" unit="s" min={0} max={Math.max(1, store.duration)} step={0.05} value={text.start} help="When the text appears." onchange={setT('start')} />
    <Field label="Duration" unit="s" min={0.2} max={60} step={0.05} value={text.duration} help="How long it stays." onchange={setT('duration')} />
    <Field label="Size" min={0.02} max={0.5} step={0.005} value={text.size} help="Letter height as a share of the frame height." onchange={setT('size')} />
    <Field
      type="select"
      label="Font"
      value={text.font}
      options={[
        { value: 'sans', label: 'Sans' },
        { value: 'serif', label: 'Serif' },
        { value: 'mono', label: 'Mono' },
        { value: 'impact', label: 'Impact' },
      ]}
      help="Typeface."
      onchange={setT('font')}
    />
    <div class="row">
      <label class="row small grow">Colour <input type="color" value={text.color} oninput={(e) => setT('color')((e.target as HTMLInputElement).value)} /></label>
      <Field type="bool" label="Bold" value={text.bold} help="Heavier letters." onchange={setT('bold')} />
    </div>
    <Field label="Horizontal" min={0} max={1} step={0.01} value={text.x} help="0 = left edge, 1 = right edge." onchange={setT('x')} />
    <Field label="Vertical" min={0} max={1} step={0.01} value={text.y} help="0 = top, 1 = bottom." onchange={setT('y')} />
    <Field
      type="select"
      label="Align"
      value={text.align}
      options={[
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Centre' },
        { value: 'right', label: 'Right' },
      ]}
      help="Text alignment."
      onchange={setT('align')}
    />
    <Field type="bool" label="Shadow" value={text.shadow} help="Soft drop shadow for readability." onchange={setT('shadow')} />
    <Field type="bool" label="Background box" value={text.box} help="Dark box behind the text." onchange={setT('box')} />
    <Field label="Fade" unit="s" min={0} max={3} step={0.05} value={text.fade} help="Fade in and out." onchange={setT('fade')} />
    <Field type="bool" label="Melt with the video" value={text.moshed} help="Burn the text into the footage before moshing, so it smears and melts with everything else. Off = clean text on top." onchange={(v: boolean) => store.edit(() => (text.moshed = v))} />
    <button class="ghost" onclick={deleteSelected}><Icon name="trash" />Delete text</button>
  </div>
{:else if c && media}
  <div class="col">
    {#if media.thumb}<img src={media.thumb} alt="" class="th" />{/if}
    <div class="row">
      <b class="grow nm">{media.source.name}</b>
      <span class="small muted mono">{media.hasVideo ? `${media.width}×${media.height}` : 'sound'}</span>
    </div>
    <div class="small faint mono">{isVideo ? 'Video track' : store.project.tracks.find((t) => t.id === c.track)?.name} · at {fmt(placedStart)} · {clipLen(c).toFixed(2)} s long</div>
    <div class="row btns">
      <button class="small" onclick={splitAtPlayhead} title="Split at playhead  S"><Icon name="blade" size={13} />Split</button>
      {#if isVideo && media.hasAudio && !c.muted}<button class="small" onclick={() => detach(c.id)} title="Move this clip's sound to its own audio track"><Icon name="music" size={13} />Detach audio</button>{/if}
      <button class="small ghost" onclick={deleteSelected}><Icon name="trash" size={13} />Delete</button>
    </div>
    {#if isStill}
      <Field label="Duration" unit="s" min={0.1} max={600} step={0.1} value={c.out - c.in} help="How long this still image lasts." onchange={(v: number) => setC('out', true)(c.in + v)} />
    {:else}
      <Field label="In" unit="s" min={0} max={media.duration} step={0.04} value={c.in} help="Where the clip starts in the source file. You can also drag the clip's left edge." onchange={(v: number) => setC('in', true)(Math.min(v, c.out - 0.1))} />
      <Field label="Out" unit="s" min={0} max={media.duration} step={0.04} value={c.out} help="Where the clip ends in the source file. You can also drag the clip's right edge." onchange={(v: number) => setC('out', true)(Math.max(v, c.in + 0.1))} />
    {/if}
    {#if !isVideo}
      <Field label="Position" unit="s" min={0} max={Math.max(60, store.duration + 30)} step={0.04} value={c.start} help="Where the clip sits on the timeline." onchange={setC('start')} />
    {/if}
    <Field label="Speed" unit="×" min={0.1} max={4} step={0.05} value={c.speed} help="Slow down or speed up the clip. For moshing: slow clips have smaller motion, fast clips have bigger, wilder vectors." onchange={(v: number) => setC('speed', true)(Math.max(0.05, v))} />
    <Field type="bool" label="Reverse" value={c.reverse} help="Play the clip backwards." onchange={setC('reverse', true)} />
    {#if isVideo}
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
        onchange={setC('fit')}
      />
    {/if}
    {#if media.hasAudio}
      <div class="label sect">Sound</div>
      <Field type="bool" label={isVideo ? 'Mute clip sound' : 'Mute'} value={c.muted} help={isVideo ? 'Silence this clip (detached sound lives on an audio track).' : 'Silence this clip.'} onchange={setC('muted')} />
      <Field label="Volume" min={0} max={2} step={0.01} value={c.volume} help="1 = original level." onchange={setC('volume')} />
      <Field label="Fade in" unit="s" min={0} max={Math.min(10, clipLen(c) / 2)} step={0.05} value={c.fadeIn} help="Sound fades in at the start." onchange={setC('fadeIn')} />
      <Field label="Fade out" unit="s" min={0} max={Math.min(10, clipLen(c) / 2)} step={0.05} value={c.fadeOut} help="Sound fades out at the end." onchange={setC('fadeOut')} />
    {/if}
    {#if isVideo && store.project.clips.filter((x) => x.track === VIDEO_TRACK)[0] !== c}
      <button class="ghost" onclick={() => store.selectTransition(c.id)}><Icon name="split" />Transition into this clip{c.transition ? `: ${c.transition.type}` : ''}</button>
    {/if}
  </div>
{:else}
  <div class="muted small empty">
    <p>Select a clip, title or transition on the timeline.</p>
    <p class="faint">Drag media from the left panel onto the timeline. <span class="kbd">S</span> splits at the playhead, <span class="kbd">Del</span> deletes, right-click a clip for more.</p>
  </div>
{/if}

<style>
  .th {
    width: 100%;
    max-height: 140px;
    object-fit: cover;
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .grid button {
    font-size: 12px;
    padding: 0 6px;
  }
  .grid button.on {
    border-color: var(--accent);
    color: var(--text);
    background: var(--accent-soft);
  }
  .btns {
    flex-wrap: wrap;
    gap: 4px;
  }
  .sect {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  textarea {
    width: 100%;
    font: inherit;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--line-2);
    border-radius: var(--r);
    padding: 6px 8px;
    resize: vertical;
  }
  .empty p {
    margin: 0 0 8px;
    line-height: 1.5;
  }
</style>
