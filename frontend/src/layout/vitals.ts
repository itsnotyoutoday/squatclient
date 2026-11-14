import { resolveGmcp, toNumber } from './paths';
import type { SessionData } from './store';

/**
 * Different games name their vitals differently. This table finds the common ones: Iron Realms and Evennia
 * style (`Char.Vitals {hp, maxhp, mp, maxmp}`), Aardwolf style (`char.vitals {hp, mana, moves}` with
 * `char.maxstats {maxhp, maxmana, maxmoves}`), MSDP's standard names (`HEALTH`, `HEALTH_MAX`, ...) and a
 * normalised `vitals` script variable (what a Lua adapter would set).
 */
export interface Vital {
  id: string;
  label: string;
  value: number;
  max: number;
}

interface Source {
  id: string;
  label: string;
  /** Candidate [value, max] locations, tried in order. `g:` GMCP path, `m:` MSDP variable, `v:` script variable. */
  where: [string, string][];
}

const SOURCES: Source[] = [
  {
    id: 'hp',
    label: 'HP',
    where: [
      ['g:Char.Vitals.hp', 'g:Char.Vitals.maxhp'],
      ['g:Char.Vitals.health', 'g:Char.Vitals.maxhealth'],
      ['g:char.vitals.hp', 'g:char.maxstats.maxhp'],
      ['m:HEALTH', 'm:HEALTH_MAX'],
      ['v:vitals.hp', 'v:vitals.maxhp'],
    ],
  },
  {
    id: 'mp',
    label: 'MP',
    where: [
      ['g:Char.Vitals.mp', 'g:Char.Vitals.maxmp'],
      ['g:Char.Vitals.mana', 'g:Char.Vitals.maxmana'],
      ['g:char.vitals.mana', 'g:char.maxstats.maxmana'],
      ['m:MANA', 'm:MANA_MAX'],
      ['v:vitals.mp', 'v:vitals.maxmp'],
    ],
  },
  {
    id: 'mv',
    label: 'MV',
    where: [
      ['g:Char.Vitals.mv', 'g:Char.Vitals.maxmv'],
      ['g:Char.Vitals.moves', 'g:Char.Vitals.maxmoves'],
      ['g:char.vitals.moves', 'g:char.maxstats.maxmoves'],
      ['m:MOVEMENT', 'm:MOVEMENT_MAX'],
      ['v:vitals.mv', 'v:vitals.maxmv'],
    ],
  },
  { id: 'ep', label: 'EP', where: [['g:Char.Vitals.ep', 'g:Char.Vitals.maxep']] },
  { id: 'wp', label: 'WP', where: [['g:Char.Vitals.wp', 'g:Char.Vitals.maxwp']] },
];

function read(
  loc: string,
  data: SessionData | undefined,
  vars: Record<string, unknown> | undefined,
): number | undefined {
  const path = loc.slice(2);
  switch (loc[0]) {
    case 'g':
      return toNumber(resolveGmcp(data?.gmcp, path));
    case 'm':
      return toNumber(data?.msdp[path]);
    default: {
      const [name, ...rest] = path.split('.');
      let v: unknown = vars?.[name];
      for (const k of rest)
        v = v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
      return toNumber(v);
    }
  }
}

/** The vitals a session currently reports, in a fixed order; only those with a value and a maximum. */
export function readVitals(
  data: SessionData | undefined,
  vars: Record<string, unknown> | undefined,
): Vital[] {
  const out: Vital[] = [];
  for (const s of SOURCES) {
    for (const [v, m] of s.where) {
      const value = read(v, data, vars);
      const max = read(m, data, vars);
      if (value !== undefined && max !== undefined && max > 0) {
        out.push({ id: s.id, label: s.label, value, max });
        break;
      }
    }
  }
  return out;
}
