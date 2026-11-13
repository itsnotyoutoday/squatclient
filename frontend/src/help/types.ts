export interface HelpHeading {
  id: string;
  text: string;
  level: number;
}

export interface HelpTopic {
  id: string;
  title: string;
  parent: string;
  order: number;
  keywords: string[];
  aliases: string[];
  source: 'authored' | 'imported';
  headings: HelpHeading[];
  body: string;
}

export interface HelpTopicsFile {
  aliases: Record<string, string>;
  topics: HelpTopic[];
}

/** [topic id, anchor ('' = page top), kind, text]; kind: t title, h heading, k keyword, b body. */
export type SearchEntry = [string, string, 't' | 'h' | 'k' | 'b', string];

export interface SearchIndexFile {
  entries: SearchEntry[];
}
