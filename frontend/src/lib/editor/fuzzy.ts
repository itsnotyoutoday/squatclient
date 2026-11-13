/**
 * Fuzzy matching for quick-open: every query character must occur in order (case-insensitive).
 * Higher score is better: consecutive runs, word starts (after `_ . - /`) and a prefix match win.
 */
export function fuzzyScore(query: string, candidate: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (q === '') return 0;
  const c = candidate.toLowerCase();
  let score = 0;
  let ci = 0;
  let prev = -2;
  for (const ch of q) {
    const at = c.indexOf(ch, ci);
    if (at < 0) return null;
    score += 1;
    if (at === prev + 1) score += 3;
    if (at === 0) score += 4;
    else if ('_.-/`'.includes(c[at - 1])) score += 2;
    prev = at;
    ci = at + 1;
  }
  if (c.startsWith(q)) score += 10;
  else if (c.includes(q)) score += 5;
  return score - candidate.length / 100;
}

/** Candidates matching `query`, best first (stable for ties); the empty query keeps the order. */
export function fuzzyFilter<T>(query: string, items: readonly T[], key: (t: T) => string): T[] {
  if (query.trim() === '') return [...items];
  const scored: { t: T; s: number; i: number }[] = [];
  items.forEach((t, i) => {
    const s = fuzzyScore(query, key(t));
    if (s !== null) scored.push({ t, s, i });
  });
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.t);
}
