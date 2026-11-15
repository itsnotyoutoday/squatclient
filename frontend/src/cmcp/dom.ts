import { create } from 'zustand';
import type { CmcpPane, CmcpTree, CmcpUI } from './types';

/** What the window draws with page elements (not the scene): the main context when it is not a ship console, and the dock / panel / float panes. */
export interface DomState {
  main: CmcpTree | null;
  title: string;
  readonly: boolean;
  panes: CmcpPane[];
  exits: { name: string; cmd: string }[];
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

/** CMCP 2: a ship console keeps the scene and its frame (the old console look); every other context, a place such as the concourse or a ship room,
 * is drawn with page elements. */
export function drawsAsPage(ui: CmcpUI): boolean {
  if (!ui.v2 || !ui.ctx) return false;
  return ui.ctx.scope !== 'ship' || ui.ctx.type === 'ship.shiproom' || ui.ctx.type === 'ship.room';
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
