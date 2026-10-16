// Crash recovery: while a render or export runs, a small flag with a heartbeat sits in
// localStorage (synchronous, so it's written even if the tab is about to die). If the app starts
// and finds a stale flag, the last session ended in the middle of heavy work: usually the tab ran
// out of memory. The app then starts with auto-render paused so it doesn't crash straight away again.

const KEY = 'moshpit:busy';
/** a flag this old without a heartbeat means its tab is gone */
const STALE_MS = 15000;
const BEAT_MS = 5000;

export interface BusyFlag {
  kind: 'render' | 'export';
  at: number;
  tab: string;
}

const tab = Math.random().toString(36).slice(2, 10);
const jobs = new Map<number, BusyFlag['kind']>();
let next = 0;
let beat = 0;

function write() {
  try {
    if (!jobs.size) {
      // only ever clear our own flag: another tab may be rendering, or may have crashed
      const raw = localStorage.getItem(KEY);
      if (raw && (JSON.parse(raw) as BusyFlag).tab === tab) localStorage.removeItem(KEY);
    } else localStorage.setItem(KEY, JSON.stringify({ kind: [...jobs.values()].includes('export') ? 'export' : 'render', at: Date.now(), tab } satisfies BusyFlag));
  } catch {
    /* storage unavailable: no recovery, nothing else breaks */
  }
}

/** Mark heavy work as running; call the returned function when it ends (in a finally). */
export function busy(kind: BusyFlag['kind']): () => void {
  const id = next++;
  jobs.set(id, kind);
  write();
  if (!beat) beat = window.setInterval(write, BEAT_MS);
  return () => {
    jobs.delete(id);
    write();
    if (!jobs.size) {
      clearInterval(beat);
      beat = 0;
    }
  };
}

/**
 * Called once at start-up, before anything renders. Returns what was running when the last
 * session died, or null. A flag from another open tab that is still alive is left alone.
 */
export function crashedSession(now = Date.now()): BusyFlag | null {
  let f: BusyFlag | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    f = raw ? (JSON.parse(raw) as BusyFlag) : null;
  } catch {
    return null;
  }
  if (!f || f.tab === tab || now - f.at < STALE_MS) return null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return f;
}

// closing the tab (or reloading) in the middle of a render is not a crash
if (typeof window !== 'undefined')
  window.addEventListener('pagehide', () => {
    if (!jobs.size) return;
    jobs.clear();
    write();
  });
