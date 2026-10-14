<script lang="ts">
  import { store } from '../lib/store.svelte';
  import Field from './Field.svelte';
  import Icon from './Icon.svelte';
  import { clipLen, mediaOf, layoutVideo, BLEND_TRANSITIONS, MOSH_TRANSITIONS, isMoshTransition, isOverlayTrack } from '../engine/timeline';
  import { VIDEO_TRACK, clipOn, gradeOf, transformOf, isIdentityGrade, isIdentityTransform, type Clip, type Grade, type TextClip, type Transform, type TransitionType } from '../engine/types';
  import { setTransition, detach, splitAtPlayhead, deleteSelected, toggleEnabled, freezeAtPlayhead } from '../lib/edit';

  const c = $derived(store.selectedClip);
  const media = $derived(c ? mediaOf(store.project, c.mediaId) : undefined);
  const text = $derived(store.ui.selectedClips.length === 1 ? store.project.texts.find((t) => t.id === store.ui.selectedClips[0]) : undefined);
  const trClip = $derived(store.ui.selectedTransition ? store.project.clips.find((x) => x.id === store.ui.selectedTransition) : undefined);
  const isStill = $derived(media?.source.kind === 'file' && media.source.isImage);
  const isVideo = $derived(c?.track === VIDEO_TRACK);
  const isUpper = $derived(!!c && isOverlayTrack(c.track));
  const hasPicture = $derived(!!c && !!media?.hasVideo && (isVideo || isUpper));
  const T = $derived(c ? transformOf(c) : transformOf({}));
  const Gr = $derived(c ? gradeOf(c) : gradeOf({}));
  const setTf = (k: keyof Transform) => (v: number | boolean) => {
    const id = c!.id;
    store.edit((p) => {
      const x = p.clips.find((y) => y.id === id);
      if (x) x.transform = { ...(x.transform ?? {}), [k]: v };
    }, 'tf' + k + id);
  };
  const setGr = (k: keyof Grade) => (v: number) => {
    const id = c!.id;
    store.edit((p) => {
      const x = p.clips.find((y) => y.id === id);
      if (x) x.grade = { ...(x.grade ?? {}), [k]: v };
    }, 'gr' + k + id);
  };
  const resetC = (k: 'transform' | 'grade') => {
    const id = c!.id;
    store.edit((p) => {
      const x = p.clips.find((y) => y.id === id);
      if (x) x[k] = undefined;
    });
  };
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
        <button class:on={t?.type === id} title={d.description} onclick={() => setTransition(trClip.id, id as TransitionType)}>{d.name}</button>
      {/each}
    </div>
    {#if t}
      <Field label="Length" unit="s" min={0.1} max={6} step={0.05} value={t.duration} help={isMoshTransition(t) ? 'How long the melt effect runs after the cut.' : 'How long both shots overlap. The timeline gets shorter by this much.'} onchange={(v: number) => setTransition(trClip.id, t.type, { duration: v })} />
      {#if isMoshTransition(t)}
        <Field label="Intensity" min={0} max={1} step={0.01} value={t.intensity} help="How hard the melt hits: longer blooms, more loops, more corruption, stronger warp." onchange={(v: number) => setTransition(trClip.id, t.type, { intensity: v })} />
        <Field type="bool" label="Resolve at the end" value={t.resolve !== false} help="On: a fresh keyframe at the end of the transition brings the next shot back clean, so the melt lasts exactly the Length. Off: the melt carries on until the next keyframe (often the end of the clip)." onchange={(v: boolean) => setTransition(trClip.id, t.type, { resolve: v })} />
        <p class="small muted">{MOSH_TRANSITIONS[t.type].description} The live edit view shows a plain cut; the melt appears in the mosh view once it has rendered.</p>
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
    <button class="ghost" onclick={() => deleteSelected()}><Icon name="trash" />Delete text</button>
  </div>
{:else if c && media}
  <div class="col">
    {#if media.thumb}<img src={media.thumb} alt="" class="th" />{/if}
    <div class="row">
      <b class="grow nm">{media.source.name}</b>
      <span class="small muted mono">{media.hasVideo ? `${media.width}×${media.height}` : 'sound'}</span>
    </div>
    <div class="small faint mono">{isVideo ? 'Main video track' : store.project.tracks.find((t) => t.id === c.track)?.name} · at {fmt(placedStart)} · {clipLen(c).toFixed(2)} s long{c.freeze ? ' · freeze frame' : ''}</div>
    <div class="row btns">
      <button class="small" onclick={splitAtPlayhead} title="Split at playhead  S"><Icon name="blade" size={13} />Split</button>
      <button class="small" class:on={!clipOn(c)} onclick={() => toggleEnabled()} title="Turn the clip off (it keeps its place but isn't seen or heard)  D"><Icon name={clipOn(c) ? 'eye' : 'eyeoff'} size={13} />{clipOn(c) ? 'On' : 'Off'}</button>
      {#if hasPicture && !c.freeze}<button class="small" onclick={() => freezeAtPlayhead()} title="Hold the picture at the playhead for 2 seconds  Shift R"><Icon name="freeze" size={13} />Freeze</button>{/if}
      {#if (isVideo || isUpper) && media.hasAudio && !c.muted && !c.freeze}<button class="small" onclick={() => detach(c.id)} title="Move this clip's sound to its own audio track"><Icon name="music" size={13} />Detach audio</button>{/if}
      <button class="small ghost" onclick={() => deleteSelected()}><Icon name="trash" size={13} />Delete</button>
    </div>
    {#if isStill || c.freeze}
      <Field label="Duration" unit="s" min={0.1} max={600} step={0.1} value={c.out - c.in} help={c.freeze ? 'How long the frozen frame is held.' : 'How long this still image lasts.'} onchange={(v: number) => setC('out', true)(c.in + v)} />
      {#if c.freeze && !isStill}
        <Field label="Frame" unit="s" min={0} max={media.duration} step={0.04} value={c.in} help="Which moment of the source is frozen." onchange={(v: number) => { const d = c.out - c.in; store.editTimeline((p) => { const x = p.clips.find((y) => y.id === c.id); if (x) (x.in = v), (x.out = v + d); }, 'frz' + c.id); }} />
      {/if}
    {:else}
      <Field label="In" unit="s" min={0} max={media.duration} step={0.04} value={c.in} help="Where the clip starts in the source file. You can also drag the clip's left edge." onchange={(v: number) => setC('in', true)(Math.min(v, c.out - 0.1))} />
      <Field label="Out" unit="s" min={0} max={media.duration} step={0.04} value={c.out} help="Where the clip ends in the source file. You can also drag the clip's right edge." onchange={(v: number) => setC('out', true)(Math.max(v, c.in + 0.1))} />
    {/if}
    {#if !isVideo}
      <Field label="Position" unit="s" min={0} max={Math.max(60, store.duration + 30)} step={0.04} value={c.start} help="Where the clip sits on the timeline." onchange={setC('start')} />
    {/if}
    {#if !c.freeze}
      <Field label="Speed" unit="×" min={0.05} max={16} step={0.05} value={c.speed} help="Slow down or speed up the clip (the clip gets longer or shorter; later clips move). For moshing: slow clips have smaller motion, fast clips have bigger, wilder vectors." onchange={(v: number) => setC('speed', true)(Math.max(0.05, Math.min(16, v)))}>
        <div class="seg speeds">
          {#each [0.25, 0.5, 1, 2, 4] as sp}<button class:on={c.speed === sp} onclick={() => setC('speed', true)(sp)}>{sp}×</button>{/each}
        </div>
      </Field>
      <Field type="bool" label="Reverse" value={c.reverse} help="Play the clip backwards." onchange={setC('reverse', true)} />
    {/if}
    {#if hasPicture}
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
    {#if hasPicture}
      <div class="label sect">Picture</div>
      <Field label="Opacity" min={0} max={1} step={0.01} value={c.opacity ?? 1} help={isUpper ? 'How see-through the clip is over the tracks below.' : 'Fades the picture toward black.'} onchange={(v: number) => setC('opacity')(v)} />
      {#if isUpper}
        <Field
          type="select"
          label="Blend mode"
          value={c.blend ?? 'normal'}
          options={[
            { value: 'normal', label: 'Normal', hint: 'Drawn on top.' },
            { value: 'screen', label: 'Screen', hint: 'Only brightens: black disappears. Great for light leaks, fire, glitch overlays shot on black.' },
            { value: 'add', label: 'Add', hint: 'Adds the light of both pictures: hotter and brighter than Screen.' },
            { value: 'multiply', label: 'Multiply', hint: 'Only darkens: white disappears. Good for textures, paper, grain.' },
            { value: 'difference', label: 'Difference', hint: 'Subtracts the pictures: inverted, psychedelic colours where they differ.' },
          ]}
          help="How the clip mixes with the picture below it."
          onchange={setC('blend')}
        />
      {/if}
      <Field label="Fade in" unit="s" min={0} max={Math.min(10, clipLen(c) / 2)} step={0.05} value={c.vfadeIn ?? 0} help={isUpper ? 'The picture fades in from transparent. You can also drag the dot at the clip\'s top-left corner.' : 'The picture fades in from black. You can also drag the dot at the clip\'s top-left corner.'} onchange={(v: number) => setC('vfadeIn')(v)} />
      <Field label="Fade out" unit="s" min={0} max={Math.min(10, clipLen(c) / 2)} step={0.05} value={c.vfadeOut ?? 0} help={isUpper ? 'The picture fades out to transparent.' : 'The picture fades out to black.'} onchange={(v: number) => setC('vfadeOut')(v)} />

      <div class="row sect"><span class="label grow">Transform</span>{#if !isIdentityTransform(T)}<button class="small ghost" onclick={() => resetC('transform')}><Icon name="reset" size={12} />Reset</button>{/if}</div>
      <Field label="Zoom" unit="×" min={0.05} max={4} step={0.01} value={T.zoom} help="Scales the picture around its centre. Below 1 for picture-in-picture." onchange={setTf('zoom')} />
      <Field label="Position X" min={-1} max={1} step={0.005} value={T.x} help="Moves the picture left (−) or right (+), as a share of the frame width." onchange={setTf('x')} />
      <Field label="Position Y" min={-1} max={1} step={0.005} value={T.y} help="Moves the picture up (−) or down (+), as a share of the frame height." onchange={setTf('y')} />
      <Field label="Rotation" unit="°" min={-180} max={180} step={0.5} value={T.rotate} help="Turns the picture clockwise (+) or anticlockwise (−)." onchange={setTf('rotate')} />
      <div class="row">
        <Field type="bool" label="Flip horizontal" value={T.flipH} help="Mirror left to right." onchange={setTf('flipH')} />
        <Field type="bool" label="Flip vertical" value={T.flipV} help="Upside down." onchange={setTf('flipV')} />
      </div>
      <Field label="Crop left" min={0} max={0.95} step={0.005} value={T.cropL} help="Cuts away this share of the picture's left edge." onchange={setTf('cropL')} />
      <Field label="Crop right" min={0} max={0.95} step={0.005} value={T.cropR} help="Cuts away this share of the right edge." onchange={setTf('cropR')} />
      <Field label="Crop top" min={0} max={0.95} step={0.005} value={T.cropT} help="Cuts away this share of the top edge." onchange={setTf('cropT')} />
      <Field label="Crop bottom" min={0} max={0.95} step={0.005} value={T.cropB} help="Cuts away this share of the bottom edge." onchange={setTf('cropB')} />

      <div class="row sect"><span class="label grow">Colour</span>{#if !isIdentityGrade(Gr)}<button class="small ghost" onclick={() => resetC('grade')}><Icon name="reset" size={12} />Reset</button>{/if}</div>
      <Field label="Brightness" min={-1} max={1} step={0.01} value={Gr.brightness} help="Lifts (+) or lowers (−) every level evenly." onchange={setGr('brightness')} />
      <Field label="Contrast" min={0} max={3} step={0.01} value={Gr.contrast} help="Spreads levels away from mid-grey (above 1) or squashes them together (below 1)." onchange={setGr('contrast')} />
      <Field label="Saturation" min={0} max={3} step={0.01} value={Gr.saturation} help="0 = black and white, 1 = unchanged, higher = more intense colour." onchange={setGr('saturation')} />
      <Field label="Gamma" min={0.2} max={5} step={0.01} value={Gr.gamma} help="Brightens (above 1) or darkens (below 1) the mid-tones while keeping black and white." onchange={setGr('gamma')} />
      <Field label="Hue" unit="°" min={-180} max={180} step={1} value={Gr.hue} help="Rotates every colour around the colour wheel." onchange={setGr('hue')} />
      <p class="small faint">Colour, transform and fades are applied before moshing, so they smear with the melt.</p>
    {/if}
    {#if media.hasAudio && !c.freeze}
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
