<script lang="ts">
  // The Chaos dial: drag up/down (or scroll, or arrow keys) to push every effect calmer or wilder.
  import { store } from '../lib/store.svelte';
  import { CHAOS_MAX, CHAOS_MIN } from '../engine/chaos';

  const value = $derived(store.project.chaos ?? 1);
  const label = $derived(value < 0.35 ? 'Calm' : value < 0.85 ? 'Tame' : value <= 1.15 ? 'As made' : value < 1.6 ? 'Wild' : 'Destroyed');
  // -135° (calm) .. 135° (destroyed)
  const angle = $derived(((value - CHAOS_MIN) / (CHAOS_MAX - CHAOS_MIN)) * 270 - 135);

  function set(v: number) {
    v = Math.round(Math.min(CHAOS_MAX, Math.max(CHAOS_MIN, v)) * 20) / 20;
    // snap to "as made" near the middle
    if (Math.abs(v - 1) < 0.04) v = 1;
    if (v === value) return;
    store.edit((p) => (v === 1 ? delete p.chaos : (p.chaos = v)), 'chaos');
  }
  function down(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const v0 = value;
    const move = (ev: PointerEvent) => set(v0 + (y0 - ev.clientY) / 120);
    // fires after pointerup and after a cancelled touch alike
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('lostpointercapture', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('lostpointercapture', up);
  }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.25 : 0.05;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(value + step);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(value - step);
    else if (e.key === 'Home') set(CHAOS_MIN);
    else if (e.key === 'End') set(CHAOS_MAX);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<div
  class="dial"
  class:hot={value > 1.15}
  class:cool={value < 0.85}
  role="slider"
  tabindex="0"
  aria-label="Chaos"
  aria-valuemin={CHAOS_MIN}
  aria-valuemax={CHAOS_MAX}
  aria-valuenow={value}
  aria-valuetext={label}
  title="Chaos: {label} ({Math.round(value * 100)}%). Drag up or down, scroll, or use the arrow keys. Pushes every effect calmer or wilder without changing your settings. Double-click: back to as made."
  onpointerdown={down}
  ondblclick={() => set(1)}
  onwheel={(e) => (e.preventDefault(), set(value - Math.sign(e.deltaY) * 0.05))}
  onkeydown={key}
>
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <circle cx="12" cy="12" r="9.5" class="ring" />
    <path d="M 12 12 m -6.7 6.7 A 9.5 9.5 0 1 1 18.7 18.7" class="track" />
    <g transform="rotate({angle} 12 12)"><line x1="12" y1="12" x2="12" y2="4.5" class="needle" /></g>
  </svg>
  <span class="lbl">{label}</span>
</div>

<style>
  .dial {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px 0 4px;
    border-radius: var(--r);
    cursor: ns-resize;
    user-select: none;
    touch-action: none;
    color: var(--text-2);
    font-size: 12px;
  }
  .dial:hover,
  .dial:focus-visible {
    background: var(--surface-2);
    color: var(--text);
  }
  .ring {
    fill: var(--surface-2);
    stroke: var(--line-2);
  }
  .track {
    fill: none;
    stroke: transparent;
  }
  .needle {
    stroke: var(--text);
    stroke-width: 2.2;
    stroke-linecap: round;
  }
  .hot .needle {
    stroke: var(--accent);
  }
  .hot .lbl {
    color: var(--accent);
  }
  .cool .needle {
    stroke: var(--text-3, var(--text-2));
  }
  .lbl {
    min-width: 58px;
  }
  @media (max-width: 1280px) and (min-width: 861px) {
    .lbl {
      display: none;
    }
  }
</style>
