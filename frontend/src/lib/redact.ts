/**
 * Redaction for the Diagnostics report: free text that came from the app, a game or an error
 * message may carry a password, token, pairing code or key. Everything here errs on the side of
 * removing too much.
 */

export const REDACTED = '[redacted]';

export interface RedactOptions {
  /** Hostnames that must not appear (squatter and world hosts). */
  hosts?: readonly string[];
  /** Also hide IPv4 addresses and host:port pairs (default true). */
  network?: boolean;
}

/** Setting / field names whose values are never shown. */
export const SECRET_NAME =
  /pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|private|credential|auth|fingerprint|cookie|session[_-]?id|\bkey\b|_key$/i;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function redact(text: string, opts: RedactOptions = {}): string {
  let s = text;
  for (const h of opts.hosts ?? []) {
    if (h.trim()) s = s.replace(new RegExp(escapeRe(h.trim()), 'gi'), '[host]');
  }
  if (opts.network !== false) {
    s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, '[ip]');
    s = s.replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+:\d{2,5}\b/gi, '[host]:port');
  }
  // credentials inside a URL: scheme://user:pass@host
  s = s.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, `$1${REDACTED}@`);
  // name=value / name: value / "name":"value" for secret-looking names
  s = s.replace(
    /(\b[\w.-]*(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|private[_-]?key|credential|authorization|fingerprint|cookie|key)[\w.-]*\b["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}\]]+)/gi,
    `$1${REDACTED}`,
  );
  // "Bearer xyz", "Basic xyz"
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`);
  // SSH-style fingerprints
  s = s.replace(/\b(?:SHA256|MD5):[A-Za-z0-9+/=:]{16,}/g, REDACTED);
  s = s.replace(/\b(?:[0-9a-f]{2}:){15,}[0-9a-f]{2}\b/gi, REDACTED);
  // pairing codes: ABCD-EFGH (also ABCD-EFGH-IJKL)
  s = s.replace(/\b[A-Z0-9]{4}(?:-[A-Z0-9]{4}){1,3}\b/g, REDACTED);
  // long hex strings (keys, hashes, ids)
  s = s.replace(/\b[0-9a-f]{24,}\b/gi, REDACTED);
  // long base64/base64url-looking tokens (needs both a letter and a digit)
  s = s.replace(/[A-Za-z0-9_-]{32,}={0,2}/g, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? REDACTED : m));
  return s;
}

/** A settings value as one line of report text. Secret-looking names are replaced entirely. */
export function safeValue(name: string, value: unknown): string {
  if (SECRET_NAME.test(name)) return REDACTED;
  if (value === undefined) return '(unset)';
  const t = typeof value === 'string' ? JSON.stringify(value) : (JSON.stringify(value) ?? String(value));
  return redact(t, { network: false });
}
