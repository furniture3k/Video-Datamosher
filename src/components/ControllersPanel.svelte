<script lang="ts">
  // MIDI and OSC: what's connected, and which controls move which settings (in Help).
  import { store } from '../lib/store.svelte';
  import { controls, enableMidi, setOscPort, forget } from '../lib/controls.svelte';
  import { controlLabel } from '../engine/controls';
  import { EFFECTS } from '../engine/effects';
  import { isDesktop } from '../lib/platform';
  import { localGet } from '../lib/storage';

  let port = $state(controls.osc || localGet('oscPort', 0) || 9000);
  const maps = $derived(
    (store.project.controls ?? []).map((c) => {
      const e = store.project.effects.find((x) => x.id === c.effectId);
      const def = e && EFFECTS[e.type]?.params.find((d) => d.key === c.param);
      return { ...c, what: e && def ? `${EFFECTS[e.type].name} · ${def.label}` : 'a removed effect' };
    }),
  );
</script>

<div class="ctrls">
  <p class="small muted">Right-click any effect setting, then move a knob, fader or pad: it moves that setting from then on, in the editor and in Live mode. Right-click again to let go.</p>
  <div class="row small">
    <span class="grow">
      MIDI:
      {#if controls.midi === 'on'}{controls.inputs.length ? controls.inputs.join(', ') : 'on, no device plugged in'}
      {:else if controls.midi === 'denied'}not allowed
      {:else if controls.midi === 'unsupported'}not in this browser (Chrome and Edge have it)
      {:else}off{/if}
    </span>
    {#if controls.midi !== 'on' && controls.midi !== 'unsupported'}<button class="small" onclick={() => enableMidi()}>Use MIDI</button>{/if}
  </div>
  {#if isDesktop}
    <div class="row small">
      <span class="grow">OSC: {controls.osc ? `listening on UDP port ${controls.osc}` : 'off'}</span>
      <input type="number" min="1024" max="65535" bind:value={port} aria-label="OSC port" />
      {#if controls.osc}<button class="small" onclick={() => setOscPort(0).then(() => (controls.osc = 0))}>Stop</button>
      {:else}<button class="small" onclick={() => setOscPort(port)}>Listen</button>{/if}
    </div>
    <p class="small faint">Send numbers from 0 to 1 (or 0–127) to any address, from this computer or a phone on the same network.</p>
  {/if}
  {#if maps.length}
    <ul class="small">
      {#each maps as m (m.key)}
        <li><span class="mono">{controlLabel(m.key)}</span> → {m.what} <button class="link" onclick={() => forget(m.effectId, m.param)}>forget</button></li>
      {/each}
    </ul>
  {/if}
  {#if controls.last}<p class="small faint mono">Last moved: {controls.last}</p>{/if}
</div>

<style>
  .ctrls {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .grow {
    flex: 1;
  }
  input[type='number'] {
    width: 80px;
  }
  ul {
    margin: 0;
    padding-left: 16px;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    height: auto;
    text-decoration: underline;
    color: var(--text-2);
  }
</style>
