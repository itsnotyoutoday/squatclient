import { create } from 'zustand';
import type { CmcpController } from './controller';

/** Per session: whether a CMCP screen exists and whether the player switched it off (data keeps streaming). The pane shows a small
 * "console" button over the text when it is off, so the screen can be brought back. */
interface PaneState {
  by: Record<string, { has: boolean; off: boolean }>;
  set(session: string, has: boolean, off: boolean): void;
}
export const usePane = create<PaneState>((set) => ({
  by: {},
  set: (session, has, off) => set((s) => (s.by[session]?.has === has && s.by[session]?.off === off ? s : { by: { ...s.by, [session]: { has, off } } })),
}));

let active: CmcpController | null = null;
export const setActiveCmcp = (c: CmcpController | null): void => { active = c; };
export const getActiveCmcp = (): CmcpController | null => active;

/** The popover behind the menu's "more...": every screen and which console provides it. */
interface HelpState { rows: { id: string; title: string; available: boolean; console: string }[] | null; show(rows: NonNullable<HelpState['rows']>): void; close(): void }
export const useScreenHelp = create<HelpState>((set) => ({ rows: null, show: (rows) => set({ rows }), close: () => set({ rows: null }) }));

/** The console theme in use (Settings shows it with where it came from). */
interface ThemeInUse { theme: string; source: string; version: string; set(theme: string, source: string, version: string): void }
export const useThemeInUse = create<ThemeInUse>((set, get) => ({
  theme: '', source: '', version: '',
  set: (theme, source, version) => { const g = get(); if (g.theme !== theme || g.source !== source || g.version !== version) set({ theme, source, version }); },
}));

/** The ship-wide alert ambience per session (6.17.1), for the plain text UI: when no CMCP screen is up (a room, the dock) the app draws only
 * the edge and a soft glow around the window, never over the text or the input line. */
interface AmbientState { by: Record<string, { edge: string; hueBg?: string } | undefined>; set(session: string, a: { edge: string; hueBg?: string } | undefined): void }
export const useAmbient = create<AmbientState>((set) => ({
  by: {},
  set: (session, a) => set((st) => (JSON.stringify(st.by[session]) === JSON.stringify(a) ? st : { by: { ...st.by, [session]: a } })),
}));

/** The hit shake for a session that has no CMCP screen up (a ship room with room screens off, or the client capped below the scene): the
 * game output itself is nudged, so a hit is felt wherever the player is aboard. Zero when nothing is shaking. */
interface ShakeState { by: Record<string, { x: number; y: number } | undefined>; set(session: string, s: { x: number; y: number } | undefined): void }
export const useShake = create<ShakeState>((set) => ({
  by: {},
  set: (session, v) => set((st) => (st.by[session]?.x === v?.x && st.by[session]?.y === v?.y ? st : { by: { ...st.by, [session]: v } })),
}));
