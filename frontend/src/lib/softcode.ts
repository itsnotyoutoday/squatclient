/**
 * Block preparation for editor mode: turns the editor text into the lines that are sent to the game.
 * Pure (no DOM, no React) so every rule is unit-tested.
 *
 * Rules, applied in this order:
 *  1. CRLF / CR / LF all end a line.
 *  2. Trailing whitespace is removed from every line (never meaningful to a MU* server).
 *  3. `stripBlank` (setting "stripBlankLines"): blank lines and comment-only lines (first non-blank
 *     characters are `@@`) are dropped. They are dropped BEFORE joining, so a comment or an empty line
 *     between a command and its indented continuation does not break the continuation.
 *  4. `join` (setting "softcodeJoin"): a line that starts with a space or tab continues the previous
 *     sent line: its leading whitespace is removed and it is appended DIRECTLY (no space is inserted;
 *     indent the code for readability, not for spacing). Without `join`, lines are sent as typed.
 *     Leading whitespace is also removed from a first line that has nothing to continue.
 *     When blank lines are kept (stripBlank off) an empty line ends a continuation run: the line after
 *     it starts a new command.
 */
export interface BlockOptions {
  join: boolean;
  stripBlank: boolean;
}

const isBlank = (l: string): boolean => l.trim() === '';
const isComment = (l: string): boolean => l.trimStart().startsWith('@@');
const startsIndented = (l: string): boolean => l.length > 0 && (l[0] === ' ' || l[0] === '\t');

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

export function prepareBlock(text: string, opts: BlockOptions): string[] {
  let lines = splitLines(text).map((l) => l.replace(/\s+$/, ''));
  if (opts.stripBlank) lines = lines.filter((l) => !isBlank(l) && !isComment(l));
  const out: string[] = [];
  for (const l of lines) {
    if (!opts.join) {
      out.push(l);
      continue;
    }
    const body = l.replace(/^\s+/, '');
    if (startsIndented(l) && body !== '' && out.length > 0 && out[out.length - 1] !== '') {
      out[out.length - 1] += body;
    } else {
      out.push(body);
    }
  }
  // an editor that only holds whitespace sends nothing, even when blanks are kept
  return out.every((l) => l === '') ? [] : out;
}

/**
 * The text "Send current line" sends: the selection if there is one, otherwise the line holding the
 * cursor. With `join`, "line" means the logical line: the head line plus the indented lines that
 * continue it, so the cursor may sit on any physical line of a multi-line definition.
 */
export function currentChunk(text: string, start: number, end: number, join: boolean): string {
  if (end > start) return text.slice(start, end);
  const lines = text.split('\n');
  let idx = 0;
  for (let pos = 0; idx < lines.length - 1; idx++) {
    pos += lines[idx].length + 1;
    if (pos > start) break;
  }
  if (!join) return lines[idx];
  let a = idx;
  while (a > 0 && startsIndented(lines[a]) && !isBlank(lines[a])) a--;
  let b = idx;
  while (b + 1 < lines.length && startsIndented(lines[b + 1]) && !isBlank(lines[b + 1])) b++;
  return lines.slice(a, b + 1).join('\n');
}

/** 1-based line and column of a cursor offset. */
export function lineCol(text: string, pos: number): { line: number; col: number } {
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  return { line, col: pos - (before.lastIndexOf('\n') + 1) + 1 };
}

/** Tab inserts two spaces at the cursor; with a selection every selected line is indented. */
export const INDENT = '  ';

export interface EditResult {
  text: string;
  start: number;
  end: number;
}

/** Indent (or, with `back`, outdent) the selection. Returns null when nothing changes. */
export function indentSelection(text: string, start: number, end: number, back: boolean): EditResult | null {
  if (!back && start === end) {
    return { text: text.slice(0, start) + INDENT + text.slice(end), start: start + 2, end: start + 2 };
  }
  const ls = text.lastIndexOf('\n', start - 1) + 1;
  const eEnd = end > start && text[end - 1] === '\n' ? end - 1 : end; // a selection ending after a newline excludes that line
  const nl = text.indexOf('\n', eEnd);
  const le = nl < 0 ? text.length : nl;
  const block = text.slice(ls, le).split('\n');
  const firstDelta: number[] = [];
  const next = block.map((l, i) => {
    let out: string;
    if (!back) out = INDENT + l;
    else if (l.startsWith(INDENT)) out = l.slice(2);
    else if (l.startsWith(' ') || l.startsWith('\t')) out = l.slice(1);
    else out = l;
    firstDelta[i] = out.length - l.length;
    return out;
  });
  const joined = next.join('\n');
  if (joined === text.slice(ls, le)) return null;
  const total = firstDelta.reduce((a, b) => a + b, 0);
  return {
    text: text.slice(0, ls) + joined + text.slice(le),
    start: Math.max(ls, start + firstDelta[0]),
    end: Math.max(ls, end + total),
  };
}
