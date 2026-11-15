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
