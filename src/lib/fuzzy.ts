// Loose matching for the command palette: every letter of the query in order, with points for
// matches at the start of words and runs of letters, so "mlt" finds "Melt the nearest cut" and
// "add bl" finds "Add effect: Bloom".

/** A score for how well `query` matches `text`: higher is better, -1 is no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return 0;
  const t = text.toLowerCase();
  // a plain substring is the best kind of match, more so at a word start
  const at = t.indexOf(q);
  if (at >= 0) return 1000 - at + (at === 0 || /\W/.test(t[at - 1]) ? 200 : 0);
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === ' ') {
      run = 0;
      continue;
    }
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    const wordStart = found === 0 || /[\s\-:/(]/.test(t[found - 1]);
    run = found === ti ? run + 1 : 0;
    score += 10 + (wordStart ? 15 : 0) + run * 5 - Math.min(10, found - ti);
    ti = found + 1;
  }
  return score;
}

/** Items sorted by how well they match (non-matches dropped); the order is kept for ties. */
export function fuzzyFilter<T>(query: string, items: T[], text: (x: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((x, i) => ({ x, i, s: fuzzyScore(query, text(x)) }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((r) => r.x);
}
