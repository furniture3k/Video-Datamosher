<script lang="ts">
  import { store } from '../lib/store.svelte';
  import Field from './Field.svelte';
  import type { AudioSettings } from '../engine/types';
  const a = $derived(store.project.audio);
  const set = <K extends keyof AudioSettings>(k: K) => (v: AudioSettings[K]) => store.edit((p) => (p.audio[k] = v), 'au' + k);
  const withAudio = $derived(store.project.clips.filter((c) => c.hasAudio));
</script>

<div class="col">
  {#if !withAudio.length}
    <div class="small muted">None of your clips have sound. Add a clip with audio to use these settings.</div>
  {/if}
  <Field
    type="select"
    label="Sound source"
    value={a.source}
    options={[
      { value: 'timeline', label: 'Timeline (all clips)' },
      { value: 'clip', label: 'One clip only' },
      { value: 'none', label: 'Silent' },
    ]}
    help="Where the soundtrack comes from."
    onchange={set('source')}
  />
  {#if a.source === 'clip'}
    <Field
      type="select"
      label="Clip"
      value={a.clipId ?? ''}
      options={[{ value: '', label: 'Choose…' }, ...withAudio.map((c) => ({ value: c.id, label: c.source.name }))]}
      help="Which clip's audio is used (it plays from the start of the video)."
      onchange={(v: string) => store.edit((p) => (p.audio.clipId = v || null))}
    />
  {/if}
  <Field
    type="select"
    label="Sync mode"
    value={a.mode}
    options={[
      { value: 'follow', label: 'Follow the mosh (stutters with it)' },
      { value: 'original', label: 'Original (unchanged)' },
    ]}
    help="Follow: every frame plays the sound that belongs to its source frame, so blooms stutter, drops skip and shuffles scramble the audio in sync with the picture."
    onchange={set('mode')}
  />
  <Field type="bool" label="Smooth stutter edges" value={a.crossfade} help="Tiny fades on each audio slice to avoid clicks. Turn off for harsher, clicky glitch audio." onchange={set('crossfade')} />
  <Field label="Volume" min={0} max={2} step={0.05} value={a.volume} help="Output volume." onchange={set('volume')} />
  <div class="section-title">Audio damage</div>
  <Field label="Bit depth" unit="bits" min={1} max={16} step={1} value={a.bitcrush} help="Lower = crunchier bitcrushed sound. 16 = clean." onchange={set('bitcrush')} />
  <Field label="Sample-rate crush" unit="×" min={1} max={40} step={1} value={a.downsample} help="Holds samples for longer: lo-fi, aliased, robotic." onchange={set('downsample')} />
  <Field label="Byte glitch" min={0} max={1} step={0.01} value={a.glitch} help="Randomly flips bits in the raw audio for pops and digital squeals." onchange={set('glitch')} />
  <Field label="Reverse moshed slices" min={0} max={1} step={0.01} value={a.reverseChunks} help="Chance that duplicated or moved frames play their audio backwards." onchange={set('reverseChunks')} />
</div>
