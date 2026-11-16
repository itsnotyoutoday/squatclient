import { create } from 'zustand';

/** How far a client may go in drawing a game's screens (CMCP levels, the user's decision): 3 the full themed console, 2 ordinary widgets
 * (buttons, tables, panes: what a client without WebGL can show), 1 the game text alone. The SERVER says the most a context may use; the
 * player may cap LOWER with the chip in the status bar, never higher. What is drawn is the lower of the two. */
export type CmcpLevel = 'scene' | 'widgets' | 'text';

export const LEVEL_NUMBER: Record<CmcpLevel, number> = { text: 1, widgets: 2, scene: 3 };
export const LEVELS: { id: CmcpLevel; n: number; label: string; hint: string }[] = [
  { id: 'scene', n: 3, label: '3 Full console', hint: 'The themed console screen' },
  { id: 'widgets', n: 2, label: '2 Widgets', hint: 'Ordinary buttons, tables and panes: what a client without WebGL can show' },
  { id: 'text', n: 1, label: '1 Text only', hint: 'No screen at all: the game as a plain telnet client sees it' },
];

/** The most this client may draw when the game allows `server` and the player capped at `cap`. */
export const effectiveLevel = (server: number, cap: CmcpLevel): number => Math.min(server || 3, LEVEL_NUMBER[cap]);

interface LevelStore {
  by: Record<string, CmcpLevel>;
  set(session: string, level: CmcpLevel): void;
}
export const useCmcpLevel = create<LevelStore>((set) => ({
  by: {},
  set: (session, level) => set((s) => (s.by[session] === level ? s : { by: { ...s.by, [session]: level } })),
}));

/** The player's cap for a session (the chip); `scene` (no cap) until they choose. */
export const capOf = (session: string): CmcpLevel => useCmcpLevel.getState().by[session] ?? 'scene';
