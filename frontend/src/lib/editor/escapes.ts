/**
 * MUSH escape handling for editing, mirroring the engine (`pkg/engine/mushobj_escapes.go`):
 * `%r` / `%t` <-> newline / tab, scanning left to right with `%%` as a literal percent.
 */

/** Show `%r` as a newline and `%t` as a tab. `%%r` stays `%%r`; nothing else changes. */
export function expandEscapes(s: string): string {
  if (!s.includes('%')) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '%' || i + 1 >= s.length) {
      out += c;
      continue;
    }
    const n = s[i + 1];
    out += n === 'r' ? '\n' : n === 't' ? '\t' : '%' + n;
    i++;
  }
  return out;
}

/** A newline or tab right after an unpaired `%` cannot be written as `%r` without changing its meaning. */
export class AmbiguousEscapeError extends Error {
  constructor() {
    super("A lone '%' before a newline cannot be encoded; write %% or remove it");
    this.name = 'AmbiguousEscapeError';
  }
}

/** Inverse of `expandEscapes` for saving: newline (also CRLF / CR) -> `%r`, tab -> `%t`. Throws AmbiguousEscapeError. */
export function compressEscapes(s: string): string {
  if (!/[\r\n\t]/.test(s)) return s;
  let out = '';
  let pct = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      if (pct % 2 === 1) throw new AmbiguousEscapeError();
      out += '%r';
      pct = 0;
    } else if (c === '\t') {
      if (pct % 2 === 1) throw new AmbiguousEscapeError();
      out += '%t';
      pct = 0;
    } else {
      pct = c === '%' ? pct + 1 : 0;
      out += c;
    }
  }
  return out;
}
