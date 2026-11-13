import type { EditPlace } from '../../api/types';

/**
 * Client-side mirror of the engine's validation for the object details (flag/power names, lock types and
 * keys, new names, real dbrefs). It only rejects early with a clear message; the engine validates again.
 */

const reRealDbref = /^#\d+$/;
const reFlag = /^[A-Za-z0-9_-]{1,64}$/;
const reLockType = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

export const isRealDbref = (s: string): boolean => reRealDbref.test(s);

/** Error text, or null when `n` is a legal flag or power name. */
export function checkFlagName(n: string): string | null {
  return reFlag.test(n) ? null : 'Use letters, digits, _ and - only';
}

/** Error text, or null when `t` is a legal lock type (Basic, Enter, Use...). */
export function checkLockType(t: string): string | null {
  return reLockType.test(t) ? null : 'A lock type starts with a letter and has letters, digits and _ only';
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

/** Attribute flags the menu offers (the game decides which it knows). */
export const ATTR_FLAG_NAMES = [
  'no_command',
  'no_inherit',
  'no_clone',
  'visual',
  'safe',
  'locked',
  'mortal_dark',
] as const;

export const ATTR_FLAG_HELP: Record<string, string> = {
  no_command: 'The attribute is not run as a $-command or ^-listen.',
  no_inherit: 'Children of this object do not inherit the attribute.',
  no_clone: 'The attribute is not copied when the object is cloned.',
  visual: 'Anyone may read the attribute.',
  safe: 'Protects the attribute from being changed by accident.',
  locked: 'Only a wizard may change the attribute.',
  mortal_dark: 'Hidden from ordinary players.',
};

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
