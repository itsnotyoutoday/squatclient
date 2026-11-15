import { create } from 'zustand';
import type { CmcpPane, CmcpTree, CmcpUI } from './types';
import type { CmcpLevel } from './level';

/** What the window draws with page elements (not the scene): the main context when it is not a ship console, and the dock / panel / float panes. */
export interface DomState {
  main: CmcpTree | null;
  title: string;
  readonly: boolean;
  panes: CmcpPane[];
  exits: { name: string; cmd: string }[];
  /** the session speaks CMCP and is ready, and which protocol version (for the status chip) */
  on: boolean;
  proto: number;
}
interface DomStore {
  by: Record<string, DomState>;
  set(session: string, s: DomState): void;
}
export const useCmcpDom = create<DomStore>((set) => ({
  by: {},
  set: (session, s) =>
    set((st) =>
      JSON.stringify(st.by[session]) === JSON.stringify(s) ? st : { by: { ...st.by, [session]: s } },
    ),
}));

/** Whether the window draws this session's screen with page elements instead of the scene. Only when the player capped the client there
 * (the CMCP chip): every screen a game sends is drawn in the scene, as it always was. */
export function drawsAsPage(_ui: CmcpUI, level: CmcpLevel): boolean {
  return level === 'widgets';
}

/** The exits a room context lists in its data (`exits`: names, or {name, cmd}); each becomes a button that sends the command. */
export function exitsOf(ui: CmcpUI): { name: string; cmd: string }[] {
  const raw = ui.ctx?.data?.exits;
  if (!Array.isArray(raw)) return [];
  const out: { name: string; cmd: string }[] = [];
  for (const x of raw) {
    if (typeof x === 'string' && x) out.push({ name: x, cmd: x });
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      const name = String(o.name ?? o.dir ?? o.cmd ?? '');
      if (name) out.push({ name, cmd: String(o.cmd ?? name) });
    }
  }
  return out;
}
