/**
 * Tolerant tokenizer for MUSH softcode (PennMUSH / TinyMUX / CobraMUSH family).
 * Pure: no DOM, no React. It NEVER throws and its tokens always cover the whole input in order
 * (`tokens.map(t => t.text).join('') === code`). It is a syntax-highlighting approximation, not a
 * server-exact parser; see docs/EDITOR.md for the model and its limits.
 */
import { isKnownFunction } from './functions';

export type TokenKind =
  | 'text' // plain text (also whitespace and anything not classified below)
  | 'function' // identifier directly before `(`, known to the game's help files
  | 'unknownFunction' // identifier directly before `(` that is not in the function list
  | 'bracket' // [ ]  evaluation brackets
  | 'brace' // { }  literal / grouping braces
  | 'paren' // ( )
  | 'comma'
  | 'semicolon'
  | 'substitution' // %0 %# %! %q0 %q<name> %r %b %t %=<attr> %va %xr ## #@ ...
  | 'escape' // \x  and  %( %) %[ %] %{ %} %, %;
  | 'number'
  | 'dbref' // #123 #-1 #lambda
  | 'attrdef' // &ATTR (at the start of a line)
  | 'command' // @set @trigger/quiet @pemit ...
  | 'pattern' // $-command / ^-listen pattern, from the sigil through the unescaped `:`
  | 'comment'; // @@ ... to end of line

export interface Token {
  kind: TokenKind;
  /** Offset of the first character. */
  start: number;
  /** Offset one past the last character. */
  end: number;
  text: string;
}

export interface TokenizeOptions {
  /** Override the function-name test (default: the generated function list). */
  isKnown?: (name: string) => boolean;
}

const isWord = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isAlpha = (c: string | undefined): boolean => c !== undefined && /[A-Za-z_]/.test(c);

/** `%` + one of these is an escaped structural character, not a substitution. */
const PERCENT_ESCAPES = new Set(['(', ')', '[', ']', '{', '}', ',', ';']);

export function tokenize(code: string, opts: TokenizeOptions = {}): Token[] {
  const known = opts.isKnown ?? isKnownFunction;
  const n = code.length;
  const out: Token[] = [];
  let textStart = -1;
  /** End of the last substitution/escape: a word may start right after one (`%bfoo(`). */
  let boundaryAt = -1;
  /** End of the last `$`/`^` pattern: the command it triggers starts right after it. */
  let patternEnd = -1;

  const flushText = (upTo: number): void => {
    if (textStart >= 0 && upTo > textStart) {
      out.push({ kind: 'text', start: textStart, end: upTo, text: code.slice(textStart, upTo) });
    }
    textStart = -1;
  };
  const emit = (kind: TokenKind, start: number, end: number): void => {
    flushText(start);
    out.push({ kind, start, end, text: code.slice(start, end) });
  };

  /** Previous non-blank character on the same line, or '' at the line start. */
  const prevSig = (i: number): string => {
    for (let j = i - 1; j >= 0; j--) {
      const c = code[j];
      if (c === '\n' || c === '\r') return '';
      if (c !== ' ' && c !== '\t') return c;
    }
    return '';
  };
  const wordStart = (i: number): boolean => i === 0 || !isWord(code[i - 1]) || i === boundaryAt;
  const lineEnd = (i: number): number => {
    let j = i;
    while (j < n && code[j] !== '\n' && code[j] !== '\r') j++;
    return j;
  };

  let i = 0;
  while (i < n) {
    const c = code[i];
    const next = code[i + 1];

    if (c === '\\') {
      const end = next !== undefined && next !== '\n' && next !== '\r' ? i + 2 : i + 1;
      emit('escape', i, end);
      boundaryAt = end;
      i = end;
      continue;
    }

    if (c === '%') {
      let end = i + 1;
      if (next !== undefined && next !== '\n' && next !== '\r') {
        end = i + 2;
        if (PERCENT_ESCAPES.has(next)) {
          emit('escape', i, end);
          boundaryAt = end;
          i = end;
          continue;
        }
        const lower = next.toLowerCase();
        const after = code[end];
        if (lower === 'q') {
          if (after === '<') {
            const close = code.indexOf('>', end);
            const eol = lineEnd(end);
            if (close !== -1 && close < eol) end = close + 1;
          } else if (after !== undefined && /[0-9A-Za-z]/.test(after)) end++;
        } else if (lower === 'v' || lower === 'w') {
          if (after !== undefined && /[A-Za-z]/.test(after)) end++;
        } else if (lower === 'i') {
          if (isDigit(after)) end++;
        } else if (lower === 'x') {
          if (after === '<') {
            const close = code.indexOf('>', end);
            const eol = lineEnd(end);
            if (close !== -1 && close < eol) end = close + 1;
          } else if (after !== undefined && /[A-Za-z]/.test(after)) end++;
        } else if (next === '=' && after === '<') {
          const close = code.indexOf('>', end);
          const eol = lineEnd(end);
          if (close !== -1 && close < eol) end = close + 1;
        }
      }
      emit('substitution', i, end);
      boundaryAt = end;
      i = end;
      continue;
    }

    switch (c) {
      case '[':
      case ']':
        emit('bracket', i, i + 1);
        i++;
        continue;
      case '{':
      case '}':
        emit('brace', i, i + 1);
        i++;
        continue;
      case '(':
      case ')':
        emit('paren', i, i + 1);
        i++;
        continue;
      case ',':
        emit('comma', i, i + 1);
        i++;
        continue;
      case ';':
        emit('semicolon', i, i + 1);
        i++;
        continue;
    }

    const sig = prevSig(i);
    const atLineStart = sig === '';
    const afterPattern = patternEnd >= 0 && code.slice(patternEnd, i).trim() === '';
    const cmdPos = atLineStart || sig === ';' || sig === '{' || sig === ',' || sig === '=' || afterPattern;

    if (c === '@' && cmdPos && wordStart(i)) {
      if (next === '@') {
        emit('comment', i, lineEnd(i));
        i = lineEnd(i);
        continue;
      }
      if (isAlpha(next)) {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_-]/.test(code[j])) j++;
        while (code[j] === '/' && /[A-Za-z0-9_]/.test(code[j + 1] ?? '')) {
          j++;
          while (j < n && /[A-Za-z0-9_]/.test(code[j])) j++;
        }
        emit('command', i, j);
        i = j;
        continue;
      }
    }

    if (c === '&' && atLineStart && next !== undefined && !/[\s=]/.test(next)) {
      let j = i + 1;
      while (j < n && !/[\s=]/.test(code[j])) j++;
      emit('attrdef', i, j);
      i = j;
      continue;
    }

    if ((c === '$' || c === '^') && (atLineStart || sig === '=')) {
      const eol = lineEnd(i);
      let j = i + 1;
      let found = -1;
      while (j < eol) {
        if (code[j] === '\\') {
          j += 2;
          continue;
        }
        if (code[j] === ':') {
          found = j;
          break;
        }
        j++;
      }
      if (found !== -1) {
        emit('pattern', i, found + 1);
        i = patternEnd = found + 1;
        continue;
      }
    }

    if (c === '#' && wordStart(i)) {
      if (next === '#' || next === '@' || next === '$') {
        emit('substitution', i, i + 2);
        boundaryAt = i + 2;
        i += 2;
        continue;
      }
      const m = /^#(?:-?\d+|lambda)(?![A-Za-z0-9_])/i.exec(code.slice(i, i + 40));
      if (m) {
        emit('dbref', i, i + m[0].length);
        i += m[0].length;
        continue;
      }
    }

    if (wordStart(i)) {
      if (isAlpha(c)) {
        let j = i + 1;
        while (j < n && isWord(code[j])) j++;
        if (code[j] === '(') {
          emit(known(code.slice(i, j)) ? 'function' : 'unknownFunction', i, j);
          i = j;
          continue;
        }
        if (textStart < 0) textStart = i;
        i = j;
        continue;
      }
      if (isDigit(c) || (c === '-' && isDigit(next))) {
        const m = /^-?\d+(?:\.\d+)?(?![A-Za-z0-9_])/.exec(code.slice(i, i + 64));
        if (m) {
          emit('number', i, i + m[0].length);
          i += m[0].length;
          continue;
        }
      }
    }

    if (textStart < 0) textStart = i;
    i++;
  }
  flushText(n);
  return out;
}
