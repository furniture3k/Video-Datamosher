<script lang="ts">
  import { t, i18n, LOCALES, setLocale, type Locale } from '../lib/i18n.svelte';
  // The home screen: start something new, pick up a project, or start from a template or an example.
  import { onMount } from 'svelte';
  import { store } from '../lib/store.svelte';
  import { projects, refreshProjects, openSavedProject, startProject, duplicateProject, renameProject, deleteProject } from '../lib/projects.svelte';
  import { TEMPLATES, EXAMPLES, openExample, type Template, type Starter } from '../lib/starters.svelte';
  import { loadProjectFile } from '../lib/projectio.svelte';
  import { addFiles } from '../lib/media';
  import { ask, askText } from '../lib/ask';
  import { VERSION, REPO } from '../lib/about';
  import Logo from '../components/Logo.svelte';
  import Icon from '../components/Icon.svelte';
  import StarterCard from './StarterCard.svelte';
  import TemplateDialog from './TemplateDialog.svelte';

  let importInput: HTMLInputElement;
  let projectInput: HTMLInputElement;
  let menuFor = $state<string | null>(null);
  let template = $state<Template | null>(null);
  let working = $state<string | null>(null);

  onMount(() => {
    refreshProjects();
  });

  // in the app's language (the browser has the words for it)
  const rel = $derived(new Intl.RelativeTimeFormat(i18n.locale, { numeric: 'auto', style: 'short' }));
  const ago = (t: number) => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return rel.format(0, 'second');
    if (s < 3600) return rel.format(-Math.floor(s / 60), 'minute');
    if (s < 86400) return rel.format(-Math.floor(s / 3600), 'hour');
    if (s < 86400 * 7) return rel.format(-Math.floor(s / 86400), 'day');
    return new Date(t).toLocaleDateString(i18n.locale, { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  };
  const len = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s.toFixed(s < 10 ? 1 : 0)} s`);

  function importMedia(files: FileList | null) {
    if (!files?.length) return;
    // a copy: the input is cleared right after this
    const list = [...files];
    run('import', async () => {
      await startProject();
      await addFiles(list);
    });
  }

  async function run(id: string, fn: () => Promise<unknown>) {
    if (working) return;
    working = id;
    try {
      await fn();
    } catch (e) {
      store.toast('Something went wrong: ' + ((e as Error)?.message ?? e), 'error', 6000);
    } finally {
      working = null;
    }
  }

  async function rename(id: string, name: string) {
    menuFor = null;
    const n = await askText('Rename project', name);
    if (n !== null) renameProject(id, n).catch((e) => store.toast('Could not rename: ' + ((e as Error)?.message ?? e), 'error'));
  }
  async function remove(id: string, name: string) {
    menuFor = null;
    if (await ask(`Delete "${name}" and its snapshots? This can't be undone.`, 'Delete')) run('delete', () => deleteProject(id));
  }
</script>

<svelte:window onclick={() => (menuFor = null)} />

<div class="home" data-testid="home">
  <header>
    <div class="brand"><Logo size={22} /><span>moshpit</span></div>
    <span class="grow"></span>
    <button class="ghost small" onclick={() => (store.ui.dialog = 'whatsnew')}><Icon name="sparkle" /><span class="lbl">{t("What's new")}</span></button>
    <button class="ghost small" onclick={() => (store.ui.dialog = 'help')}><Icon name="help" /><span class="lbl">{t('Help')}</span></button>
    <button class="ghost small icon" title={t('Storage')} aria-label={t('Storage')} onclick={() => (store.ui.dialog = 'storage')}><Icon name="storage" /></button>
    <button class="ghost small icon" title={t(store.ui.theme === 'dark' ? 'Light theme' : 'Dark theme')} aria-label={t('Switch theme')} onclick={() => store.setPref('theme', store.ui.theme === 'dark' ? 'light' : 'dark')}><Icon name="theme" /></button>
  </header>

  <main>
    <section class="hero">
      <h1>{t('Make something melt')}</h1>
      <p class="muted">{t('Cut your clips together, then break the video itself: melts, blooms, glitches. Everything stays on this device.')}</p>
      <div class="actions">
        <button class="primary big" onclick={() => run('new', () => startProject())} data-tour="new"><Icon name="plus" />{t('New project')}</button>
        <button class="big" onclick={() => importInput.click()}><Icon name="import" />{t('Import media')}</button>
        <button class="big ghost" onclick={() => projectInput.click()}><Icon name="folder" />{t('Open project file')}</button>
      </div>
      <p class="faint small drop">{t('or drop videos, photos or music anywhere')}</p>
      <input bind:this={importInput} type="file" multiple hidden accept="video/*,image/*,audio/*,.mkv,.avi,.mov,.gif,.mp3,.wav,.m4a,.flac,.ogg" onchange={(e) => (importMedia((e.target as HTMLInputElement).files), ((e.target as HTMLInputElement).value = ''))} />
      <input bind:this={projectInput} type="file" hidden accept=".json,application/json" onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) loadProjectFile(f); (e.target as HTMLInputElement).value = ''; }} />
    </section>

    {#if projects.list.length}
      <section>
        <h2>{t('Your projects')} <span class="faint">{projects.list.length}</span></h2>
        <div class="grid projects">
          {#each projects.list as p (p.id)}
            <div class="card project" class:current={p.id === store.projectId}>
              <button class="open" onclick={() => run(p.id, () => openSavedProject(p.id))} aria-label={t('Open {name}', { name: p.name })}>
                <div class="thumb">
                  {#if p.thumb}<img src={p.thumb} alt="" />{:else}<Logo size={28} color="var(--line-2)" />{/if}
                  {#if p.seconds}<span class="dur mono">{len(p.seconds)}</span>{/if}
                  {#if working === p.id}<span class="spin">{t('Opening…')}</span>{/if}
                </div>
                <div class="meta">
                  <div class="name">{p.name}</div>
                  <div class="faint small">{ago(p.updated)} · {p.clips === 1 ? t('1 clip') : t('{n} clips', { n: p.clips })}</div>
                </div>
              </button>
              <button class="icon ghost more" aria-label={t('More for {name}', { name: p.name })} onclick={(e) => (e.stopPropagation(), (menuFor = menuFor === p.id ? null : p.id))}><Icon name="more" /></button>
              {#if menuFor === p.id}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="menu" role="menu" tabindex="-1" onclick={(e) => e.stopPropagation()}>
                  <button class="ghost" onclick={() => rename(p.id, p.name)}><Icon name="pen" />{t('Rename')}</button>
                  <button class="ghost" onclick={() => ((menuFor = null), run('duplicate', () => duplicateProject(p.id)))}><Icon name="copy" />{t('Duplicate')}</button>
                  <button class="ghost danger" onclick={() => remove(p.id, p.name)}><Icon name="trash" />{t('Delete')}</button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <section>
      <h2>{t('Start from a template')}</h2>
      <p class="faint small sub">{t('Pick your clips and the mosh is set up for you. Or try one with sample footage first.')}</p>
      <div class="grid starters">
        {#each TEMPLATES as tp (tp.id)}
          <StarterCard s={tp} badge={tp.aspect === '9:16' ? '9:16' : tp.music ? '♪ beat' : ''} onclick={() => (template = tp)} />
        {/each}
      </div>
    </section>

    <section>
      <h2>{t('Examples')}</h2>
      <p class="faint small sub">{t("Made from generated footage, so there's nothing to import. Open one and take it apart.")}</p>
      <div class="grid starters">
        {#each EXAMPLES as e (e.id)}
          <StarterCard s={e} busy={working === e.id} onclick={() => run(e.id, () => openExample(e as Starter))} />
        {/each}
      </div>
    </section>
  </main>

  <footer class="small faint">
    <span>moshpit {VERSION}</span>
    <label class="opt"><input type="checkbox" checked={!store.ui.startHome} onchange={(e) => store.setPref('startHome', !(e.target as HTMLInputElement).checked)} />{t('Open my last project on start')}</label>
    <label class="opt"><input type="checkbox" checked={store.ui.autoMosh} onchange={(e) => store.setPref('autoMosh', (e.target as HTMLInputElement).checked)} />{t('Mosh new clips straight away')}</label>
    <span class="grow"></span>
    <label class="opt"
      >{t('Language')}
      <select value={i18n.locale} aria-label={t('Language')} onchange={(e) => setLocale((e.target as HTMLSelectElement).value as Locale)}>
        {#each LOCALES as l}<option value={l.id}>{l.name}</option>{/each}
      </select></label
    >
    {#if i18n.locale !== 'en'}<a href="{REPO}/blob/main/CONTRIBUTING.md#translations" target="_blank" rel="noopener" title={t('Translations are drafts: help improve them on GitHub.')}>✎</a>{/if}
    <a href={REPO} target="_blank" rel="noopener">{t('Source code')}</a>
  </footer>
</div>

{#if template}<TemplateDialog t={template} onclose={() => (template = null)} />{/if}

<style>
  .home {
    height: 100%;
    overflow: auto;
    background: var(--bg);
    display: flex;
    flex-direction: column;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px max(16px, env(safe-area-inset-left));
    padding-top: max(10px, env(safe-area-inset-top));
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--line);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 750;
    font-size: 16px;
    letter-spacing: -0.02em;
  }
  .grow {
    flex: 1;
  }
  main {
    width: min(1180px, 100%);
    margin: 0 auto;
    padding: 0 16px 32px;
    display: flex;
    flex-direction: column;
    gap: 36px;
  }
  .hero {
    padding: 56px 0 8px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  h1 {
    font-size: clamp(30px, 5vw, 48px);
    line-height: 1.05;
    font-weight: 800;
    letter-spacing: -0.035em;
  }
  .hero p {
    max-width: 560px;
    font-size: 15px;
    line-height: 1.5;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  button.big {
    height: 40px;
    padding: 0 16px;
    font-size: 14px;
  }
  .drop {
    margin-top: 2px;
  }
  h2 {
    font-size: 15px;
    font-weight: 650;
    margin-bottom: 4px;
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .sub {
    margin-bottom: 12px;
  }
  .grid {
    display: grid;
    gap: 14px;
  }
  .grid.projects {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    margin-top: 10px;
  }
  .grid.starters {
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  }
  .card {
    position: relative;
  }
  .project .open {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    width: 100%;
    height: auto;
    padding: 0;
    background: none;
    border: none;
    text-align: left;
  }
  .thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: var(--r-lg);
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--line);
    display: grid;
    place-items: center;
    transition: border-color 0.12s;
  }
  .project .open:hover .thumb,
  .project .open:focus-visible .thumb {
    border-color: var(--accent);
  }
  .current .thumb {
    border-color: var(--line-2);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .dur {
    position: absolute;
    right: 6px;
    bottom: 6px;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
  }
  .spin {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 12px;
  }
  .meta .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 28px;
  }
  .more {
    position: absolute;
    right: 0;
    bottom: 14px;
  }
  .menu {
    position: absolute;
    right: 0;
    bottom: -4px;
    transform: translateY(100%);
    z-index: 10;
    min-width: 160px;
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    border-radius: var(--r);
    box-shadow: var(--shadow);
    padding: 4px;
    display: flex;
    flex-direction: column;
  }
  .menu button {
    justify-content: flex-start;
  }
  .menu .danger {
    color: var(--danger);
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 18px;
    padding: 16px;
    padding-bottom: max(16px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--line);
    margin-top: auto;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  @media (max-width: 640px) {
    .hero {
      padding-top: 28px;
    }
    .actions {
      width: 100%;
    }
    .actions button {
      flex: 1 1 auto;
    }
    .grid.projects,
    .grid.starters {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .lbl,
    .drop {
      display: none;
    }
  }
</style>
