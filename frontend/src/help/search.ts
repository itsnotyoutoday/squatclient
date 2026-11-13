import { ALIASES, SEARCH_ENTRIES } from './data';
import { normalizeKey } from './lookup';
import type { SearchEntry } from './types';

export interface SearchResult {
  topic: string;
  anchor: string;
  score: number;
  snippet: string;
}

const WEIGHT = { t: 10, h: 6, k: 4, b: 1 } as const;

export const tokenize = (q: string): string[] =>
  q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^\/+/, ''))
    .filter(Boolean);

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function snippetOf(text: string, tokens: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (text.length <= 160 || at < 0) return text.slice(0, 160);
  const start = Math.max(0, at - 50);
  return (start > 0 ? '…' : '') + text.slice(start, start + 160) + (start + 160 < text.length ? '…' : '');
}

interface Acc {
  /** best weight reached per token */
  per: number[];
  best?: { entry: SearchEntry; score: number };
  bonus: number;
}

/**
 * Ranked search over the generated index. Every word must occur somewhere in a topic (prefix or substring
 * match); weights: title > heading > keyword > body, with a bonus for whole-word hits and for a single entry
 * that contains all words. Returns one result per topic, best first.
 */
export function search(
  query: string,
  entries: readonly SearchEntry[] = SEARCH_ENTRIES,
  limit = 40,
): SearchResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const wordRes = tokens.map((t) => new RegExp(`(^|[^a-z0-9_])${escapeRe(t)}`, 'i'));
  const joined = tokens.join(' ');
  const acc = new Map<string, Acc>();

  for (const entry of entries) {
    const [topic, , kind, text] = entry;
    const lower = text.toLowerCase();
    let hits = 0;
    let entryScore = 0;
    const weights: number[] = [];
    tokens.forEach((t, i) => {
      if (!lower.includes(t)) {
        weights.push(0);
        return;
      }
      hits++;
      const w = WEIGHT[kind] * (wordRes[i].test(lower) ? 1.5 : 1);
      weights.push(w);
      entryScore += w;
    });
    if (hits === 0) continue;
    let a = acc.get(topic);
    if (!a) acc.set(topic, (a = { per: tokens.map(() => 0), bonus: 0 }));
    weights.forEach((w, i) => {
      if (w > a!.per[i]) a!.per[i] = w;
    });
    if (hits === tokens.length) entryScore *= 1.5;
    if (kind === 't') {
      if (lower === joined) a.bonus = Math.max(a.bonus, 30);
      else if (lower.startsWith(joined)) a.bonus = Math.max(a.bonus, 12);
    }
    if (!a.best || entryScore > a.best.score) a.best = { entry, score: entryScore };
  }

  // A query that is exactly a command/function name puts its home topic first.
  const aliasTopic = entries === SEARCH_ENTRIES ? ALIASES[normalizeKey(query)] : undefined;
  if (aliasTopic) {
    const a = acc.get(aliasTopic);
    if (a) a.bonus += 25;
  }

  const out: SearchResult[] = [];
  for (const [topic, a] of acc) {
    if (a.per.some((w) => w === 0)) continue; // every word must appear in the topic
    const score = a.per.reduce((x, y) => x + y, 0) + a.bonus + (a.best ? a.best.score * 0.1 : 0);
    const entry = a.best!.entry;
    out.push({ topic, anchor: entry[1], score, snippet: snippetOf(entry[3], tokens) });
  }
  return out.sort((x, y) => y.score - x.score || x.topic.localeCompare(y.topic)).slice(0, limit);
}
