/**
 * Reversible expand/collapse formatting for softcode. Pure: no DOM, no React.
 *
 * MUSH clients that send blocks treat a line that starts with whitespace as a continuation of the
 * previous line (leading whitespace removed, nothing inserted). `expand` exploits that: it only ever
 * inserts `"\n" + indent` at call boundaries, and `collapse` removes exactly that, so
 * `collapse(expand(x)) === x` for single-line x. See docs/EDITOR.md for the exact rules.
 */
import { scanBalance } from './balance';
import { tokenize } from './tokenize';
import type { Token } from './tokenize';

export interface ExpandOptions {
  /** Spaces per indent level (clamped to >= 1; all continuation lines must start with whitespace). */
  indent?: number;
  /** A call whose single-line source is longer than this is broken across lines. */
  maxInline?: number;
}

const NL = /\r?\n/;

/** Remove every newline plus the whitespace that follows it. Identity on single-line text. */
export function collapse(text: string): string {
  return text.replace(/\r?\n[ \t]*/g, '');
}

/**
 * Send-side rule: a line that begins with whitespace continues the previous line (its leading
 * whitespace is stripped and it is appended directly). Other newlines are kept. Trailing whitespace
 * is NOT trimmed here: `expand` can leave a space before a break (the space that followed a comma),
 * and dropping it would change the code. Lossy only for whitespace that deliberately starts a
 * continuation line. A leading-whitespace first line has nothing to continue and is kept as is.
 */
export function joinContinuations(text: string): string {
  const lines = text.split(NL);
  const out: string[] = [];
  for (const l of lines) {
    if (out.length > 0 && l.length > 0 && (l[0] === ' ' || l[0] === '\t'))
      out[out.length - 1] += l.replace(/^[ \t]+/, '');
    else out.push(l);
  }
  return out.join('\n');
}

/** Expand every logical line (a line plus its continuation lines) independently. */
export function expand(code: string, opts: ExpandOptions = {}): string {
  const indent = Math.max(1, Math.floor(opts.indent ?? 2));
  const maxInline = opts.maxInline ?? 60;
  return joinContinuations(code)
    .split('\n')
    .map((line) => expandLine(line, indent, maxInline))
    .join('\n');
}

function expandLine(src: string, indent: number, maxInline: number): string {
  if (src.length <= maxInline) return src;
  const toks = tokenize(src);
  const { pairs } = scanBalance(src, 'code', toks);
  const byStart = new Map<number, number>();
  toks.forEach((t, i) => byStart.set(t.start, i));
  const pad = (level: number): string => ' '.repeat(indent * level);
  const isBr = (t: Token): boolean => t.kind === 'bracket' || t.kind === 'brace' || t.kind === 'paren';

  /** Render chars [from, to) of src; `level` is the indent level of the line they sit on. */
  const render = (from: number, to: number, level: number): string => {
    let out = '';
    let k = firstTokenAtOrAfter(from);
    while (k < toks.length && toks[k].start < to) {
      const t = toks[k];
      const segFrom = Math.max(t.start, from);
      const segTo = Math.min(t.end, to);
      // braced literal text is opaque: copied verbatim
      if (t.kind === 'brace' && t.text === '{' && t.start >= from) {
        const close = pairs.get(t.start);
        if (close !== undefined && close < to) {
          out += src.slice(t.start, close + 1);
          k = (byStart.get(close) ?? k) + 1;
          continue;
        }
      }
      if (
        (t.kind === 'function' || t.kind === 'unknownFunction') &&
        t.start >= from &&
        toks[k + 1]?.text === '(' &&
        toks[k + 1].start === t.end
      ) {
        const open = toks[k + 1];
        const closeChar = pairs.get(open.start);
        if (closeChar !== undefined && closeChar < to && closeChar > open.start) {
          const closeIdx = byStart.get(closeChar) as number;
          const callEnd = closeChar + 1;
          const args = splitArgs(k + 2, closeIdx);
          const hasContent = args.some((a) => src.slice(a.from, a.to).trim() !== '');
          if (callEnd - t.start > maxInline && hasContent) {
            out += src.slice(t.start, open.end);
            args.forEach((a, j) => {
              const body = src.slice(a.from, a.to);
              const lead = /^[ \t]*/.exec(body)![0].length;
              const content = body.trim() === '' ? '' : body.slice(lead).replace(/[ \t]+$/, '');
              const trail = content === '' ? '' : body.slice(lead + content.length);
              out += body.slice(0, content === '' ? body.length : lead);
              if (content !== '') {
                out +=
                  '\n' +
                  pad(level + 1) +
                  render(a.from + lead, a.from + lead + content.length, level + 1) +
                  trail;
              }
              if (j < args.length - 1) out += ',';
            });
            out += '\n' + pad(level) + ')';
          } else {
            out += src.slice(t.start, callEnd);
          }
          k = closeIdx + 1;
          continue;
        }
      }
      out += src.slice(segFrom, segTo);
      k++;
    }
    return out;
  };

  /** Split the tokens in (open, close) into argument char ranges at top-level commas. */
  const splitArgs = (fromTok: number, closeIdx: number): { from: number; to: number }[] => {
    const args: { from: number; to: number }[] = [];
    let from = toks[fromTok - 1].end;
    for (let k = fromTok; k < closeIdx; k++) {
      const t = toks[k];
      if (isBr(t) && (t.text === '(' || t.text === '[' || t.text === '{')) {
        const close = pairs.get(t.start);
        if (close !== undefined) {
          k = (byStart.get(close) as number) ?? k;
          continue;
        }
      }
      if (t.kind === 'comma') {
        args.push({ from, to: t.start });
        from = t.end;
      }
    }
    args.push({ from, to: toks[closeIdx].start });
    return args;
  };

  const firstTokenAtOrAfter = (pos: number): number => {
    let lo = 0;
    let hi = toks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (toks[mid].end <= pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  return render(0, src.length, 1);
}
