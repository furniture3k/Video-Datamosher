<script lang="ts">
  // Exports running in the background (Export → Add to queue), in the bottom right corner.
  import Icon from './Icon.svelte';
  import { exportQueue, cancelJob, removeJob, saveJob } from '../lib/exportqueue.svelte';
  import { isDesktop } from '../lib/platform';
  import { hasSavePicker } from '../lib/storage';

  const active = $derived(exportQueue.jobs.filter((j) => j.status === 'running' || j.status === 'waiting').length);
  const mb = (n: number) => (n / 1048576).toFixed(n > 1e7 ? 0 : 1) + ' MB';
</script>

{#if exportQueue.jobs.length}
  <section class="queue" aria-label="Export queue">
    <button class="head small" aria-expanded={exportQueue.open} onclick={() => (exportQueue.open = !exportQueue.open)}>
      <Icon name="export" size={13} />
      <span class="grow">Exports{active ? ` · ${active} to go` : ''}</span>
      <Icon name={exportQueue.open ? 'down' : 'up'} size={12} />
    </button>
    {#if exportQueue.open}
      <ul>
        {#each exportQueue.jobs as j (j.id)}
          <li class="job {j.status}">
            <div class="row">
              <span class="nm small grow" title={j.name}>{j.name}</span>
              {#if j.status === 'running' || j.status === 'waiting'}
                <button class="icon ghost" title="Cancel this export" aria-label="Cancel export" onclick={() => cancelJob(j.id)}><Icon name="x" size={12} /></button>
              {:else}
                {#if j.status === 'done'}
                  {#if j.url}<a class="small" href={j.url} download={j.result?.name}>Download</a>{/if}
                  {#if isDesktop || hasSavePicker()}<button class="ghost small" onclick={() => saveJob(j.id)}>{isDesktop ? (j.savedTo ? 'Show' : 'Save…') : 'Save as…'}</button>{/if}
                {/if}
                <button class="icon ghost" title="Remove from the list" aria-label="Remove from the list" onclick={() => removeJob(j.id)}><Icon name="x" size={12} /></button>
              {/if}
            </div>
            {#if j.status === 'running'}
              <div class="bar"><div style="width:{Math.round(j.progress * 100)}%"></div></div>
              <span class="small faint mono">{j.stage} {Math.round(j.progress * 100)}%{j.eta ? ` · ${j.eta} left` : ''}</span>
            {:else if j.status === 'waiting'}
              <span class="small faint">Waiting</span>
            {:else if j.status === 'done'}
              <span class="small faint mono">{j.result?.name}{j.result ? ` · ${mb(j.result.size)}` : ''}{j.result?.hardware ? ' · hardware' : ''}</span>
            {:else if j.status === 'failed'}
              <span class="small err" title={j.error}>Failed: {j.error?.split('\n')[0]}</span>
            {:else}
              <span class="small faint">Cancelled</span>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="small faint note">Exports run here while you keep editing. Each uses the project as it was when you added it.</p>
    {/if}
  </section>
{/if}

<style>
  .queue {
    position: fixed;
    right: 12px;
    bottom: 12px;
    width: min(320px, calc(100vw - 24px));
    z-index: 150;
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    border-radius: var(--r);
    box-shadow: var(--shadow);
  }
  .head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    border: none;
    background: none;
    padding: 7px 10px;
    height: auto;
  }
  .grow {
    flex: 1;
    min-width: 0;
    text-align: left;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0 10px;
    max-height: 40vh;
    overflow: auto;
  }
  .job {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px 0;
    border-top: 1px solid var(--line);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar {
    height: 2px;
    background: var(--line-2);
  }
  .bar div {
    height: 100%;
    background: var(--accent);
  }
  .err {
    color: var(--danger);
  }
  a {
    color: var(--text);
  }
  @media (max-width: 700px) {
    /* phones: out of the way of the tools along the bottom */
    .queue {
      top: 52px;
      bottom: auto;
    }
  }
  .note {
    margin: 0;
    padding: 6px 10px 8px;
    border-top: 1px solid var(--line);
  }
</style>
