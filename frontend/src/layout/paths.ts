/**
 * Looking things up in GMCP/MSDP data (docs/LAYOUTS.md). GMCP package names are case-insensitive and
 * differ in case between games (`Char.Vitals`, `char.vitals`); the keys inside a payload are
 * case-sensitive. A path such as `Char.Vitals.hp` is resolved by trying the longest package name first.
 */

/** One GMCP package as last received. */
export interface GmcpEntry {
  /** The package name as the game spelled it. */
  name: string;
  data: unknown;
  at: number;
}

export type GmcpMap = Record<string, GmcpEntry>;

export const pkgKey = (name: string): string => name.toLowerCase();

/** Walk `segs` into `v` (objects by key, arrays by index). Undefined when the path does not exist. */
export function getIn(v: unknown, segs: readonly string[]): unknown {
  let cur = v;
  for (const s of segs) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      const i = Number(s);
      if (!Number.isInteger(i)) return undefined;
      cur = cur[i];
    } else {
      cur = (cur as Record<string, unknown>)[s];
    }
  }
  return cur;
}

/** `Char.Vitals.hp` -> the value of key `hp` of package `Char.Vitals` (longest package match wins). */
export function resolveGmcp(map: GmcpMap | undefined, path: string): unknown {
  if (!map) return undefined;
  const segs = path.split('.').filter(Boolean);
  for (let i = segs.length; i >= 1; i--) {
    const e = map[pkgKey(segs.slice(0, i).join('.'))];
    if (e) return i === segs.length ? e.data : getIn(e.data, segs.slice(i));
  }
  return undefined;
}

/** Numbers arrive as numbers (Evennia, Aardwolf) or as strings (Iron Realms): both give a number. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Display text for any value (objects as compact JSON). */
export function toText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/** A binding names where a widget's data comes from: `gmcp:Char.Vitals.hp`, `msdp:HEALTH`, `var:hp`. */
export type Binding = { kind: 'gmcp' | 'msdp' | 'var'; path: string } | { kind: 'literal'; value: unknown };

export function parseBinding(spec: unknown): Binding {
  if (typeof spec === 'string') {
    const m = /^(gmcp|msdp|var):(.+)$/.exec(spec);
    if (m) return { kind: m[1] as 'gmcp' | 'msdp' | 'var', path: m[2] };
  }
  return { kind: 'literal', value: spec };
}
