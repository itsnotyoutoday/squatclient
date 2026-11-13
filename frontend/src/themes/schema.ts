/** JSON theme schema: every colour is "#rrggbb" (or #rgb). */
export interface ThemeChrome {
  panel: string;
  panelAlt: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentText: string;
  danger: string;
  warn: string;
  ok: string;
}

export interface Theme {
  id: string;
  name: string;
  kind: 'dark' | 'light';
  fg: string;
  bg: string;
  cursor: string;
  selection: string;
  link: string;
  ansi: string[]; // exactly 16
  chrome: ThemeChrome;
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const CHROME_KEYS: (keyof ThemeChrome)[] = [
  'panel',
  'panelAlt',
  'border',
  'text',
  'textDim',
  'accent',
  'accentText',
  'danger',
  'warn',
  'ok',
];

function color(v: unknown, path: string): string {
  if (typeof v !== 'string' || !HEX.test(v))
    throw new Error(`theme: ${path} must be a #rgb or #rrggbb colour`);
  return v.toLowerCase();
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`theme: ${path} must be a non-empty string`);
  return v;
}

/** Validate untrusted JSON into a Theme. Throws Error with a readable message. */
export function parseTheme(input: unknown): Theme {
  if (typeof input !== 'object' || input === null) throw new Error('theme: expected an object');
  const o = input as Record<string, unknown>;
  const kind = o.kind;
  if (kind !== 'dark' && kind !== 'light') throw new Error('theme: kind must be "dark" or "light"');
  if (!Array.isArray(o.ansi) || o.ansi.length !== 16)
    throw new Error('theme: ansi must be an array of 16 colours');
  const chromeIn = (o.chrome ?? {}) as Record<string, unknown>;
  if (typeof o.chrome !== 'object' || o.chrome === null) throw new Error('theme: chrome is required');
  const chrome = {} as ThemeChrome;
  for (const k of CHROME_KEYS) chrome[k] = color(chromeIn[k], `chrome.${k}`);
  return {
    id: str(o.id, 'id')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-'),
    name: str(o.name, 'name'),
    kind,
    fg: color(o.fg, 'fg'),
    bg: color(o.bg, 'bg'),
    cursor: color(o.cursor, 'cursor'),
    selection: color(o.selection, 'selection'),
    link: color(o.link, 'link'),
    ansi: o.ansi.map((c, i) => color(c, `ansi[${i}]`)),
    chrome,
  };
}

export function parseThemeJson(text: string): Theme {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('theme: not valid JSON');
  }
  return parseTheme(data);
}
