<script lang="ts">
  // The phone editor. Built like mobile video editors: a big preview, a scrolling timeline with
  // the playhead in the middle, and a row of tools along the bottom that changes with what's
  // selected. Tools open sheets that slide over the timeline, so the preview stays in view.
  import { store } from '../lib/store.svelte';
  import { addFiles, addToTimeline, loadExample } from '../lib/media';
  import * as edit from '../lib/edit';
  import { saveProjectFile, loadProjectFile, startNewProject } from '../lib/projectio.svelte';
  import { reportProblem } from '../lib/report';
  import * as haptics from '../lib/haptics';
  import { goHome } from '../lib/projects.svelte';
  import { VIDEO_TRACK } from '../engine/types';
  import { BLEND_TRANSITIONS, MOSH_TRANSITIONS, clipLen, layoutVideo, isMoshTransition } from '../engine/timeline';
  import { EFFECTS } from '../engine/effects';
  import { closeCompound } from '../lib/compound.svelte';
  import Player from '../components/Player.svelte';
  import MediaBin from '../components/MediaBin.svelte';
  import ClipEditor from '../components/ClipEditor.svelte';
  import EffectStack from '../components/EffectStack.svelte';
  import EffectEditor from '../components/EffectEditor.svelte';
  import EncoderPanel from '../components/EncoderPanel.svelte';
  import AudioPanel from '../components/AudioPanel.svelte';
  import ChaosDial from '../components/ChaosDial.svelte';
  import Icon from '../components/Icon.svelte';
  import Logo from '../components/Logo.svelte';
  import MobileTimeline from './MobileTimeline.svelte';
  import Sheet from './Sheet.svelte';

  let { onchaos }: { onchaos: () => void } = $props();

  type SheetId = 'media' | 'effects' | 'fx' | 'clip' | 'speed' | 'volume' | 'transition' | 'look' | 'audio' | 'chaos' | 'menu';
  let sheet = $state<SheetId | null>(null);
  let fileInput: HTMLInputElement;
  let audioInput: HTMLInputElement;
  let loadInput: HTMLInputElement;

  const clip = $derived(store.selectedClip);
  const text = $derived(store.ui.selectedClips.length === 1 ? store.project.texts.find((t) => t.id === store.ui.selectedClips[0]) : undefined);
  const fx = $derived(store.selected);
  const hasClips = $derived(store.project.clips.length > 0 || store.project.texts.length > 0);
  const mode = $derived(fx ? 'fx' : text ? 'text' : clip ? (clip.track === VIDEO_TRACK ? 'video' : 'audio') : 'root');
  const TITLES: Record<SheetId, string> = {
    media: 'Media',
    effects: 'Mosh effects',
    fx: 'Effect settings',
    clip: 'Adjust',
    speed: 'Speed',
    volume: 'Volume',
    transition: 'Transition',
    look: 'Mosh look',
    audio: 'Audio & beats',
    chaos: 'Chaos',
    menu: 'moshpit',
  };

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    const added = await addFiles(files, 'none');
    for (const m of added) addToTimeline(m);
    sheet = null;
  }
  function deselect() {
    store.selectClip(null);
    store.selectEffect(null);
    store.ui.selectedTransition = null;
    sheet = null;
  }
  function setSpeed(v: number) {
    const id = clip!.id;
    store.editTimeline((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (c) ((c.speed = v), (c.ramp = undefined));
    }, 'mspeed' + id);
  }
  function setVolume(v: number) {
    const id = clip!.id;
    store.edit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (c) c.volume = v;
    }, 'mvol' + id);
  }
  function toggleReverse() {
    const id = clip!.id;
    store.editTimeline((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (c) c.reverse = !c.reverse;
    });
  }
  /** Put a mosh effect over the selected clip (or the whole video). */
  function moshThis() {
    store.ui.dialog = 'addEffect';
  }
  function action(a: 'fx' | 'text' | 'music' | 'transition') {
    if (a === 'fx') store.ui.dialog = 'addEffect';
    else if (a === 'text') edit.addText();
    else if (a === 'music') audioInput.click();
    else sheet = 'transition';
  }
  const trClip = $derived(store.ui.selectedTransition ? store.project.clips.find((c) => c.id === store.ui.selectedTransition) : undefined);
  $effect(() => {
    // a transition picked on the timeline opens its sheet; leaving it closes the sheet
    if (!trClip && sheet === 'transition') sheet = null;
  });
  $effect(() => {
    // the effect settings sheet follows the selection
    if (!fx && sheet === 'fx') sheet = null;
    if (!clip && !text && (sheet === 'speed' || sheet === 'volume' || sheet === 'clip')) sheet = null;
  });

  const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
</script>

<div class="m">
  <header>
    <button class="icon ghost hb" aria-label="Menu" onclick={() => (sheet = sheet === 'menu' ? null : 'menu')}><Logo size={24} /></button>
    {#if store.seqStack.length}
      <button class="crumb" onclick={() => closeCompound()}><Icon name="back" size={14} />{store.seqStack.at(-1)?.name}</button>
    {:else}
      <input class="name" value={store.project.name} aria-label="Project name" spellcheck="false" onchange={(e) => store.edit((p) => (p.name = (e.target as HTMLInputElement).value))} />
    {/if}
    <span class="busy" class:on={store.status.busy}>{store.status.busy ? Math.round(store.status.progress * 100) + '%' : ''}</span>
    <button class="primary export" data-tour="export" disabled={!hasClips} onclick={() => (store.ui.dialog = 'export')}>Export</button>
  </header>

  <section class="preview" data-tour="preview"><Player compact /></section>

  <section class="work" data-tour="timeline">
    <MobileTimeline onadd={() => fileInput.click()} onaction={action} />

    {#if sheet}
      <Sheet title={sheet === 'fx' && fx ? (fx.name || EFFECTS[fx.type]?.name || 'Effect') : TITLES[sheet]} onclose={() => (sheet = null)}>
        {#if sheet === 'media'}
          <div class="binwrap"><MediaBin /></div>
        {:else if sheet === 'effects'}
          <EffectStack />
          {#if store.selected}<EffectEditor effect={store.selected} />{/if}
        {:else if sheet === 'fx' && fx}
          <EffectEditor effect={fx} />
        {:else if sheet === 'clip'}
          <div class="pad"><ClipEditor /></div>
        {:else if sheet === 'speed' && clip}
          <div class="pad">
            <div class="big mono">{clip.ramp ? 'ramp' : clip.speed + '×'}</div>
            <div class="chips">
              {#each SPEEDS as sp}<button class="chip" class:on={!clip.ramp && clip.speed === sp} onclick={() => setSpeed(sp)}>{sp}×</button>{/each}
            </div>
            <input type="range" min="-2" max="2" step="0.01" value={Math.log2(clip.speed)} aria-label="Speed" oninput={(e) => setSpeed(Math.round(2 ** +(e.target as HTMLInputElement).value * 100) / 100)} />
            <p class="small faint">{clip.speed === 1 ? 'Normal speed' : clip.speed < 1 ? 'Slower, so the clip gets longer' : 'Faster, so the clip gets shorter'}: {clipLen(clip).toFixed(1)} s. Speed ramps are in Adjust.</p>
          </div>
        {:else if sheet === 'volume' && clip}
          <div class="pad">
            <div class="big mono">{Math.round(clip.volume * 100)}%</div>
            <input type="range" min="0" max="2" step="0.01" value={clip.volume} aria-label="Volume" oninput={(e) => setVolume(+(e.target as HTMLInputElement).value)} />
            <div class="chips">
              <button class="chip" class:on={clip.volume === 0} onclick={() => setVolume(0)}>Mute</button>
              <button class="chip" class:on={clip.volume === 1} onclick={() => setVolume(1)}>100%</button>
              <button class="chip" class:on={clip.volume === 2} onclick={() => setVolume(2)}>200%</button>
            </div>
          </div>
        {:else if sheet === 'transition' && trClip}
          {@const cur = trClip.transition}
          <div class="pad">
            <div class="label">Mosh</div>
            <div class="tgrid">
              <button class="tcard" class:on={!cur} onclick={() => edit.setTransition(trClip.id, null)}><span class="tn">None</span><span class="td">A straight cut.</span></button>
              {#each Object.entries(MOSH_TRANSITIONS) as [id, t]}
                <button class="tcard" class:on={cur?.type === id} onclick={() => edit.setTransition(trClip.id, id as never)}><span class="tn">{t.name}</span><span class="td">{t.description}</span></button>
              {/each}
            </div>
            <div class="label sect">Classic</div>
            <div class="tgrid">
              {#each Object.entries(BLEND_TRANSITIONS) as [id, t]}
                <button class="tcard" class:on={cur?.type === id} onclick={() => edit.setTransition(trClip.id, id as never)}><span class="tn">{t.name}</span><span class="td">{t.description}</span></button>
              {/each}
            </div>
            {#if cur}
              <div class="label sect">Length · {cur.duration.toFixed(2)} s</div>
              <input type="range" min="0.1" max="4" step="0.05" value={cur.duration} aria-label="Length" oninput={(e) => edit.setTransition(trClip.id, cur.type, { duration: +(e.target as HTMLInputElement).value })} />
              {#if isMoshTransition(cur)}
                <div class="label sect">Strength · {Math.round(cur.intensity * 100)}%</div>
                <input type="range" min="0" max="1" step="0.01" value={cur.intensity} aria-label="Strength" oninput={(e) => edit.setTransition(trClip.id, cur.type, { intensity: +(e.target as HTMLInputElement).value })} />
              {/if}
            {/if}
          </div>
        {:else if sheet === 'look'}
          <div class="pad"><EncoderPanel /></div>
        {:else if sheet === 'audio'}
          <div class="pad"><AudioPanel /></div>
        {:else if sheet === 'chaos'}
          <div class="pad chaos">
            <ChaosDial />
            <p class="small muted">Turn every effect calmer or wilder at once, without changing their settings. Drag the dial up or down.</p>
            <div class="label sect">Randomize</div>
            <div class="row"><span class="small faint">Tame</span><input type="range" min="0" max="1" step="0.05" bind:value={store.ui.chaosIntensity} aria-label="How wild Randomize is" /><span class="small faint">Wild</span></div>
            <button class="primary wide" onclick={onchaos} disabled={!hasClips}><Icon name="dice" />Roll a new mosh</button>
            <div class="row two">
              <button onclick={() => (store.ui.dialog = 'variations')} disabled={!hasClips}><Icon name="grid" />Variations</button>
              <button onclick={() => (store.ui.dialog = 'snapshots')}><Icon name="history" />Snapshots</button>
            </div>
          </div>
        {:else if sheet === 'menu'}
          <div class="menu">
            <button onclick={() => ((sheet = null), goHome())}><Icon name="grid" />All projects</button>
            <hr />
            <button onclick={() => ((sheet = null), saveProjectFile())}><Icon name="save" />Save project</button>
            <button onclick={() => loadInput.click()}><Icon name="folder" />Open project…</button>
            <button onclick={() => ((sheet = null), (store.ui.dialog = 'share'))}><Icon name="link" />Share code…</button>
            <button disabled={!hasClips} onclick={() => ((sheet = null), (store.ui.dialog = 'bake'))}><Icon name="film" />Bake the mosh into a clip…</button>
            <button disabled={!hasClips} onclick={() => ((sheet = null), (store.ui.dialog = 'captions'))}><Icon name="cc" />Auto captions…</button>
            <button onclick={() => ((sheet = null), (store.ui.dialog = 'live'))}><Icon name="live" />Live mode…</button>
            <hr />
            <button onclick={() => ((sheet = null), loadExample())}><Icon name="gen" />Load example</button>
            <button onclick={() => ((sheet = null), startNewProject())}><Icon name="file" />New project</button>
            <hr />
            <button onclick={() => store.setPref('advanced', !store.ui.advanced)}><Icon name={store.ui.advanced ? 'check' : 'x'} />Advanced controls</button>
            {#if 'vibrate' in navigator}<button onclick={() => store.setPref('haptics', !store.ui.haptics)}><Icon name={store.ui.haptics ? 'check' : 'x'} />Vibration</button>{/if}
            <button onclick={() => store.setPref('theme', store.ui.theme === 'dark' ? 'light' : 'dark')}><Icon name="theme" />{store.ui.theme === 'dark' ? 'Light' : 'Dark'} theme</button>
            <button onclick={() => ((sheet = null), (store.ui.dialog = 'storage'))}><Icon name="storage" />Storage</button>
            <button onclick={() => ((sheet = null), (store.ui.dialog = 'help'))}><Icon name="help" />Help</button>
            <button onclick={() => ((sheet = null), (store.ui.dialog = 'whatsnew'))}><Icon name="sparkle" />What's new</button>
            <button onclick={() => ((sheet = null), reportProblem())}><Icon name="bug" />Report a problem</button>
          </div>
        {/if}
      </Sheet>
    {/if}
  </section>

  <nav class="tools" aria-label="Tools" data-tour="tools">
    {#if mode !== 'root'}
      <button class="back" aria-label="Back" onclick={deselect}><Icon name="back" size={20} /></button>
    {/if}
    <div class="scroll">
      {#if mode === 'root'}
        <button class="tool" onclick={() => (sheet = 'media')}><Icon name="add" size={22} /><span>Media</span></button>
        <button class="tool hot" disabled={!store.project.clips.length} onclick={() => (store.ui.dialog = 'addEffect')}><Icon name="melt" size={22} /><span>Mosh</span></button>
        <button class="tool" onclick={() => (store.ui.dialog = 'presets')}><Icon name="list" size={22} /><span>Presets</span></button>
        <button class="tool" disabled={!hasClips} onclick={onchaos}><Icon name="dice" size={22} /><span>Randomize</span></button>
        <button class="tool" onclick={() => (sheet = 'chaos')}><Icon name="speed" size={22} /><span>Chaos</span></button>
        <button class="tool" onclick={() => (sheet = 'effects')}><Icon name="fx" size={22} /><span>Effects{store.project.effects.length ? ` ${store.project.effects.length}` : ''}</span></button>
        <button class="tool" onclick={() => edit.addText()}><Icon name="text" size={22} /><span>Text</span></button>
        <button class="tool" onclick={() => audioInput.click()}><Icon name="music" size={22} /><span>Music</span></button>
        <button class="tool" disabled={layoutVideo(store.project).length < 2} onclick={() => edit.transitionAtPlayhead('melt')}><Icon name="transition" size={22} /><span>Melt cut</span></button>
        <button class="tool" onclick={() => (sheet = 'look')}><Icon name="sliders" size={22} /><span>Look</span></button>
        <button class="tool" onclick={() => (sheet = 'audio')}><Icon name="sound" size={22} /><span>Beats</span></button>
        <button class="tool" onclick={() => (store.ui.dialog = 'record')}><Icon name="camera" size={22} /><span>Record</span></button>
      {:else if mode === 'video' || mode === 'audio'}
        <button class="tool" onclick={() => (edit.splitAtPlayhead(), haptics.thud())}><Icon name="scissors" size={22} /><span>Split</span></button>
        <button class="tool" onclick={() => (sheet = 'speed')}><Icon name="speed" size={22} /><span>Speed</span></button>
        <button class="tool" onclick={() => (sheet = 'volume')}><Icon name="volume" size={22} /><span>Volume</span></button>
        {#if mode === 'video'}
          <button class="tool hot" onclick={moshThis}><Icon name="melt" size={22} /><span>Mosh it</span></button>
          <button class="tool" onclick={() => edit.freezeAtPlayhead()}><Icon name="freeze" size={22} /><span>Freeze</span></button>
        {/if}
        <button class="tool" onclick={toggleReverse}><Icon name="reverse" size={22} /><span>{clip?.reverse ? 'Forward' : 'Reverse'}</span></button>
        <button class="tool" onclick={() => (sheet = 'clip')}><Icon name="sliders" size={22} /><span>Adjust</span></button>
        <button class="tool" onclick={() => edit.duplicateSelected()}><Icon name="copy" size={22} /><span>Duplicate</span></button>
        <button class="tool" onclick={() => edit.toggleEnabled()}><Icon name={clip && clip.enabled === false ? 'eye' : 'eyeoff'} size={22} /><span>{clip && clip.enabled === false ? 'Show' : 'Hide'}</span></button>
        <button class="tool danger" onclick={() => edit.deleteSelected()}><Icon name="trash" size={22} /><span>Delete</span></button>
      {:else if mode === 'text'}
        <button class="tool" onclick={() => (sheet = 'clip')}><Icon name="pen" size={22} /><span>Edit</span></button>
        <button class="tool" onclick={() => (edit.splitAtPlayhead(), haptics.thud())}><Icon name="scissors" size={22} /><span>Split</span></button>
        <button class="tool" onclick={() => edit.duplicateSelected()}><Icon name="copy" size={22} /><span>Duplicate</span></button>
        <button class="tool danger" onclick={() => edit.deleteSelected()}><Icon name="trash" size={22} /><span>Delete</span></button>
      {:else if mode === 'fx' && fx}
        <button class="tool hot" onclick={() => (sheet = 'fx')}><Icon name="sliders" size={22} /><span>Settings</span></button>
        <button class="tool" onclick={() => store.edit(() => (fx.enabled = !fx.enabled))}><Icon name={fx.enabled ? 'eyeoff' : 'eye'} size={22} /><span>{fx.enabled ? 'Turn off' : 'Turn on'}</span></button>
        <button class="tool" onclick={() => store.duplicateEffect(fx.id)}><Icon name="copy" size={22} /><span>Duplicate</span></button>
        <button class="tool danger" onclick={() => store.removeEffect(fx.id)}><Icon name="trash" size={22} /><span>Delete</span></button>
      {/if}
    </div>
  </nav>

  <input bind:this={fileInput} type="file" multiple accept="video/*,image/*,audio/*,.mkv,.avi,.mov,.gif" hidden onchange={(e) => (pick((e.target as HTMLInputElement).files), ((e.target as HTMLInputElement).value = ''))} />
  <input bind:this={audioInput} type="file" multiple accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg" hidden onchange={(e) => (pick((e.target as HTMLInputElement).files), ((e.target as HTMLInputElement).value = ''))} />
  <input
    bind:this={loadInput}
    type="file"
    accept=".json,application/json"
    hidden
    onchange={(e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) loadProjectFile(f);
      (e.target as HTMLInputElement).value = '';
      sheet = null;
    }}
  />
</div>

<style>
  .m {
    height: 100%;
    display: grid;
    grid-template-rows: auto minmax(0, 40fr) minmax(0, 44fr) auto;
    grid-template-columns: minmax(0, 1fr);
    background: var(--bg);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 50px;
    padding: 0 10px 0 6px;
  }
  .hb {
    width: 40px;
    height: 40px;
  }
  .name {
    flex: 1;
    min-width: 0;
    background: transparent;
    border-color: transparent;
    font-weight: 600;
    font-size: 15px !important;
    text-align: center;
  }
  .crumb {
    flex: 1;
    justify-content: flex-start;
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--text);
  }
  .busy {
    font: 11px var(--mono);
    color: var(--text-3);
    min-width: 30px;
    text-align: right;
  }
  .busy.on {
    color: var(--accent);
  }
  .export {
    height: 34px;
    padding: 0 16px;
    border-radius: 17px;
  }
  .preview {
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .preview :global(.player) {
    flex: 1;
  }
  .preview :global(.stage) {
    background: #000;
  }
  .work {
    position: relative;
    min-height: 0;
    border-top: 1px solid var(--line);
  }
  .tools {
    display: flex;
    align-items: stretch;
    height: calc(68px + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--surface);
    border-top: 1px solid var(--line);
  }
  .back {
    flex: none;
    width: 48px;
    height: auto;
    border: none;
    border-radius: 0;
    background: var(--surface-2);
    border-right: 1px solid var(--line);
  }
  .scroll {
    flex: 1;
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 0 4px;
  }
  .scroll::-webkit-scrollbar {
    display: none;
  }
  .tool {
    flex: none;
    min-width: 64px;
    height: 100%;
    flex-direction: column;
    gap: 5px;
    padding: 0 6px;
    border: none;
    border-radius: 0;
    background: none;
    color: var(--text);
    font-size: 11px;
  }
  .tool:hover:not(:disabled),
  .tool:active:not(:disabled) {
    background: var(--surface-2);
  }
  .tool.hot {
    color: var(--accent);
  }
  .tool.danger {
    color: var(--danger);
  }
  .pad {
    padding: 4px 16px 24px;
  }
  .binwrap {
    height: 100%;
  }
  .big {
    font-size: 28px;
    text-align: center;
    margin: 4px 0 12px;
  }
  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
    margin: 12px 0;
  }
  .chip {
    height: 34px;
    min-width: 52px;
    border-radius: 17px;
  }
  .tgrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 6px;
    margin: 6px 0 4px;
  }
  .tcard {
    height: auto;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    padding: 10px;
    white-space: normal;
    text-align: left;
    border-radius: var(--r-lg);
  }
  .tcard.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .tn {
    font-weight: 600;
  }
  .td {
    font-size: 11px;
    color: var(--text-2);
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .sect {
    margin-top: 14px;
  }
  .chaos {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .chaos :global(.dial) {
    align-self: center;
  }
  .wide {
    height: 44px;
    border-radius: 22px;
    font-size: 15px;
  }
  .two > button {
    flex: 1;
    height: 40px;
  }
  .menu {
    display: flex;
    flex-direction: column;
    padding: 0 8px 16px;
  }
  .menu button {
    justify-content: flex-start;
    gap: 12px;
    height: 46px;
    border: none;
    background: none;
    font-size: 15px;
  }
  .menu hr {
    border: none;
    border-top: 1px solid var(--line);
    margin: 4px 8px;
  }
  /* sideways: preview on the left, timeline and tools on the right */
  @media (orientation: landscape) and (max-height: 500px) {
    .m {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr) auto;
    }
    header {
      grid-column: 1 / -1;
      height: 44px;
    }
    .preview {
      grid-row: 2 / 4;
    }
    .work {
      grid-column: 2;
      border-left: 1px solid var(--line);
    }
    .tools {
      grid-column: 2;
      height: 58px;
    }
  }
</style>
