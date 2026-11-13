import type { Line } from '../api/types';
import { lineText } from './runs';

export interface SearchOptions {
  regex: boolean;
  caseSensitive: boolean;
}

export interface Match {
  seq: number;
  start: number;
  end: number;
}

/** Build a matcher; returns null for an empty or invalid pattern. */
export function buildMatcher(query: string, opts: SearchOptions): RegExp | null {
  if (!query) return null;
  try {
    const src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(src, opts.caseSensitive ? 'gu' : 'giu');
  } catch {
    return null;
  }
}

/** Find all matches over loaded lines (ascending seq). Zero-width matches are skipped. */
export function findMatches(lines: readonly Line[], query: string, opts: SearchOptions): Match[] {
  const re = buildMatcher(query, opts);
  if (!re) return [];
  const out: Match[] = [];
  for (const l of lines) {
    const text = lineText(l.spans);
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      out.push({ seq: l.seq, start: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}
