/** Pure helpers of the history browser: match highlighting, previews, row sizes. */

export interface MatchOpts {
  regex: boolean;
  caseSensitive: boolean;
}

/** [start, end) ranges of every match of `query` in `text` (empty for an empty or invalid query). */
export function matchRanges(text: string, query: string, o: MatchOpts): [number, number][] {
  if (!query) return [];
  const out: [number, number][] = [];
  if (o.regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, o.caseSensitive ? 'g' : 'gi');
    } catch {
      return [];
    }
    for (const m of text.matchAll(re)) {
      if (m[0] === '') continue;
      out.push([m.index, m.index + m[0].length]);
      if (out.length >= 200) break;
    }
    return out;
  }
  const hay = o.caseSensitive ? text : text.toLowerCase();
  const q = o.caseSensitive ? query : query.toLowerCase();
  if (hay.length !== text.length) return []; // case folding changed the length: skip highlighting rather than misplace it
  for (let i = hay.indexOf(q); i >= 0 && out.length < 200; i = hay.indexOf(q, i + q.length)) {
    out.push([i, i + q.length]);
  }
  return out;
}

export interface Segment {
  text: string;
  hit: boolean;
}

/** Split a line into plain and highlighted pieces; `base` is the line's offset inside the entry text. */
export function segments(line: string, base: number, ranges: readonly [number, number][]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    const s = Math.max(a - base, at);
    const e = Math.min(b - base, line.length);
    if (e <= s || s >= line.length || e <= 0) continue;
    if (s > at) out.push({ text: line.slice(at, s), hit: false });
    out.push({ text: line.slice(s, e), hit: true });
    at = e;
  }
  if (at < line.length || out.length === 0) out.push({ text: line.slice(at), hit: false });
  return out;
}

export const PREVIEW_LINES = 3;

export interface Preview {
  /** The lines shown, with their offset inside the entry text. */
  lines: { text: string; base: number }[];
  before: number; // lines hidden above (preview starts at the first match when it is further down)
  after: number; // lines hidden below
}

export function preview(text: string, ranges: readonly [number, number][], n = PREVIEW_LINES): Preview {
  const all: { text: string; base: number }[] = [];
  let base = 0;
  for (const t of text.split('\n')) {
    all.push({ text: t, base });
    base += t.length + 1;
  }
  let start = 0;
  if (ranges.length > 0) {
    const i = all.findIndex((l) => ranges[0][0] < l.base + l.text.length + 1);
    if (i >= n) start = i;
  }
  const lines = all.slice(start, start + n);
  return { lines, before: start, after: Math.max(0, all.length - start - lines.length) };
}

const ROW_PAD = 12;
export const LINE_PX = 18;
export const PLACEHOLDER_PX = 30;

/** Deterministic row height so the list can be virtualised without measuring. */
export function rowHeight(text: string): number {
  const n = Math.min(PREVIEW_LINES, text.split('\n').length);
  return ROW_PAD + n * LINE_PX + (text.split('\n').length > PREVIEW_LINES ? LINE_PX : 0);
}
