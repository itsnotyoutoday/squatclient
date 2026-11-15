import { create } from 'zustand';

/** How far this client goes when it draws a game's screens. A developer/testing control: the protocol is unchanged, only what the window
 * draws with. `scene` is the full console (WebGL frame, skin, widgets); `widgets` is ordinary page elements (buttons, tables, panes), what a
 * client without WebGL could show; `text` draws no screen at all, so the game is text only, as in a plain telnet client. */
export type CmcpLevel = 'scene' | 'widgets' | 'text';

export const LEVELS: { id: CmcpLevel; label: string; hint: string }[] = [
  { id: 'scene', label: 'Full console', hint: 'The themed console screen (WebGL)' },
  { id: 'widgets', label: 'Widgets', hint: 'Ordinary buttons, tables and panes: what a client without WebGL can show' },
  { id: 'text', label: 'Text only', hint: 'No screen at all: the game as a plain telnet client sees it' },
];

interface LevelStore {
  by: Record<string, CmcpLevel>;
  set(session: string, level: CmcpLevel): void;
}
export const useCmcpLevel = create<LevelStore>((set) => ({
  by: {},
  set: (session, level) => set((s) => (s.by[session] === level ? s : { by: { ...s.by, [session]: level } })),
}));

export const levelOf = (session: string): CmcpLevel => useCmcpLevel.getState().by[session] ?? 'scene';
