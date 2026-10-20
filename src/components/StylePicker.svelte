<script lang="ts">
  // Title styles: one click puts a look on the selected titles; save your own, or put this
  // title's look on every title. New titles get the style used last.
  import { store } from '../lib/store.svelte';
  import { allStyles, deleteStyle, saveStyle, styleTitles, titleStyles } from '../lib/styles.svelte';
  import { FONTS } from '../lib/text';
  import { fontCss } from '../lib/fonts.svelte';
  import { BUILTIN_STYLES, hasStyle, styleOf, type TitleStyle } from '../engine/styles';
  import type { TextLayer } from '../engine/layers';

  let { title }: { title: TextLayer } = $props();

  /** the selected titles (this one at least) */
  const ids = $derived([...new Set([title.id, ...store.ui.selectedClips.filter((id) => store.project.layers.some((l) => l.id === id))])]);
  const builtin = new Set(BUILTIN_STYLES.map((s) => s.id));
  /** a light swatch behind dark styles, a dark one behind light ones */
  function swatch(color: string) {
    const h = color.replace('#', '').padEnd(6, '0');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.35 ? '#e8e8ea' : '#1c1c20';
  }
  function everyTitle() {
    const s = allStyles().find((x) => hasStyle(title, x)) ?? styleOf(title, 'look', 'This look');
    styleTitles(
      store.project.layers.map((l) => l.id),
      s,
    );
    store.toast(`Every title has this look now.`, 'ok');
  }
</script>

<div class="styles">
  <div class="row"><span class="label grow">Style</span><button class="ghost small" onclick={() => saveStyle(title)} title="Keep this title's look as a style of your own, for every project">Save style</button></div>
  <div class="chips" role="group" aria-label="Title styles">
    {#each allStyles() as s (s.id)}
      <div class="chipwrap">
        <button class="chip" class:on={hasStyle(title, s)} onclick={() => styleTitles(ids, s)} title={`${s.name}: put this look on ${ids.length > 1 ? 'the selected titles' : 'the title'}`} aria-pressed={hasStyle(title, s)}>
          <span class="aa" style="font-family:{fontCss(s.font, FONTS)};font-weight:{s.bold ? 700 : 400};color:{s.color};background:{swatch(s.color)}">Aa</span>
          <span class="nm">{s.name}</span>
        </button>
        {#if !builtin.has(s.id)}
          <button class="del ghost" onclick={() => deleteStyle(s.id)} title={`Delete the style “${s.name}”`} aria-label={`Delete the style ${s.name}`}>×</button>
        {/if}
      </div>
    {/each}
  </div>
  {#if store.project.layers.length > 1}
    <button class="ghost small every" onclick={everyTitle}>Use this look on every title</button>
  {/if}
  {#if titleStyles.saved.length === 0}<span class="small faint">Pick one to restyle the title; new titles get the style you used last.</span>{/if}
</div>

<style>
  .styles {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .label {
    font-size: 12px;
    color: var(--text-2);
  }
  .chips {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    gap: 6px;
  }
  .chipwrap {
    position: relative;
  }
  .chip {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    text-align: left;
  }
  .chip.on {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .aa {
    flex: none;
    width: 30px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 4px;
    font-size: 14px;
    line-height: 1;
  }
  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .del {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    font-size: 12px;
    line-height: 1;
    background: var(--surface-3);
  }
  .every {
    align-self: flex-start;
  }
</style>
