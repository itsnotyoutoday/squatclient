import type { FileResult } from '../../api/types';

/** Same cap as the Go side (internal/app/files.go MaxUploadBytes). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_CONTROL_RATIO = 0.02;
const MAX_INVALID_RATIO = 0.2;

export function humanBytes(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MiB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KiB`;
  return `${n} bytes`;
}

/**
 * Decode the bytes of a dropped file with the same rules as the Go `ReadTextFile`: refuse files over
 * the cap and binary content (NUL bytes, many control characters, mostly invalid UTF-8), strip a
 * UTF-8 BOM, fall back from UTF-8 to Latin-1 and normalise CRLF / CR to LF.
 */
export function decodeTextBytes(name: string, bytes: Uint8Array): FileResult {
  const fail = (error: string): FileResult => ({
    ok: false,
    error,
    path: name,
    name,
    size: bytes.length,
    encoding: '',
    text: '',
  });
  if (bytes.length > MAX_UPLOAD_BYTES)
    return fail(
      `file is too large (${humanBytes(bytes.length)}; the limit is ${humanBytes(MAX_UPLOAD_BYTES)})`,
    );
  let b = bytes;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  let ctl = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === 0)
      return fail('this looks like a binary file (it contains NUL bytes); only text files can be uploaded');
    if ((c < 0x20 && c !== 10 && c !== 13 && c !== 9 && c !== 12 && c !== 0x1b) || c === 0x7f) ctl++;
  }
  let text: string;
  let encoding = 'utf-8';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    // count bytes that are not part of any valid UTF-8 sequence
    const lossy = new TextDecoder('utf-8').decode(b);
    let bad = 0;
    for (let i = 0; i < lossy.length; i++) if (lossy.charCodeAt(i) === 0xfffd) bad++;
    if (bad > MAX_INVALID_RATIO * b.length)
      return fail('this looks like a binary file; only text files can be uploaded');
    const parts: string[] = [];
    for (let i = 0; i < b.length; i += 8192) parts.push(String.fromCharCode(...b.subarray(i, i + 8192)));
    text = parts.join('');
    encoding = 'latin1';
  }
  if (ctl > MAX_CONTROL_RATIO * b.length)
    return fail('this looks like a binary file; only text files can be uploaded');
  text = text.replace(/\r\n?/g, '\n');
  return { ok: true, path: name, name, size: bytes.length, encoding, text };
}

/** Read a dropped `File` (FileReader) and decode it. */
export function readDroppedFile(file: File): Promise<FileResult> {
  return new Promise((resolve) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      resolve(emptyFail(file));
      return;
    }
    const r = new FileReader();
    r.onerror = () => resolve({ ...emptyFail(file), error: `cannot read ${file.name}` });
    r.onload = () => resolve(decodeTextBytes(file.name, new Uint8Array(r.result as ArrayBuffer)));
    r.readAsArrayBuffer(file);
  });
}

function emptyFail(file: File): FileResult {
  return {
    ok: false,
    error: `file is too large (${humanBytes(file.size)}; the limit is ${humanBytes(MAX_UPLOAD_BYTES)})`,
    path: file.name,
    name: file.name,
    size: file.size,
    encoding: '',
    text: '',
  };
}
