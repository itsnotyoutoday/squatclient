/**
 * Bracket balance checking for softcode: () [] {} honouring `\` escapes and `%(`-style escapes.
 * Built on the tokenizer, so brackets inside `$`/`^` patterns and `@@` comments are not counted
 * (see docs/EDITOR.md). Pure: no DOM, no React.
 */
import { tokenize } from './tokenize';
import type { Token } from './tokenize';

export type IssueKind = 'unclosed' | 'unmatched' | 'mismatch';
export interface BalanceIssue {
  kind: IssueKind;
  /** Offset of the offending bracket. */
  index: number;
  /** 1-based line and column of `index`. */
  line: number;
  col: number;
  /** The closing character that was expected (unclosed, mismatch). */
  expected?: string;
  message: string;
}

export interface BalanceOptions {
  /**
   * 'code' (default): every bracket must balance.
   * 'lenient': for text that mixes prose with code. A `(` that is not a function call and a `)` that has
   * no function call or `[` around it (smileys like `:)`, "(see below)") are tolerated.
   */
  mode?: 'code' | 'lenient';
}

const CLOSER: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const OPENER: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

interface Open {
  ch: string;
  index: number;
  /** `(` preceded directly by a function name. */
  call: boolean;
}

export interface Scan {
  issues: BalanceIssue[];
  /** Matched pairs, both directions: open index <-> close index. */
  pairs: Map<number, number>;
}

function locate(code: string, index: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < index; i++) {
    if (code[i] === '\n') {
      line++;
      last = i;
    }
  }
  return { line, col: index - last };
}

/** Core scan over tokens; shared by checkBalance, matchBracketAt and the formatter. */
export function scanBalance(code: string, mode: 'code' | 'lenient' = 'code', tokens?: Token[]): Scan {
  const toks = tokens ?? tokenize(code);
  const lenient = mode === 'lenient';
  const stack: Open[] = [];
  const issues: BalanceIssue[] = [];
  const pairs = new Map<number, number>();
  const raw: Omit<BalanceIssue, 'line' | 'col'>[] = [];

  let prev: Token | undefined;
  for (const t of toks) {
    const ch = t.text;
    const isBr = t.kind === 'bracket' || t.kind === 'brace' || t.kind === 'paren';
    if (isBr && CLOSER[ch]) {
      const call =
        ch === '(' &&
        prev !== undefined &&
        (prev.kind === 'function' || prev.kind === 'unknownFunction') &&
        prev.end === t.start;
      stack.push({ ch, index: t.start, call });
    } else if (isBr) {
      const want = OPENER[ch];
      // lenient: soft (prose) parens never block a different closer
      if (lenient && ch !== ')') {
        while (stack.length && stack[stack.length - 1].ch === '(' && !stack[stack.length - 1].call)
          stack.pop();
      }
      const top = stack[stack.length - 1];
      if (top && top.ch === want) {
        stack.pop();
        pairs.set(top.index, t.start);
        pairs.set(t.start, top.index);
      } else {
        let depth = -1;
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].ch === want) {
            depth = k;
            break;
          }
        }
        if (depth >= 0) {
          raw.push({
            kind: 'mismatch',
            index: t.start,
            expected: CLOSER[top.ch],
            message: `'${ch}' closes '${want}' but '${top.ch}' at ${top.index} is still open (expected '${CLOSER[top.ch]}')`,
          });
          const o = stack[depth];
          pairs.set(o.index, t.start);
          pairs.set(t.start, o.index);
          stack.length = depth;
        } else if (lenient && ch === ')' && !stack.some((s) => s.call || s.ch === '[')) {
          // smiley / prose paren outside any call: tolerated
        } else {
          raw.push({ kind: 'unmatched', index: t.start, message: `Unmatched '${ch}'` });
        }
      }
    }
    prev = t;
  }
  for (const o of stack) {
    if (lenient && o.ch === '(' && !o.call) continue;
    raw.push({
      kind: 'unclosed',
      index: o.index,
      expected: CLOSER[o.ch],
      message: `Unclosed '${o.ch}' (expected '${CLOSER[o.ch]}')`,
    });
  }
  raw.sort((a, b) => a.index - b.index);
  for (const r of raw) issues.push({ ...r, ...locate(code, r.index) });
  return { issues, pairs };
}

export function checkBalance(code: string, opts: BalanceOptions = {}): BalanceIssue[] {
  return scanBalance(code, opts.mode ?? 'code').issues;
}

export interface BracketMatch {
  open: number;
  close: number;
}

/**
 * The bracket pair to highlight for a cursor at `index` (between characters). Like most editors it
 * looks at the character after the cursor first, then the one before. Returns null when neither is a
 * matched bracket. Uses 'code' mode pairing.
 */
export function matchBracketAt(code: string, index: number): BracketMatch | null {
  const { pairs } = scanBalance(code, 'code');
  for (const i of [index, index - 1]) {
    if (i < 0 || i >= code.length) continue;
    const other = pairs.get(i);
    if (other !== undefined) return { open: Math.min(i, other), close: Math.max(i, other) };
  }
  return null;
}
