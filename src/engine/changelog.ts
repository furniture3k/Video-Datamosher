// Parses CHANGELOG.md into versions and bullet points, for the What's New dialog.

export interface Release {
  version: string;
  /** each bullet as text; **bold** runs are kept as marked spans */
  items: { text: string; bold: boolean }[][];
}

/** Split "a **b** c" into plain and bold runs. */
export function boldRuns(s: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  s.split('**').forEach((t, i) => t && out.push({ text: t.replace(/`/g, ''), bold: i % 2 === 1 }));
  return out;
}

export function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  let cur: Release | null = null;
  let bullet: string | null = null;
  const flush = () => {
    if (cur && bullet !== null) cur.items.push(boldRuns(bullet.trim()));
    bullet = null;
  };
  for (const line of md.split(/\r?\n/)) {
    const h = /^##\s+v?(\d+\.\d+\.\d+)/.exec(line);
    if (h) {
      flush();
      cur = { version: h[1], items: [] };
      releases.push(cur);
    } else if (!cur) continue;
    else if (/^\s*[-*]\s+/.test(line)) {
      flush();
      bullet = line.replace(/^\s*[-*]\s+/, '');
    } else if (bullet !== null && /^\s+\S/.test(line)) bullet += ' ' + line.trim();
    else flush();
  }
  flush();
  return releases;
}

/** Compare "1.4.0" style versions: negative when a is older than b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/** Releases newer than `seen` (up to and including `current`). */
export function releasesSince(all: Release[], seen: string, current: string): Release[] {
  return all.filter((r) => compareVersions(r.version, seen) > 0 && compareVersions(r.version, current) <= 0);
}
