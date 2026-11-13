import type { Color, Span } from '../api/types';
import { colorToHex, ensureContrast } from './palette';
import { linkSegments, safeUrl } from './linkify';

export interface RenderTheme {
  fg: string;
  bg: string;
  ansi: readonly string[];
}

export interface RenderOptions {
  boldAsBright: boolean;
  minContrast: number;
  linkify: boolean;
}

export interface Run {
  text: string;
  fg?: string; // resolved "#rrggbb"; undefined = inherit default
  bg?: string;
  b?: boolean;
  dim?: boolean;
  i?: boolean;
  u?: boolean;
  st?: boolean;
  blink?: boolean;
  link?: string; // validated http(s) URL only
}

/** Resolve a span's style to concrete colours/flags (no text). */
export function resolveStyle(
  span: Span,
  theme: RenderTheme,
  opts: Pick<RenderOptions, 'boldAsBright' | 'minContrast'>,
): Omit<Run, 'text' | 'link'> {
  let fgC: Color | undefined = span.fg;
  let bold = !!span.b;
  if (opts.boldAsBright && span.b && typeof fgC === 'number' && fgC >= 0 && fgC < 8) {
    fgC = fgC + 8;
    bold = false;
  }
  let fg = fgC === undefined ? undefined : colorToHex(fgC, theme.ansi);
  let bg = span.bg === undefined ? undefined : colorToHex(span.bg, theme.ansi);
  if (span.rev) {
    const f = fg ?? theme.fg;
    const b = bg ?? theme.bg;
    fg = b;
    bg = f;
  }
  if (opts.minContrast > 0) {
    const against = bg ?? theme.bg;
    const base = fg ?? theme.fg;
    const adj = ensureContrast(base, against, opts.minContrast);
    if (adj !== base) fg = adj;
  }
  const out: Omit<Run, 'text' | 'link'> = {};
  if (fg) out.fg = fg;
  if (bg) out.bg = bg;
  if (bold) out.b = true;
  if (span.dim) out.dim = true;
  if (span.i) out.i = true;
  if (span.u) out.u = true;
  if (span.st) out.st = true;
  if (span.blink) out.blink = true;
  return out;
}

const sameStyle = (a: Run, b: Run): boolean =>
  a.fg === b.fg &&
  a.bg === b.bg &&
  a.b === b.b &&
  a.dim === b.dim &&
  a.i === b.i &&
  a.u === b.u &&
  a.st === b.st &&
  a.blink === b.blink &&
  a.link === b.link;

/** Spans -> merged styled runs (adjacent runs with identical resolved style are joined). */
export function spansToRuns(spans: readonly Span[], theme: RenderTheme, opts: RenderOptions): Run[] {
  const runs: Run[] = [];
  const push = (r: Run): void => {
    if (!r.text) return;
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, r)) last.text += r.text;
    else runs.push(r);
  };
  for (const span of spans) {
    if (!span.s) continue;
    const style = resolveStyle(span, theme, opts);
    const spanLink = span.link ? safeUrl(span.link) : null;
    if (spanLink || !opts.linkify) {
      push({ ...style, text: span.s, ...(spanLink ? { link: spanLink } : {}) });
      continue;
    }
    for (const seg of linkSegments(span.s))
      push({ ...style, text: seg.text, ...(seg.url ? { link: seg.url } : {}) });
  }
  return runs;
}

export const lineText = (spans: readonly Span[]): string => spans.map((s) => s.s).join('');

export interface HighlightRange {
  start: number;
  end: number;
  current: boolean;
}

export interface HlRun extends Run {
  hl?: 'match' | 'current';
}

/** Split runs at highlight boundaries (offsets are in UTF-16 units over the concatenated line text). */
export function applyHighlights(runs: readonly Run[], ranges: readonly HighlightRange[]): HlRun[] {
  if (ranges.length === 0) return runs as HlRun[];
  const out: HlRun[] = [];
  let pos = 0;
  for (const run of runs) {
    const runEnd = pos + run.text.length;
    let cur = pos;
    for (const r of ranges) {
      if (r.end <= cur || r.start >= runEnd) continue;
      const s = Math.max(r.start, cur);
      const e = Math.min(r.end, runEnd);
      if (s > cur) out.push({ ...run, text: run.text.slice(cur - pos, s - pos) });
      out.push({ ...run, text: run.text.slice(s - pos, e - pos), hl: r.current ? 'current' : 'match' });
      cur = e;
    }
    if (cur < runEnd) out.push({ ...run, text: run.text.slice(cur - pos) });
    pos = runEnd;
  }
  return out;
}
