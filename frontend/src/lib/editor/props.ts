import type { EditPlace } from '../../api/types';

/**
 * Client-side mirror of the engine's validation for the object details (flag/power names, lock types and
 * keys, new names, real dbrefs). It only rejects early with a clear message; the engine validates again.
 */

const reRealDbref = /^#\d+$/;
const reFlag = /^[A-Za-z0-9_-]{1,64}$/;
const reLockType = /^([A-Za-z][A-Za-z0-9_]{0,31}|user:[A-Za-z0-9_]{1,31})$/i;

export const isRealDbref = (s: string): boolean => reRealDbref.test(s);

/** Error text, or null when `n` is a legal flag or power name. */
export function checkFlagName(n: string): string | null {
  return reFlag.test(n) ? null : 'Use letters, digits, _ and - only';
}

/** Error text, or null when `t` is a legal lock type (Basic, Enter, Use...). */
export function checkLockType(t: string): string | null {
  return reLockType.test(t)
    ? null
    : 'A lock type starts with a letter (letters, digits and _), or is user:name';
}

/** Error text, or null when `x` is an acceptable lock key. */
export function checkLockExpr(x: string): string | null {
  if (x.trim() === '') return 'Enter a lock key, for example #123 or flag^WIZARD';
  if (x !== x.trim()) return 'Remove the spaces around the key';
  if (x.length > 512) return 'That key is too long';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(x)) return 'Control characters are not allowed';
  if (/[[\]{};%\\]/.test(x)) return 'A key cannot contain [ ] { } ; % or \\';
  return null;
}

/** Error text, or null when `n` is an acceptable new object name. */
export function checkName(n: string): string | null {
  if (n.trim() === '') return 'A name cannot be empty';
  if (n !== n.trim()) return 'Remove the spaces around the name';
  if (n.length > 128) return 'That name is too long';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(n)) return 'Control characters are not allowed';
  if (/[[\](){},;%\\=^|]/.test(n)) return 'Names cannot contain brackets, commas, ; % \\ = ^ or |';
  return null;
}

export const LOCK_TYPES = [
  'Basic',
  'Enter',
  'Use',
  'Teleport',
  'Speech',
  'Page',
  'Leave',
  'Drop',
  'Give',
  'Parent',
  'Link',
  'Control',
  'Zone',
  'Mail',
  'Listen',
];

/** Attribute flags the menu offers (the common set; the game decides which it knows). */
export const ATTR_FLAG_NAMES = [
  'no_command',
  'no_inherit',
  'no_clone',
  'mortal_dark',
  'wizard',
  'veiled',
  'case',
  'nearby',
  'locked',
  'safe',
  'visual',
  'regexp',
] as const;

export const ATTR_FLAG_HELP: Record<string, string> = {
  no_command: 'Not run as a $-command or ^-listen.',
  no_inherit: 'Children of this object do not inherit it.',
  no_clone: 'Not copied when the object is cloned.',
  mortal_dark: 'Hidden from ordinary players.',
  wizard: 'Only a wizard may change it.',
  veiled: 'Not shown by examine unless asked for.',
  case: '$-commands match upper and lower case exactly.',
  nearby: 'Only works when the player is near the object.',
  locked: 'Locked against changes (see @atrlock).',
  safe: 'Protected from being changed by accident.',
  visual: 'Anyone may read it.',
  regexp: 'The $-command pattern is a regular expression.',
};

/** Flags a lock can carry (@lset). */
export const LOCK_FLAG_NAMES = ['visual', 'no_inherit', 'no_clone', 'wizard', 'locked'] as const;
export const LOCK_FLAG_HELP: Record<string, string> = {
  visual: 'Anyone may see the lock key.',
  no_inherit: 'Children do not inherit this lock.',
  no_clone: 'Not copied when the object is cloned.',
  wizard: 'Only a wizard may change it.',
  locked: 'Nobody may change it until it is unlocked.',
};

/** Lock key pieces for the lock editor's helper. */
export const LOCK_SNIPPETS: { label: string; text: string; help: string }[] = [
  { label: '#', text: '#', help: 'A player or object by number' },
  { label: '=#', text: '=#', help: 'Is exactly this object' },
  { label: '+#', text: '+#', help: 'Carries this object' },
  { label: '@#', text: '@#', help: "Use another object's lock" },
  { label: 'flag^', text: 'flag^', help: 'Has a flag, e.g. flag^WIZARD' },
  { label: 'type^', text: 'type^', help: 'Is a type, e.g. type^PLAYER' },
  { label: 'power^', text: 'power^', help: 'Has a power' },
  { label: 'ATTR:', text: ':', help: 'Has an attribute with this value, e.g. RANK:captain' },
  { label: '&', text: ' & ', help: 'and' },
  { label: '|', text: ' | ', help: 'or' },
  { label: '!', text: '!', help: 'not' },
  { label: '( )', text: '()', help: 'group' },
];

/** null when the brackets of a key balance, else a message. */
export function checkParens(x: string): string | null {
  let d = 0;
  for (const c of x) {
    if (c === '(') d++;
    else if (c === ')' && --d < 0) return 'A ) has no matching (';
  }
  return d === 0 ? null : `${d} ( not closed`;
}

/** "Widget (#123)" */
export const label = (name: string, dbref: string): string => (name ? `${name} (${dbref})` : dbref);

export const typeLabel = (t: string): string =>
  t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : 'Unknown';

// ---------------------------------------------------------------- recently used move targets (per world)

const RECENT_MAX = 8;
export const recentKey = (worldKey: string): string => `squat.editor.moves.v1.${worldKey}`;

export function loadRecent(worldKey: string): EditPlace[] {
  try {
    const raw = JSON.parse(localStorage.getItem(recentKey(worldKey)) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (p): p is EditPlace =>
          !!p && typeof p.dbref === 'string' && reRealDbref.test(p.dbref) && typeof p.name === 'string',
      )
      .map((p) => ({ dbref: p.dbref, name: p.name, type: p.type ?? '', owner: p.owner ?? '' }))
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function pushRecent(worldKey: string, p: EditPlace): EditPlace[] {
  const next = [p, ...loadRecent(worldKey).filter((x) => x.dbref !== p.dbref)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(recentKey(worldKey), JSON.stringify(next));
  } catch {
    /* private mode: the list just is not remembered */
  }
  return next;
}

// ---------------------------------------------------------------- overview header

/** Shorten a lock key for a chip: keeps the start, adds an ellipsis. */
export function shortExpr(x: string, max = 26): string {
  const t = x.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1))}\u2026`;
}

/** How many chips fit a character budget (at least one when there are any); the rest become "+N more". */
export function fitChips<T>(
  items: T[],
  text: (t: T) => string,
  budget: number,
): { shown: T[]; more: number } {
  const shown: T[] = [];
  let used = 0;
  for (const it of items) {
    const w = text(it).length + 3;
    if (shown.length > 0 && used + w > budget) break;
    shown.push(it);
    used += w;
  }
  return { shown, more: items.length - shown.length };
}

export const overviewKey = (worldKey: string): string => `squat.editor.overview.v1.${worldKey}`;

export function loadOverviewCollapsed(worldKey: string): boolean {
  try {
    return localStorage.getItem(overviewKey(worldKey)) === '1';
  } catch {
    return false;
  }
}

export function saveOverviewCollapsed(worldKey: string, collapsed: boolean): void {
  try {
    localStorage.setItem(overviewKey(worldKey), collapsed ? '1' : '0');
  } catch {
    /* private mode: not remembered */
  }
}
