<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import { ask } from '../lib/ask';
  import { store } from '../lib/store.svelte';
  import { fileSizes, storageInfo, askPersist, pruneFiles } from '../lib/storage';
  import { snapshots, loadSnapshots, snapshotFileIds, deleteAutoSnapshots } from '../lib/snapshots.svelte';
  import { proxyKey } from '../lib/renderer';
  import { isDesktop } from '../lib/platform';

  interface Row {
    label: string;
    hint: string;
    bytes: number;
    count: number;
  }
  let rows = $state<Row[]>([]);
  let info = $state<{ usage: number; quota: number; persisted: boolean } | null>(null);
  let unusedBytes = $state(0);
  let busy = $state(false);

  const fmt = (b: number) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(b >= 1e8 ? 0 : 1) + ' MB' : Math.max(0, Math.round(b / 1e3)) + ' KB');

  async function refresh() {
    await loadSnapshots();
    const [sizes, snapFiles, keep] = await Promise.all([fileSizes().catch(() => new Map<string, number>()), snapshotFileIds(), store.keepFiles()]);
    info = await storageInfo();
    const media = new Set(store.project.media.flatMap((m) => (m.source.kind === 'file' ? [m.source.fileId] : [])));
    const proxies = new Set(store.project.media.map((m) => proxyKey(m.id)));
    const luts = new Set((store.project.luts ?? []).map((l) => 'lut:' + l.id));
    const snaps = new Set(snapFiles);
    const keepSet = new Set(keep);
    const sum = (pred: (k: string) => boolean) => {
      let bytes = 0;
      let count = 0;
      for (const [k, n] of sizes) if (pred(k)) (bytes += n), count++;
      return { bytes, count };
    };
    const used = sum((k) => media.has(k) || luts.has(k));
    const px = sum((k) => proxies.has(k));
    const snapOnly = sum((k) => snaps.has(k) && !media.has(k));
    const unused = sum((k) => !keepSet.has(k));
    unusedBytes = unused.bytes;
    const autos = snapshots.list.filter((s) => s.auto).length;
    rows = [
      { label: 'Media in this project', hint: 'Your imported videos, photos, sound and LUTs.', ...used },
      { label: 'Preview copies', hint: 'Smaller copies for smooth playback. Made again when needed.', ...px },
      { label: 'Kept for snapshots', hint: `Media only your snapshots still use (${snapshots.list.length} snapshots, ${autos} automatic).`, ...snapOnly },
      { label: 'Not used any more', hint: 'Media you removed. Kept until the next start so Undo can bring it back.', ...unused },
    ];
    // the rest of what the browser counts: the app itself and its video engine, kept for offline use
    let files = 0;
    for (const n of sizes.values()) files += n;
    const app = (info?.usage ?? 0) - files;
    if (!isDesktop && app > 1e6) rows.push({ label: 'The app and its video engine', hint: 'Kept so moshpit opens and works offline.', bytes: app, count: 0 });
  }
  const failed = (e: unknown) => store.toast('Storage: ' + ((e as Error)?.message ?? e), 'error', 6000);
  refresh().catch(failed);

  async function keep() {
    const ok = await askPersist();
    store.toast(ok ? 'Your files are protected from automatic clean-up.' : 'The browser said no. It usually allows this for installed apps or sites you use often.', ok ? 'ok' : 'info', 6000);
    refresh().catch(failed);
  }

  async function dropAutos() {
    if (!(await ask('Delete every automatic snapshot? Snapshots you named are kept.', 'Delete'))) return;
    busy = true;
    try {
      const n = await deleteAutoSnapshots();
      store.toast(`Deleted ${n} automatic snapshot${n === 1 ? '' : 's'}.`, 'ok');
      await refresh();
    } catch (e) {
      failed(e);
    } finally {
      busy = false;
    }
  }

  async function cleanUp() {
    if (!(await ask(`Delete ${fmt(unusedBytes)} of media nothing uses? Undo won't be able to bring back clips that used it.`, 'Delete'))) return;
    busy = true;
    try {
      const since = Date.now();
      await pruneFiles(await store.keepFiles(), since);
      store.toast('Cleaned up.', 'ok');
      await refresh();
    } catch (e) {
      failed(e);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Storage">
  <p class="small muted">
    {isDesktop ? 'moshpit keeps your media and projects in its own folder on this computer.' : 'moshpit keeps your media and projects in this browser, on this device. Nothing is uploaded.'}
  </p>
  {#if info && info.quota}
    <div class="meter" role="meter" aria-valuemin="0" aria-valuemax={info.quota} aria-valuenow={info.usage} aria-label="Storage used">
      <i style="width:{Math.min(100, (info.usage / info.quota) * 100).toFixed(1)}%"></i>
    </div>
    <div class="row small">
      <span class="grow">{fmt(info.usage)} used of {fmt(info.quota)} available</span>
      {#if !isDesktop}
        {#if info.persisted}<span class="ok">Protected</span>{:else}<button class="link" onclick={keep} title="Ask the browser not to clear these files when the disk gets full">Protect my files</button>{/if}
      {/if}
    </div>
  {/if}
  <div class="rows">
    {#each rows as r (r.label)}
      <div class="r">
        <div class="grow">
          <div>{r.label}</div>
          <div class="small faint">{r.hint}</div>
        </div>
        <div class="mono small">{fmt(r.bytes)}</div>
      </div>
    {:else}
      <p class="small faint">Measuring…</p>
    {/each}
  </div>
  {#snippet footer()}
    <button onclick={dropAutos} disabled={busy || !snapshots.list.some((s) => s.auto)}>Delete automatic snapshots</button>
    <button onclick={cleanUp} disabled={busy || unusedBytes === 0}>Clean up unused media</button>
    <button class="primary" onclick={() => (store.ui.dialog = null)}>Done</button>
  {/snippet}
</Modal>

<style>
  .meter {
    height: 6px;
    border-radius: 3px;
    background: var(--surface-3);
    overflow: hidden;
    margin: 12px 0 6px;
  }
  .meter i {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .grow {
    flex: 1;
  }
  .ok {
    color: var(--ok);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 14px;
  }
  .r {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    border-top: 1px solid var(--line);
  }
</style>
