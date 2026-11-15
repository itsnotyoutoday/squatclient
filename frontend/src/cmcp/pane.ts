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
