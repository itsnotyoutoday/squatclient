/**
 * Pure input-line editing: key names -> commands -> state transitions. No DOM, no React, so the
 * default bindings can later be replaced (`/bind`) and every key is unit-testable.
 */

export type EditCommand =
  | 'home'
  | 'end'
  | 'left'
  | 'right'
  | 'word-left'
  | 'word-right'
  | 'backspace'
  | 'delete'
  | 'delete-char' // Ctrl-D: delete under cursor
  | 'kill-word-back' // Ctrl-W
  | 'kill-word-fwd' // Alt-D
  | 'kill-to-end' // Ctrl-K
  | 'kill-line' // Ctrl-U
  | 'yank' // Ctrl-Y
  | 'transpose' // Ctrl-T
  | 'up'
  | 'down'
  | 'history-prev' // Ctrl-P
  | 'history-next' // Ctrl-N
  | 'newline'
  | 'submit'
  | 'clear' // Escape
  | 'tab';

export type Keymap = Readonly<Record<string, EditCommand>>;

export const DEFAULT_KEYMAP: Keymap = {
  'C-a': 'home',
  Home: 'home',
  'C-e': 'end',
  End: 'end',
  'C-b': 'left',
  Left: 'left',
  'C-f': 'right',
  Right: 'right',
  'M-b': 'word-left',
  'C-Left': 'word-left',
  'M-Left': 'word-left',
  'M-f': 'word-right',
  'C-Right': 'word-right',
  'M-Right': 'word-right',
  Backspace: 'backspace',
  'C-h': 'backspace',
  Delete: 'delete',
  'C-d': 'delete-char',
  'C-w': 'kill-word-back',
  'M-Backspace': 'kill-word-back',
  'M-d': 'kill-word-fwd',
  'C-k': 'kill-to-end',
  'C-u': 'kill-line',
  'C-y': 'yank',
  'C-t': 'transpose',
  Up: 'up',
  Down: 'down',
  'C-p': 'history-prev',
  'C-n': 'history-next',
  Enter: 'submit',
  'S-Enter': 'newline',
  Escape: 'clear',
  Tab: 'tab',
};

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  code?: string;
}

/** Normalise a keyboard event to a binding name such as "C-a", "M-b", "S-Enter", "Up". */
export function keyName(e: KeyLike): string {
  let k = e.key;
  const named: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ' ': 'Space',
  };
  k = named[k] ?? k;
  // With Alt held, macOS composes characters (Option-B -> "\u222b"); use the physical key instead.
  if (e.altKey && e.code && /^(Key[A-Z]|Digit[0-9])$/.test(e.code)) k = e.code.slice(-1);
  if (k.length === 1) k = k.toLowerCase();
  let p = '';
  if (e.ctrlKey) p += 'C-';
  if (e.altKey) p += 'M-';
  if (e.shiftKey && (k.length > 1 || e.ctrlKey || e.altKey)) p += 'S-';
  if (e.metaKey) p += 'D-';
  return p + k;
}

export interface HistoryNav {
  index: number; // position in history, -1 = editing the draft
  prefix: string; // search prefix captured when navigation started
  draft: string; // text being edited before navigation started
}

export interface EditState {
  text: string;
  cursor: number;
  kill: string; // kill ring (single slot)
  nav: HistoryNav;
}

export const NO_NAV: HistoryNav = { index: -1, prefix: '', draft: '' };

export const initialEdit = (text = ''): EditState => ({ text, cursor: text.length, kill: '', nav: NO_NAV });

export interface EditResult {
  state: EditState;
  /** Set when the command submitted text (Enter). */
  submit?: string;
}

const isWord = (c: string): boolean => /[\p{L}\p{N}_]/u.test(c);

export function wordLeft(text: string, pos: number): number {
  let i = pos;
  while (i > 0 && !isWord(text[i - 1])) i--;
  while (i > 0 && isWord(text[i - 1])) i--;
  return i;
}

export function wordRight(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && !isWord(text[i])) i++;
  while (i < text.length && isWord(text[i])) i++;
  return i;
}

/** Start of the whitespace-delimited word before `pos` (TF ^W kills whitespace-delimited words). */
function spaceWordLeft(text: string, pos: number): number {
  let i = pos;
  while (i > 0 && /\s/.test(text[i - 1])) i--;
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  return i;
}

/** Index of the previous grapheme-ish boundary (handles surrogate pairs and combining marks). */
export function prevChar(text: string, pos: number): number {
  if (pos <= 0) return 0;
  const seg = lastGrapheme(text.slice(0, pos));
  return pos - seg.length;
}
export function nextChar(text: string, pos: number): number {
  if (pos >= text.length) return text.length;
  const seg = firstGrapheme(text.slice(pos));
  return pos + seg.length;
}

type Segmenter = { segment(s: string): Iterable<{ segment: string }> };
const segmenter: Segmenter | null =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new (
        Intl as unknown as { Segmenter: new (l?: string, o?: { granularity: string }) => Segmenter }
      ).Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function firstGrapheme(s: string): string {
  if (segmenter) for (const g of segmenter.segment(s.slice(0, 64))) return g.segment;
  return Array.from(s)[0] ?? '';
}
function lastGrapheme(s: string): string {
  if (segmenter) {
    let last = '';
    for (const g of segmenter.segment(s.slice(-64))) last = g.segment;
    return last;
  }
  const a = Array.from(s);
  return a[a.length - 1] ?? '';
}

function withText(s: EditState, text: string, cursor: number, extra: Partial<EditState> = {}): EditState {
  return { ...s, text, cursor, nav: NO_NAV, ...extra };
}

const lineStart = (text: string, pos: number): number => text.lastIndexOf('\n', pos - 1) + 1;
const lineEnd = (text: string, pos: number): number => {
  const i = text.indexOf('\n', pos);
  return i < 0 ? text.length : i;
};

function historyMove(s: EditState, history: readonly string[], dir: -1 | 1): EditState {
  // history is oldest-first. nav.index === -1 means the draft.
  const starting = s.nav.index === -1;
  const prefix = starting ? s.text.slice(0, s.cursor) : s.nav.prefix;
  const draft = starting ? s.text : s.nav.draft;
  let i = s.nav.index;
  const match = (h: string): boolean => h.startsWith(prefix);
  if (dir === -1) {
    let j = starting ? history.length - 1 : i - 1;
    while (j >= 0 && !match(history[j])) j--;
    if (j < 0) return s;
    i = j;
  } else {
    if (starting) return s;
    let j = i + 1;
    while (j < history.length && !match(history[j])) j++;
    if (j >= history.length) {
      return { ...s, text: draft, cursor: draft.length, nav: NO_NAV };
    }
    i = j;
  }
  const text = history[i];
  return {
    ...s,
    text,
    cursor: prefix ? Math.min(prefix.length, text.length) : text.length,
    nav: { index: i, prefix, draft },
  };
}

/** Apply one editing command. `history` is oldest-first. */
export function applyCommand(s: EditState, cmd: EditCommand, history: readonly string[] = []): EditResult {
  const { text, cursor } = s;
  switch (cmd) {
    case 'home':
      return { state: { ...s, cursor: lineStart(text, cursor) } };
    case 'end':
      return { state: { ...s, cursor: lineEnd(text, cursor) } };
    case 'left':
      return { state: { ...s, cursor: prevChar(text, cursor) } };
    case 'right':
      return { state: { ...s, cursor: nextChar(text, cursor) } };
    case 'word-left':
      return { state: { ...s, cursor: wordLeft(text, cursor) } };
    case 'word-right':
      return { state: { ...s, cursor: wordRight(text, cursor) } };
    case 'backspace': {
      if (cursor === 0) return { state: s };
      const p = prevChar(text, cursor);
      return { state: withText(s, text.slice(0, p) + text.slice(cursor), p) };
    }
    case 'delete':
    case 'delete-char': {
      if (cursor >= text.length) return { state: s };
      const n = nextChar(text, cursor);
      return { state: withText(s, text.slice(0, cursor) + text.slice(n), cursor) };
    }
    case 'kill-word-back': {
      const p = spaceWordLeft(text, cursor);
      if (p === cursor) return { state: s };
      return {
        state: withText(s, text.slice(0, p) + text.slice(cursor), p, { kill: text.slice(p, cursor) }),
      };
    }
    case 'kill-word-fwd': {
      const n = wordRight(text, cursor);
      if (n === cursor) return { state: s };
      return {
        state: withText(s, text.slice(0, cursor) + text.slice(n), cursor, { kill: text.slice(cursor, n) }),
      };
    }
    case 'kill-to-end': {
      const e = text[cursor] === '\n' ? cursor + 1 : lineEnd(text, cursor);
      if (e === cursor) return { state: s };
      return {
        state: withText(s, text.slice(0, cursor) + text.slice(e), cursor, { kill: text.slice(cursor, e) }),
      };
    }
    case 'kill-line':
      if (!text) return { state: s };
      return { state: withText(s, '', 0, { kill: text }) };
    case 'yank':
      if (!s.kill) return { state: s };
      return {
        state: withText(s, text.slice(0, cursor) + s.kill + text.slice(cursor), cursor + s.kill.length),
      };
    case 'transpose': {
      if (text.length < 2) return { state: s };
      let c = cursor;
      if (c >= text.length) c = prevChar(text, c);
      if (c === 0) return { state: s };
      const a = prevChar(text, c);
      const b = nextChar(text, c);
      const next = text.slice(0, a) + text.slice(c, b) + text.slice(a, c) + text.slice(b);
      return { state: withText(s, next, b) };
    }
    case 'up': {
      if (text.includes('\n') && lineStart(text, cursor) > 0)
        return { state: { ...s, cursor: moveLine(text, cursor, -1) } };
      return { state: historyMove(s, history, -1) };
    }
    case 'down': {
      if (text.includes('\n') && lineEnd(text, cursor) < text.length)
        return { state: { ...s, cursor: moveLine(text, cursor, 1) } };
      return { state: historyMove(s, history, 1) };
    }
    case 'history-prev':
      return { state: historyMove(s, history, -1) };
    case 'history-next':
      return { state: historyMove(s, history, 1) };
    case 'newline':
      return { state: withText(s, text.slice(0, cursor) + '\n' + text.slice(cursor), cursor + 1) };
    case 'tab':
      return { state: withText(s, text.slice(0, cursor) + '\t' + text.slice(cursor), cursor + 1) };
    case 'clear':
      return { state: { ...initialEdit(), kill: s.kill } };
    case 'submit':
      return { state: { ...initialEdit(), kill: s.kill }, submit: text };
  }
}

function moveLine(text: string, cursor: number, dir: -1 | 1): number {
  const start = lineStart(text, cursor);
  const col = cursor - start;
  if (dir === -1) {
    const prevEnd = start - 1;
    const prevStart = lineStart(text, prevEnd);
    return Math.min(prevStart + col, prevEnd);
  }
  const end = lineEnd(text, cursor);
  const nextStart = end + 1;
  return Math.min(nextStart + col, lineEnd(text, nextStart));
}

/** Insert text at the cursor (typing / paste of a single line). */
export function insertText(s: EditState, ins: string): EditState {
  return withText(s, s.text.slice(0, s.cursor) + ins + s.text.slice(s.cursor), s.cursor + ins.length);
}

/**
 * Multi-line paste: the pasted text is merged with the existing input and sent line by line.
 * Returns the lines to send (trailing empty line from a final newline is dropped) and the cleared state.
 */
export function pasteToLines(s: EditState, pasted: string): { lines: string[]; state: EditState } {
  const full = s.text.slice(0, s.cursor) + pasted + s.text.slice(s.cursor);
  const lines = full.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return { lines, state: { ...initialEdit(), kill: s.kill } };
}

/** Run a key through a keymap. Returns null when the key is unbound (let the browser insert text). */
export function handleKey(
  s: EditState,
  key: string,
  history: readonly string[],
  keymap: Keymap = DEFAULT_KEYMAP,
): EditResult | null {
  const cmd = keymap[key];
  if (!cmd) return null;
  return applyCommand(s, cmd, history);
}

// ---- history list helpers

/** Append to history (oldest-first), skipping blanks and consecutive duplicates, capped. */
export function pushHistory(history: readonly string[], text: string, cap = 1000): string[] {
  if (!text.trim() || history[history.length - 1] === text) return [...history];
  const next = [...history, text];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
