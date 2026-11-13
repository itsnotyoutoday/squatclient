import topicsFile from './generated/topics.json';
import indexFile from './generated/search-index.json';
import type { HelpTopic, HelpTopicsFile, SearchEntry, SearchIndexFile } from './types';

const file = topicsFile as unknown as HelpTopicsFile;
export const TOPICS: readonly HelpTopic[] = file.topics;
export const ALIASES: Readonly<Record<string, string>> = file.aliases;
export const SEARCH_ENTRIES: readonly SearchEntry[] = (indexFile as unknown as SearchIndexFile).entries;

const byId = new Map(TOPICS.map((t) => [t.id, t]));
export { HOME_ID } from './home';

export const getTopic = (id: string): HelpTopic | undefined => byId.get(id);

export function childrenOf(id: string): HelpTopic[] {
  return TOPICS.filter((t) => t.parent === id);
}

/** Ancestors from the root down to (not including) the topic. */
export function ancestorsOf(id: string): HelpTopic[] {
  const out: HelpTopic[] = [];
  let cur = byId.get(id);
  while (cur && cur.parent) {
    const p = byId.get(cur.parent);
    if (!p) break;
    out.unshift(p);
    cur = p;
  }
  return out;
}
