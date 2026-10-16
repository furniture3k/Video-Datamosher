// "Report a problem": opens a GitHub bug report with the details filled in. Nothing is sent
// anywhere until the person submits the issue themselves, and no media is included.
import { store } from './store.svelte';
import { ffmpeg } from './ffmpeg';
import { isDesktop } from './platform';
import { VERSION, REPO } from './about';

const LOG_LINES = 30;
const log: string[] = [];
let listening = false;

/** Start keeping the last few lines the video engine printed (called once at start-up). */
export function collectEngineLog() {
  if (listening) return;
  listening = true;
  ffmpeg.onLog((l) => {
    log.push(l);
    if (log.length > LOG_LINES * 4) log.splice(0, log.length - LOG_LINES);
  });
}

function where(): string {
  if (isDesktop) {
    const p = navigator.platform.toLowerCase();
    return p.startsWith('win') ? 'Desktop app – Windows' : p.startsWith('mac') ? 'Desktop app – macOS' : 'Desktop app – Linux';
  }
  const installed = typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches;
  return installed ? 'Installed web app (phone / tablet / desktop browser)' : 'Website (browser)';
}

// metadata ffmpeg prints from the files (titles, GPS, device names…) stays private
const META = /^\s*(title|comment|artist|album|album_artist|location|com\.apple\.[\w.]+|creation_time|encoder|handler_name|vendor_id|description|copyright|date|make|model|software)\s*:/i;

/** Remove the person's own file names and the metadata of their files. */
function scrub(text: string): string {
  let t = text;
  for (const m of store.project.media) {
    const name = m.source.kind === 'file' ? m.source.name : '';
    if (name.length > 2) t = t.split(name).join('[file]');
  }
  return t;
}

/** The diagnostics block pasted into the report. */
export function diagnostics(): string {
  const p = store.project;
  const e = p.encoder;
  const lines = [
    `moshpit ${VERSION} · ${where()}`,
    navigator.userAgent,
    `screen ${screen.width}×${screen.height} @${devicePixelRatio}x · cores ${navigator.hardwareConcurrency ?? '?'}`,
    `project: ${p.clips.length} clips, ${p.texts.length} titles, ${p.effects.length} effects (${[...new Set(p.effects.map((x) => x.type))].join(', ') || 'none'}), ${p.media.length} media`,
    `encoder: ${e.codec} ${e.width}px ${e.fps}fps · preview ${store.ui.previewRes} · ${store.totalFrames} frames`,
  ];
  if (store.status.error) lines.push('', 'error: ' + store.status.error.slice(0, 600));
  const tail = log.filter((l) => !META.test(l)).slice(-LOG_LINES);
  if (tail.length) lines.push('', 'engine log:', ...tail.map((l) => l.slice(0, 160)));
  return scrub(lines.join('\n'));
}

export function reportUrl(what = ''): string {
  const q = new URLSearchParams({
    template: 'bug_report.yml',
    version: where(),
    details: `moshpit ${VERSION}, ${navigator.userAgent.slice(0, 160)}`,
    diagnostics: diagnostics().slice(0, 5000),
  });
  if (what) q.set('what', what);
  return `${REPO}/issues/new?${q}`;
}

export function reportProblem(what = '') {
  window.open(reportUrl(what), '_blank', 'noopener');
}
