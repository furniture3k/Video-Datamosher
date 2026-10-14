// One shared AudioContext. iOS Safari only lets audio start from a user gesture, so the context
// is created / resumed on the first tap or key press and reused for every preview sound.
let ctx: AudioContext | null = null;

export function audioCtx(): AudioContext {
  if (!ctx || ctx.state === 'closed') {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

function unlock() {
  const c = audioCtx();
  if (c.state !== 'running') {
    c.resume().catch(() => {});
    // a silent one-sample buffer fully unlocks iOS
    try {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    } catch {
      /* ignore */
    }
  }
}

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(ev, unlock, { capture: true, passive: true });
}
