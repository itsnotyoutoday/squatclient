/** Maps token kinds to the CSS classes the editor (and any other renderer) uses. Pure. */
import type { TokenKind } from './tokenize';

export const TOKEN_CLASS: Record<TokenKind, string> = {
  text: '',
  function: 'mc-function',
  unknownFunction: 'mc-function-unknown',
  bracket: 'mc-bracket',
  brace: 'mc-brace',
  paren: 'mc-paren',
  comma: 'mc-comma',
  semicolon: 'mc-semicolon',
  substitution: 'mc-substitution',
  escape: 'mc-escape',
  number: 'mc-number',
  dbref: 'mc-dbref',
  attrdef: 'mc-attrdef',
  command: 'mc-command',
  pattern: 'mc-pattern',
  comment: 'mc-comment',
};

/** The style class for a token kind ('' for plain text). */
export const classFor = (kind: TokenKind): string => TOKEN_CLASS[kind];

export interface StyledRange {
  from: number;
  to: number;
  className: string;
}

/** Ranges to decorate (plain text is skipped). */
export function styledRanges(tokens: { kind: TokenKind; start: number; end: number }[]): StyledRange[] {
  const out: StyledRange[] = [];
  for (const t of tokens) {
    const className = TOKEN_CLASS[t.kind];
    if (className) out.push({ from: t.start, to: t.end, className });
  }
  return out;
}
