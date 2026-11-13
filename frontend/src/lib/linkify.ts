/** Return the URL if (and only if) it is a well-formed http(s) URL, else null. Never allows javascript:, data:, file: etc. */
export function safeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return t;
  } catch {
    return null;
  }
}

export interface LinkSegment {
  text: string;
  url?: string;
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const OPENERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const count = (s: string, c: string): number => s.split(c).length - 1;

function trimUrl(input: string): string {
  let u = input;
  for (;;) {
    const c = u[u.length - 1];
    if (!c) return u;
    if (/[.,;:!?'">]/.test(c)) u = u.slice(0, -1);
    else if (OPENERS[c] && count(u, c) > count(u, OPENERS[c])) u = u.slice(0, -1);
    else return u;
  }
}

/** Split text into plain and http(s)-link segments. Concatenating segment texts always equals the input. */
export function linkSegments(text: string): LinkSegment[] {
  if (!/https?:\/\//i.test(text)) return [{ text }];
  const out: LinkSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const url = trimUrl(m[0]);
    const safe = safeUrl(url);
    if (!safe) continue;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: url, url: safe });
    last = start + url.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}
