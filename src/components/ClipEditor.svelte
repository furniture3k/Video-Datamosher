<script lang="ts">
  import { store } from '../lib/store.svelte';
  import Field from './Field.svelte';
  import Icon from './Icon.svelte';
  import { clipLen, mediaOf, layoutVideo, BLEND_TRANSITIONS, MOSH_TRANSITIONS, isMoshTransition, isOverlayTrack } from '../engine/timeline';
  import { VIDEO_TRACK, clipOn, gradeOf, transformOf, isIdentityGrade, isIdentityTransform, type Clip, type Grade, type TextClip, type Transform, type TransitionType } from '../engine/types';
  import { setTransition, detach, splitAtPlayhead, deleteSelected, toggleEnabled, freezeAtPlayhead } from '../lib/edit';
  import { hasKeys, keyedValue, RAMP_PRESETS, type KeyPoint, type KeyProp } from '../engine/keys';
  import { importLuts } from '../lib/luts.svelte';
  import { openCompound, setMoshInside } from '../lib/compound.svelte';
  import { motionJob, stabilizeClip, titleFollows, clipFollows } from '../lib/motion.svelte';
  import type { ChromaKey } from '../engine/types';

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
  // ---- keyframes: values at the playhead, ◆ adds / removes a key there
  const isAdjust = $derived(media?.source.kind === 'adjust');
  const local = $derived(c ? Math.max(0, Math.min(clipLen(c), store.ui.time - placedStart)) : 0);
  const near = (t: number) => Math.abs(t - local) < 0.5 / store.fps;
  const keyed = (k: KeyProp) => (c?.keys?.[k]?.length ?? 0) > 0;
  const keyHere = (k: KeyProp) => !!c?.keys?.[k]?.some(([t]) => near(t));
  const staticOf = (k: KeyProp) => (k === 'opacity' ? (c?.opacity ?? 1) : T[k]);
  const kv = (k: KeyProp) => keyedValue(c?.keys, k, local, staticOf(k));
  function editKeys(fn: (x: Clip) => void, key: string | null = null) {
    const id = c!.id;
    store.edit((p) => {
      const x = p.clips.find((y) => y.id === id);
      if (x) fn(x);
    }, key);
  }
  /** Set a property: on keyframed properties this sets (or adds) the key at the playhead. */
  const setKeyed = (k: KeyProp) => (v: number) => {
    if (!keyed(k)) return k === 'opacity' ? setC('opacity')(v) : setTf(k)(v);
    const t = local;
    editKeys((x) => {
      const pts = (x.keys![k] ?? []).filter(([kt]) => !near(kt));
      x.keys = { ...x.keys, [k]: [...pts, [t, v]].sort((a, b) => a[0] - b[0]) as KeyPoint[] };
    }, 'kf' + k + c!.id + Math.round(t * 1000));
  };
  function toggleKey(k: KeyProp) {
    const t = local;
    const v = kv(k);
    editKeys((x) => {
      const pts = x.keys?.[k] ?? [];
      const here = pts.some(([kt]) => near(kt));
      const next = here ? pts.filter(([kt]) => !near(kt)) : [...pts, [t, v] as KeyPoint].sort((a, b) => a[0] - b[0]);
      const keys = { ...(x.keys ?? {}), [k]: next };
      if (!next.length) delete keys[k];
      x.keys = Object.keys(keys).length ? keys : undefined;
      // the last key's value stays as the plain setting
      if (here && !next.length) {
        if (k === 'opacity') x.opacity = v;
        else x.transform = { ...(x.transform ?? {}), [k]: v };
      }
    });
  }
  /** Move the playhead to the clip's previous / next keyframe. */
  function jumpKey(dir: 1 | -1) {
    const times = [...new Set(Object.values(c?.keys ?? {}).flatMap((pts) => (pts ?? []).map(([t]) => t)))].sort((a, b) => a - b);
    const next = dir > 0 ? times.find((t) => t > local + 1e-3) : [...times].reverse().find((t) => t < local - 1e-3);
    if (next !== undefined) store.seek(placedStart + next);
  }
  const anyKeys = $derived(hasKeys(c?.keys));

  // ---- speed ramp
  // a ramp's slow and fast speeds are read back from the ramp itself
  const rampSpeeds = $derived<[number, number]>(c?.ramp?.length ? [Math.min(...c.ramp.map((p) => p[1])), Math.max(...c.ramp.map((p) => p[1]))] : [0.3, 2.5]);
  const rampPreset = $derived(c?.ramp?.length ? (RAMP_PRESETS.find((r) => JSON.stringify(r.make(rampSpeeds[0], rampSpeeds[1])) === JSON.stringify(c.ramp))?.id ?? 'custom') : 'none');
  function setRamp(id: string, slow = rampSpeeds[0], fast = rampSpeeds[1]) {
    const pr = RAMP_PRESETS.find((r) => r.id === id);
    const cid = c!.id;
    store.editTimeline((p) => {
      const x = p.clips.find((y) => y.id === cid);
      if (!x) return;
      if (pr) x.ramp = pr.make(Math.min(slow, fast), Math.max(slow, fast));
      else delete x.ramp;
    }, 'ramp' + cid);
  }

  // ---- motion: stabilization and tracking
  let stabStrength = $state(20);
  const canAnalyse = $derived(!!c && media?.source.kind === 'file' && !media.source.isImage && !!media.hasVideo && !c.freeze);
  /** clips on the tracks above that could follow a tracked object */
  const followers = $derived(c ? store.project.clips.filter((x) => isOverlayTrack(x.track) && x.id !== c.id && mediaOf(store.project, x.mediaId)?.source.kind !== 'adjust') : []);

  // ---- chroma key
  const KEY_DEFAULT: ChromaKey = { color: '#00ff00', similarity: 0.25, blend: 0.08, spill: true };
  const setKey = <K extends keyof ChromaKey>(k: K) => (v: ChromaKey[K]) => editKeys((x) => (x.key = { ...(x.key ?? KEY_DEFAULT), [k]: v }), 'key' + k + c!.id);

  // ---- LUTs
  let lutInput = $state<HTMLInputElement>();
  async function pickLutFiles(files: FileList | null) {
    if (!files?.length) return;
    const ids = await importLuts([...files]);
    if (ids[0]) setGrLut(ids[0]);
  }
  const setGrLut = (id: string) => {
    const cid = c!.id;
    store.edit((p) => {
      const x = p.clips.find((y) => y.id === cid);
      if (!x) return;
      x.grade = { ...(x.grade ?? {}), lut: id || undefined };
      if (!id) delete x.grade.lut;
    });
  };

  const setT = <K extends keyof TextClip>(k: K) => (v: TextClip[K]) => store.edit(() => (text![k] = v), 'text' + k + text!.id);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
</script>

{#snippet kf(k: KeyProp)}
  <div class="kfrow">
    <button class="kf" class:on={keyHere(k)} class:has={keyed(k)} title={keyHere(k) ? 'Remove the keyframe at the playhead' : keyed(k) ? 'Add a keyframe at the playhead' : 'Animate: add a keyframe at the playhead, then move the playhead and change the value'} aria-label="Keyframe" onclick={() => toggleKey(k)}>◆</button>
    {#if keyed(k)}<span class="small faint">{c?.keys?.[k]?.length} key{c?.keys?.[k]?.length === 1 ? '' : 's'} · animated</span>{/if}
  </div>
{/snippet}

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
    {#if media.source.kind === 'file' && media.source.compound}
      <div class="row btns">
        <button class="small primary" onclick={() => openCompound(media.id)}><Icon name="folder" size={13} />Edit inside</button>
      </div>
      <Field type="bool" label="Mosh inside" value={!!media.source.compound.moshInside} help="On: the compound's own mosh effects are rendered into it, so the clip is already moshed and can be moshed again out here (a melt of a melt). Off: its effects stay out of the clip." onchange={(v: boolean) => setMoshInside(media.id, v)} />
    {/if}
    {#if isStill || c.freeze || isAdjust}
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
    {#if !c.freeze && !isAdjust}
      {#if !c.ramp}
      <Field label="Speed" unit="×" min={0.05} max={16} step={0.05} value={c.speed} help="Slow down or speed up the clip (the clip gets longer or shorter; later clips move). For moshing: slow clips have smaller motion, fast clips have bigger, wilder vectors." onchange={(v: number) => setC('speed', true)(Math.max(0.05, Math.min(16, v)))}>
        <div class="seg speeds">
          {#each [0.25, 0.5, 1, 2, 4] as sp}<button class:on={c.speed === sp} onclick={() => setC('speed', true)(sp)}>{sp}×</button>{/each}
        </div>
      </Field>
      {/if}
      <Field type="bool" label="Reverse" value={c.reverse} help="Play the clip backwards." onchange={setC('reverse', true)} />
      {#if isVideo && !isStill}
        <Field
          type="select"
          label="Speed ramp"
          value={rampPreset}
          options={[{ value: 'none', label: 'None (steady speed)' }, ...RAMP_PRESETS.map((r) => ({ value: r.id, label: r.name })), ...(rampPreset === 'custom' ? [{ value: 'custom', label: 'Custom' }] : [])]}
          help="Changes speed during the clip, from Slow to Fast. The clip's length follows. Slow parts give small, smeary motion vectors; fast parts give big, wild ones."
          onchange={(v: string) => setRamp(v)}
        />
        {#if c.ramp}
          <div class="row ramp">
            <Field label="Slow" unit="×" type="number" min={0.05} max={4} step={0.05} value={rampSpeeds[0]} help="Slowest speed of the ramp." onchange={(v: number) => rampPreset !== 'custom' && setRamp(rampPreset, v, rampSpeeds[1])} />
            <Field label="Fast" unit="×" type="number" min={0.25} max={16} step={0.05} value={rampSpeeds[1]} help="Fastest speed of the ramp." onchange={(v: number) => rampPreset !== 'custom' && setRamp(rampPreset, rampSpeeds[0], v)} />
          </div>
        {/if}
      {/if}
    {/if}
    {#if hasPicture && !isAdjust}
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
      <Field label="Opacity" min={0} max={1} step={0.01} value={kv('opacity')} help={isAdjust ? 'How strongly the adjustment applies.' : isUpper ? 'How see-through the clip is over the tracks below.' : 'Fades the picture toward black.'} onchange={setKeyed('opacity')}>{@render kf('opacity')}</Field>
      {#if isUpper && !isAdjust}
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

      {#if !isAdjust}
      <div class="row sect"><span class="label grow">Transform</span>
        {#if anyKeys}
          <button class="small ghost" title="Previous keyframe" onclick={() => jumpKey(-1)}>◀◆</button>
          <button class="small ghost" title="Next keyframe" onclick={() => jumpKey(1)}>◆▶</button>
          <button class="small ghost" title="Remove every keyframe of this clip" onclick={() => editKeys((x) => (x.keys = undefined))}>Clear keys</button>
        {/if}
        {#if !isIdentityTransform(T)}<button class="small ghost" onclick={() => resetC('transform')}><Icon name="reset" size={12} />Reset</button>{/if}
      </div>
      <Field label="Zoom" unit="×" min={0.05} max={4} step={0.01} value={kv('zoom')} help="Scales the picture around its centre. Below 1 for picture-in-picture." onchange={setKeyed('zoom')}>{@render kf('zoom')}</Field>
      <Field label="Position X" min={-1} max={1} step={0.005} value={kv('x')} help="Moves the picture left (−) or right (+), as a share of the frame width." onchange={setKeyed('x')}>{@render kf('x')}</Field>
      <Field label="Position Y" min={-1} max={1} step={0.005} value={kv('y')} help="Moves the picture up (−) or down (+), as a share of the frame height." onchange={setKeyed('y')}>{@render kf('y')}</Field>
      <Field label="Rotation" unit="°" min={-180} max={180} step={0.5} value={kv('rotate')} help="Turns the picture clockwise (+) or anticlockwise (−)." onchange={setKeyed('rotate')}>{@render kf('rotate')}</Field>
      <div class="row">
        <Field type="bool" label="Flip horizontal" value={T.flipH} help="Mirror left to right." onchange={setTf('flipH')} />
        <Field type="bool" label="Flip vertical" value={T.flipV} help="Upside down." onchange={setTf('flipV')} />
      </div>
      <Field label="Crop left" min={0} max={0.95} step={0.005} value={T.cropL} help="Cuts away this share of the picture's left edge." onchange={setTf('cropL')} />
      <Field label="Crop right" min={0} max={0.95} step={0.005} value={T.cropR} help="Cuts away this share of the right edge." onchange={setTf('cropR')} />
      <Field label="Crop top" min={0} max={0.95} step={0.005} value={T.cropT} help="Cuts away this share of the top edge." onchange={setTf('cropT')} />
      <Field label="Crop bottom" min={0} max={0.95} step={0.005} value={T.cropB} help="Cuts away this share of the bottom edge." onchange={setTf('cropB')} />
      {/if}

      {#if canAnalyse}
        <div class="row sect"><span class="label grow">Motion</span>{#if motionJob.running}<span class="small faint">{motionJob.stage}…</span>{/if}</div>
        <Field label="Stabilize strength" min={4} max={60} step={1} value={stabStrength} help="How smooth the camera should end up: bigger values iron out slower wobbles too (and zoom in more)." onchange={(v: number) => (stabStrength = v)} />
        <div class="row btns">
          <button class="small" disabled={motionJob.running} onclick={() => stabilizeClip(c.id, stabStrength)} title="Measure the camera shake and smooth it out">{c.stab ? 'Stabilize again' : 'Stabilize'}</button>
          {#if c.stab}<button class="small ghost" onclick={() => editKeys((x) => (x.stab = undefined))}>Remove ({Math.round((c.stab.zoom - 1) * 100)}% zoom)</button>{/if}
        </div>
        <div class="row btns">
          <button class="small" class:on={store.ui.trackPick === c.id} disabled={motionJob.running} onclick={() => (store.ui.trackPick = store.ui.trackPick === c.id ? null : c.id)} title="Then drag a box on the player around what to follow">Track an object</button>
        </div>
        {#each c.paths ?? [] as path (path.id)}
          <div class="pathrow">
            <span class="small grow">{path.name} · {(path.pts.at(-1)![0] - path.pts[0][0]).toFixed(1)} s</span>
            <button class="small" onclick={() => titleFollows(c.id, path.id)} title="Add a title that moves with it">Title follows</button>
            {#if followers.length}
              <select class="small" aria-label="Clip that follows" onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) clipFollows(c.id, path.id, v); (e.target as HTMLSelectElement).value = ''; }}>
                <option value="">Clip follows…</option>
                {#each followers as f}<option value={f.id}>{mediaOf(store.project, f.mediaId)?.source.name}</option>{/each}
              </select>
            {/if}
            <button class="icon ghost" aria-label="Delete track" title="Delete track" onclick={() => editKeys((x) => (x.paths = x.paths?.filter((y) => y.id !== path.id)))}><Icon name="x" size={12} /></button>
          </div>
        {/each}
      {/if}

      {#if isUpper && !isAdjust}
        <div class="row sect"><span class="label grow">Chroma key</span></div>
        <Field type="bool" label="Key out a colour" value={!!c.key} help="Green or blue screen: the colour becomes see-through and the tracks below show through it." onchange={(v: boolean) => editKeys((x) => (x.key = v ? (x.key ?? KEY_DEFAULT) : undefined))} />
        {#if c.key}
          <div class="row keyc">
            <label class="row small grow">Colour <input type="color" value={c.key.color} oninput={(e) => setKey('color')((e.target as HTMLInputElement).value)} /></label>
            <button class="small" class:on={store.ui.eyedropper} title="Click the screen colour in the player" onclick={() => (store.ui.eyedropper = !store.ui.eyedropper)}>Pick from player</button>
          </div>
          <Field label="Similarity" min={0.01} max={0.8} step={0.01} value={c.key.similarity} help="How close to the colour a pixel must be to disappear. Raise it until the screen is gone." onchange={setKey('similarity')} />
          <Field label="Softness" min={0} max={0.5} step={0.01} value={c.key.blend} help="A soft edge between kept and removed pixels." onchange={setKey('blend')} />
          <Field type="bool" label="Remove spill" value={c.key.spill} help="Takes the screen's colour cast off hair and edges." onchange={setKey('spill')} />
        {/if}
      {/if}

      <div class="row sect"><span class="label grow">Colour</span>{#if !isIdentityGrade(Gr)}<button class="small ghost" onclick={() => resetC('grade')}><Icon name="reset" size={12} />Reset</button>{/if}</div>
      <Field label="Brightness" min={-1} max={1} step={0.01} value={Gr.brightness} help="Lifts (+) or lowers (−) every level evenly." onchange={setGr('brightness')} />
      <Field label="Contrast" min={0} max={3} step={0.01} value={Gr.contrast} help="Spreads levels away from mid-grey (above 1) or squashes them together (below 1)." onchange={setGr('contrast')} />
      <Field label="Saturation" min={0} max={3} step={0.01} value={Gr.saturation} help="0 = black and white, 1 = unchanged, higher = more intense colour." onchange={setGr('saturation')} />
      <Field label="Gamma" min={0.2} max={5} step={0.01} value={Gr.gamma} help="Brightens (above 1) or darkens (below 1) the mid-tones while keeping black and white." onchange={setGr('gamma')} />
      <Field label="Hue" unit="°" min={-180} max={180} step={1} value={Gr.hue} help="Rotates every colour around the colour wheel." onchange={setGr('hue')} />
      <div class="field lutrow">
        <span class="lab" title="A look-up table (.cube) from a colourist, a camera maker or a film emulation pack, applied after the adjustments above.">LUT</span>
        <select value={Gr.lut ?? ''} aria-label="LUT" onchange={(e) => setGrLut((e.target as HTMLSelectElement).value)}>
          <option value="">None</option>
          {#each store.project.luts ?? [] as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
        </select>
        <button class="small" onclick={() => lutInput?.click()}>Import .cube…</button>
        <input bind:this={lutInput} type="file" accept=".cube" multiple hidden onchange={(e) => (pickLutFiles((e.target as HTMLInputElement).files), ((e.target as HTMLInputElement).value = ''))} />
      </div>
      {#if Gr.lut}
        <Field label="LUT amount" min={0} max={1} step={0.01} value={Gr.lutAmount ?? 1} help="How much of the LUT's look is applied." onchange={setGr('lutAmount')} />
      {/if}
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
  .kfrow {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
  }
  .kf {
    width: 20px;
    height: 18px;
    padding: 0;
    font-size: 11px;
    color: var(--text-3, var(--text-2));
    background: none;
    border-color: transparent;
  }
  .kf.has {
    color: var(--text-2);
  }
  .kf.on {
    color: var(--accent);
  }
  .keyc,
  .ramp {
    gap: 8px;
  }
  .pathrow {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .pathrow select {
    height: 24px;
    max-width: 120px;
  }
  .lutrow {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .lutrow select {
    flex: 1;
    min-width: 0;
  }
  .empty p {
    margin: 0 0 8px;
    line-height: 1.5;
  }
</style>
