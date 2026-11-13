import { expandEscapes } from './escapes';

export interface SearchHit {
  attr: string;
  /** 1-based line within the attribute's editable text (%r shown as newlines) */
  line: number;
  col: number;
  /** the matching line, trimmed to a readable length */
  preview: string;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
  /** stop after this many hits (default 500) */
  limit?: number;
}

/** Compile the query, or return an error message (invalid regex). */
export function compileQuery(query: string, o: SearchOptions = {}): RegExp | string {
  const src = o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return new RegExp(src, o.caseSensitive ? 'g' : 'gi');
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Search the values (raw stored text, by attribute name) line by line. */
export function searchValues(
  values: Record<string, string>,
  query: string,
  o: SearchOptions = {},
): SearchHit[] {
  if (query === '') return [];
  const re = compileQuery(query, o);
  if (typeof re === 'string') return [];
  const limit = o.limit ?? 500;
  const hits: SearchHit[] = [];
  for (const attr of Object.keys(values).sort()) {
    const lines = expandEscapes(values[attr]).split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      const m = re.exec(lines[i]);
      if (!m) continue;
      const line = lines[i];
      const from = Math.max(0, m.index - 30);
      hits.push({
        attr,
        line: i + 1,
        col: m.index + 1,
        preview: (from > 0 ? '…' : '') + line.slice(from, from + 120).trim(),
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}
