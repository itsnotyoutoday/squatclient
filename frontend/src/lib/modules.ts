import type { SessionInfo } from '../api/types';
import { useSessions } from '../state/stores';

/**
 * Game modules: client features that only make sense for one family of games. A session's game
 * type (detected from the game or set per world) decides which modules it gets. The Object Editor
 * is the module for the MU* family (PennMUSH, CobraMUSH, TinyMUX, TinyMUSH, RhostMUSH...); other
 * kinds of game get their own modules, and none of this is offered for a game whose family is
 * unknown or different.
 */
export interface GameModule {
  id: string;
  title: string;
  /** Game families (SessionInfo.gameFamily) the module applies to. */
  families: readonly string[];
}

export const OBJECT_EDITOR: GameModule = { id: 'object-editor', title: 'Object Editor', families: ['mush'] };

/** Every game type the client knows (mirrors engine.GameKinds), for menus. */
export const GAME_TYPES: readonly { type: string; family: string; name: string }[] = [
  { type: 'pennmush', family: 'mush', name: 'PennMUSH' },
  { type: 'cobramush', family: 'mush', name: 'CobraMUSH' },
  { type: 'tinymux', family: 'mush', name: 'TinyMUX' },
  { type: 'tinymush', family: 'mush', name: 'TinyMUSH' },
  { type: 'rhostmush', family: 'mush', name: 'RhostMUSH' },
  { type: 'tinymuse', family: 'mush', name: 'TinyMUSE (MicroMUSE, PernMUSE...)' },
  { type: 'mush', family: 'mush', name: 'Other MU*' },
  { type: 'circlemud', family: 'diku', name: 'CircleMUD / tbaMUD' },
  { type: 'rom', family: 'diku', name: 'ROM / Merc / Envy' },
  { type: 'smaug', family: 'diku', name: 'SMAUG / SWR' },
  { type: 'diku', family: 'diku', name: 'Other Diku-style' },
  { type: 'lpmud', family: 'lp', name: 'LPmud (MudOS, FluffOS, DGD, LDMud)' },
  { type: 'lambdamoo', family: 'moo', name: 'MOO (LambdaMOO, ToastStunt)' },
  { type: 'evennia', family: 'evennia', name: 'Evennia' },
  { type: 'muck', family: 'muck', name: 'MUCK (Fuzzball, TinyMUCK)' },
  { type: 'coldmud', family: 'cold', name: 'ColdMUD' },
  { type: 'coffeemud', family: 'coffeemud', name: 'CoffeeMUD' },
  { type: 'ironrealms', family: 'ironrealms', name: 'Iron Realms (Achaea, Aetolia...)' },
  { type: 'custom', family: 'custom', name: 'Other MUD (not listed)' },
];

export const MODULES: readonly GameModule[] = [OBJECT_EDITOR];

/** Does the module apply to this session? Games whose type is not known yet get no modules. */
export function hasModule(mod: GameModule, s: Pick<SessionInfo, 'gameFamily'> | null | undefined): boolean {
  return !!s?.gameFamily && mod.families.includes(s.gameFamily);
}

/** A session id as a live session offering the module. */
export function sessionHasModule(mod: GameModule, sid: string | null | undefined): boolean {
  if (!sid) return false;
  const s = useSessions.getState().sessions[sid];
  return !!s && s.state !== 'ended' && hasModule(mod, s);
}

/** Zustand selector: does the foreground session offer the module? */
export const fgHasModule =
  (mod: GameModule) =>
  (s: Pick<ReturnType<typeof useSessions.getState>, 'fg' | 'sessions'>): boolean =>
    !!s.fg && !!s.sessions[s.fg] && hasModule(mod, s.sessions[s.fg]);
