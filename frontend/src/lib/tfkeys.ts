/**
 * Keys that TinyFugue scripts bound (/bind, /def -b). The engine tells us which key sequences are bound
 * ("tfkeys" event); only those keystrokes are forwarded to it, so normal editing keeps its own keymap.
 * Sequences use /bind's notation: "^A" (control), "^[x" (alt), "^[[11~" (F1 as xterm sends it).
 */
let bound = new Set<string>();

export function setTfBindings(seqs: readonly string[]): void {
  bound = new Set(seqs);
}

export function hasTfBindings(): boolean {
  return bound.size > 0;
}

export function isTfBound(seq: string): boolean {
  return bound.has(seq);
}

interface KeyInfo {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const FKEYS: Record<string, string> = {
  F1: '11',
  F2: '12',
  F3: '13',
  F4: '14',
  F5: '15',
  F6: '17',
  F7: '18',
  F8: '19',
  F9: '20',
  F10: '21',
  F11: '23',
  F12: '24',
  Insert: '2',
  Delete: '3',
  PageUp: '5',
  PageDown: '6',
};
const ARROWS: Record<string, string> = {
  ArrowUp: 'A',
  ArrowDown: 'B',
  ArrowRight: 'C',
  ArrowLeft: 'D',
  Home: 'H',
  End: 'F',
};

/** The /bind notation of a keystroke, or null when it has none. */
export function tfKeySeq(e: KeyInfo): string | null {
  if (e.metaKey) return null;
  const mod = e.altKey ? '^[' : '';
  if (FKEYS[e.key] && !e.ctrlKey) return `${mod}^[[${FKEYS[e.key]}~`;
  if (ARROWS[e.key] && !e.ctrlKey) return `${mod}^[[${ARROWS[e.key]}`;
  let k = e.key;
  if (e.altKey && e.code && /^(Key[A-Z]|Digit[0-9])$/.test(e.code)) k = e.code.slice(-1).toLowerCase(); // macOS Option composes
  if (e.ctrlKey && !e.altKey) {
    if (k.length === 1 && /[a-zA-Z]/.test(k)) return `^${k.toUpperCase()}`;
    if (k === '[') return '^[';
    return null;
  }
  if (e.altKey && k.length === 1) return `${mod}${k}`;
  return null;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Byte offset of a UTF-16 string index (the engine counts bytes, as tf does). */
export function byteOffset(text: string, index: number): number {
  return enc.encode(text.slice(0, index)).length;
}

/** UTF-16 string index of a byte offset. */
export function indexOfByte(text: string, offset: number): number {
  const bytes = enc.encode(text);
  return dec.decode(bytes.slice(0, Math.max(0, Math.min(offset, bytes.length)))).length;
}
