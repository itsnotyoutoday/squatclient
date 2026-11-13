import { ALIASES, HOME_ID, TOPICS, getTopic } from './data';

/** Keep identical to normalizeKey() in build/build-help.mjs. */
export const normalizeKey = (s: string): string =>
  s.toLowerCase().trim().replace(/^\/+/, '').replace(/\(\)$/, '').replace(/\s+/g, ' ');

export type Resolution =
  { kind: 'topic'; id: string; anchor?: string; term?: string } | { kind: 'search'; query: string };

const lastSegment = (id: string): string => id.slice(id.lastIndexOf('/') + 1);

function findTopicId(key: string): string | undefined {
  if (getTopic(key)) return key;
  const seg = TOPICS.find((t) => lastSegment(t.id) === key);
  if (seg) return seg.id;
  const title = TOPICS.find((t) => normalizeKey(t.title) === key);
  if (title) return title.id;
  return ALIASES[key];
}

/**
 * Resolve what the user typed after `/help`: a topic id or title, a TinyFugue-style command or function
 * name (`def`, `/def`, `strlen`), an optional `#anchor`; anything else becomes a search.
 */
export function resolveQuery(raw: string): Resolution {
  let q = raw.trim();
  if (q.toLowerCase().startsWith('help:')) q = q.slice(5);
  if (!q) return { kind: 'topic', id: HOME_ID };
  const hash = q.indexOf('#');
  const anchorPart = hash >= 0 ? q.slice(hash + 1) : undefined;
  const namePart = hash >= 0 ? q.slice(0, hash) : q;
  const key = normalizeKey(namePart);
  if (!key && anchorPart !== undefined) return { kind: 'topic', id: HOME_ID, anchor: anchorPart };
  const id = findTopicId(key);
  if (!id) return { kind: 'search', query: q };
  const topic = getTopic(id);
  const exact = id === key || lastSegment(id) === key || (topic && normalizeKey(topic.title) === key);
  const anchor = anchorPart && topic?.headings.some((h) => h.id === anchorPart) ? anchorPart : undefined;
  return { kind: 'topic', id, anchor, term: exact ? undefined : namePart.trim() };
}

/** Parse an internal link href (`help:topic#anchor` or `#anchor`). Returns null when it is not internal. */
export function parseHelpHref(href: string, currentId: string): { id: string; anchor?: string } | null {
  if (href.startsWith('#')) return { id: currentId, anchor: href.slice(1) || undefined };
  if (!/^help:/i.test(href)) return null;
  const rest = href.slice(5);
  const hash = rest.indexOf('#');
  const id = hash >= 0 ? rest.slice(0, hash) : rest;
  const anchor = hash >= 0 ? rest.slice(hash + 1) || undefined : undefined;
  return { id: id || currentId, anchor };
}

/** True for URLs that may be opened in the system browser. */
export const isExternalUrl = (href: string): boolean => /^https?:\/\//i.test(href);
