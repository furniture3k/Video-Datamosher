<script lang="ts">
  import { store } from '../lib/store.svelte';
  import Field from './Field.svelte';
  import Icon from './Icon.svelte';
  import { addAudioTrack, removeTrack } from '../lib/edit';
  import { audioSources } from '../engine/timeline';
  import { CLIP_AUDIO, type AudioSettings, type Track } from '../engine/types';
  import { audioKey } from '../engine/audiofx';
  import { beatInfo, refreshBeats, setBeatGrid, setBeatDiv } from '../lib/beatinfo.svelte';
  const a = $derived(store.project.audio);
  const set = <K extends keyof AudioSettings>(k: K) => (v: AudioSettings[K]) => store.edit((p) => (p.audio[k] = v), 'au' + k);
  const tracks = $derived(store.project.tracks.filter((t) => t.kind === 'audio'));
  const srcs = $derived(audioSources(store.project));
  const count = (t: Track) => (t.id === CLIP_AUDIO ? store.project.clips.filter((c) => c.track === 'v1').length : store.project.clips.filter((c) => c.track === t.id).length);
  const setTr = <K extends keyof Track>(t: Track, k: K) => (v: Track[K]) => store.edit(() => (t[k] = v), 'tr' + k + t.id);
  const beatKeyNow = $derived(audioKey(store.project, store.project.beatSource));
  const beatName = $derived(beatKeyNow === 'mix' ? 'everything' : (tracks.find((t) => t.id === beatKeyNow)?.name ?? beatKeyNow));
</script>

<div class="col">
  <div class="label">Beats</div>
  <div class="beats">
    <div class="row">
      <span class="bpm mono">{beatInfo.status === 'ready' ? Math.round(beatInfo.bpm) : '—'}</span>
      <span class="small muted grow">
        {#if beatInfo.status === 'working'}listening…{:else if beatInfo.status === 'ready'}BPM from {beatName}{beatInfo.confidence < 0.2 ? ' (no steady beat)' : ''}{:else if beatInfo.status === 'none'}no beat in {beatName}{:else}BPM{/if}
      </span>
      <button class="ghost" onclick={() => refreshBeats()} disabled={!srcs.length || beatInfo.status === 'working'} title="Listen to the music again">Analyse</button>
    </div>
    <Field
      type="select"
      label="Music"
      value={store.project.beatSource ?? 'auto'}
      options={[{ value: 'auto', label: `Automatic (${tracks.find((t) => t.id === audioKey(store.project, undefined))?.name ?? 'everything'})` }, { value: 'mix', label: 'Everything' }, ...tracks.map((t) => ({ value: t.id, label: t.name }))]}
      help="Where beats come from for effects set to 'On the beat', the beat grid and auto-edit. Automatic uses the first audio track with music on it."
      onchange={(v: string) => {
        store.edit((p) => (v === 'auto' ? delete p.beatSource : (p.beatSource = v)));
        refreshBeats();
      }}
    />
    <Field type="bool" label="Beat grid" value={beatInfo.grid} help="Show the beats on the timeline ruler (the first beat of each bar taller). Clips, marks and effect bars snap to them." onchange={(v: boolean) => setBeatGrid(v)} />
    {#if beatInfo.grid}
      <Field
        type="select"
        label="Grid"
        value={String(beatInfo.div)}
        options={[
          { value: '1', label: 'Beats' },
          { value: '2', label: '½ beats' },
          { value: '4', label: '¼ beats' },
        ]}
        help="What the grid marks and snaps to: every beat, or halves or quarters of a beat for faster cuts."
        onchange={(v: string) => setBeatDiv(Number(v))}
      />
    {/if}
    <button onclick={() => (store.ui.dialog = 'beatEdit')} disabled={!srcs.length || !store.project.media.some((m) => m.hasVideo)}><Icon name="music" />Auto-edit to the beat…</button>
    <button onclick={() => (store.ui.dialog = 'wordBeats')} disabled={!srcs.length}><Icon name="text" />Words on the beat…</button>
  </div>

  <div class="label sect">Mixer</div>
  {#if !srcs.length}
    <div class="small muted">Nothing audible yet. Drop music or sound files onto an audio track, or unmute clips.</div>
  {/if}
  {#each tracks as t (t.id)}
    <div class="track">
      <div class="row">
        <input class="tname" value={t.name} aria-label="Track name" onchange={(e) => setTr(t, 'name')((e.target as HTMLInputElement).value)} />
        <span class="faint small mono">{count(t)}</span>
        <button class="tb" class:on={t.muted} title="Mute" aria-label="Mute {t.name}" aria-pressed={!!t.muted} onclick={() => setTr(t, 'muted')(!t.muted)}>M</button>
        <button class="tb" class:on={t.solo} title="Solo" aria-label="Solo {t.name}" aria-pressed={!!t.solo} onclick={() => setTr(t, 'solo')(!t.solo)}>S</button>
        {#if t.id !== CLIP_AUDIO}<button class="icon ghost" title="Remove track" aria-label="Remove track" onclick={() => removeTrack(t.id)}><Icon name="x" size={12} /></button>{/if}
      </div>
      <Field label="Volume" min={0} max={2} step={0.01} value={t.volume} help="Level of everything on this track." onchange={setTr(t, 'volume')} />
      <Field type="bool" label="Follow the mosh" value={t.mosh} help="On: this track's sound stutters, skips and scrambles with the moshed picture and gets the damage below. Off: it plays clean, like a soundtrack." onchange={setTr(t, 'mosh')} />
    </div>
  {/each}
  <button class="ghost add" onclick={() => addAudioTrack()}><Icon name="plus" />Add audio track</button>

  <div class="label sect">Moshed sound</div>
  <p class="small muted intro">Applies to tracks set to follow the mosh.</p>
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
  <Field label="Master volume" min={0} max={2} step={0.05} value={a.volume} help="Output volume of everything." onchange={set('volume')} />
  <div class="label sect">Damage</div>
  <Field label="Bit depth" unit="bits" min={1} max={16} step={1} value={a.bitcrush} help="Lower = crunchier bitcrushed sound. 16 = clean." onchange={set('bitcrush')} />
  <Field label="Sample-rate crush" unit="×" min={1} max={40} step={1} value={a.downsample} help="Holds samples for longer: lo-fi, aliased, robotic." onchange={set('downsample')} />
  <Field label="Byte glitch" min={0} max={1} step={0.01} value={a.glitch} help="Randomly flips bits in the raw audio for pops and digital squeals." onchange={set('glitch')} />
  <Field label="Reverse moshed slices" min={0} max={1} step={0.01} value={a.reverseChunks} help="Chance that duplicated or moved frames play their audio backwards." onchange={set('reverseChunks')} />
</div>

<style>
  .track {
    border: 1px solid var(--line-2);
    border-radius: var(--r);
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tname {
    flex: 1;
    min-width: 0;
    background: transparent;
    border-color: transparent;
    font-weight: 600;
    padding-left: 2px;
  }
  .tname:hover,
  .tname:focus {
    border-color: var(--line-2);
  }
  .tb {
    width: 22px;
    height: 22px;
    padding: 0;
    font: 11px var(--mono);
  }
  .tb.on {
    color: var(--accent-ink);
    background: var(--warn);
    border-color: var(--warn);
  }
  .add {
    align-self: flex-start;
  }
  .beats {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bpm {
    font-size: 20px;
    font-weight: 600;
    min-width: 44px;
    color: var(--accent);
  }
  .sect {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  .intro {
    margin: 0;
  }
</style>
