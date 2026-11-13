import { collapse } from '../mushcode';
import { AmbiguousEscapeError, compressEscapes, expandEscapes } from './escapes';

/**
 * How the buffer text relates to the stored (raw) attribute value.
 *
 * - `code`:  the text IS the raw value (literal `%r` stays `%r`). Newlines in it are formatting only
 *   (expanded, indented code), so the value sent is `collapse(text)` (spec 4.4).
 * - `lines`: `%r` / `%t` are shown as real newlines / tabs. Newlines are meaningful, so the value
 *   sent is `compressEscapes(text)` and the code formatter is not applied.
 */
export type ViewMode = 'code' | 'lines';

export type Packed = { ok: true; raw: string } | { ok: false; error: string };

/** The raw value that saving `text` would store (what the engine ends up sending). */
export function pack(mode: ViewMode, text: string): Packed {
  try {
    return { ok: true, raw: compressEscapes(mode === 'code' ? collapse(text) : text) };
  } catch (e) {
    if (e instanceof AmbiguousEscapeError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Buffer text for a raw value in a mode. */
export function unpack(mode: ViewMode, raw: string): string {
  return mode === 'lines' ? expandEscapes(raw) : raw;
}

/** Real newlines in a stored value are meaningful: open those attributes in `lines` mode. */
export const initialMode = (raw: string): ViewMode => (raw.includes('\n') ? 'lines' : 'code');

/** Re-express `text` in the other mode without changing what would be stored. */
export function convert(
  from: ViewMode,
  to: ViewMode,
  text: string,
): { ok: true; text: string } | { ok: false; error: string } {
  if (from === to) return { ok: true, text };
  const p = pack(from, text);
  return p.ok ? { ok: true, text: unpack(to, p.raw) } : p;
}

/** Whether `text` differs from the stored raw value `original`. Text that cannot be packed counts as changed. */
export function isDirty(mode: ViewMode, text: string, original: string): boolean {
  const p = pack(mode, text);
  return !p.ok || p.raw !== original;
}
