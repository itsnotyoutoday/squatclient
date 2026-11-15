import { create } from 'zustand';
import type { CmcpUI, CmcpPane } from './types';
import type { EngineAPI } from '../api/types';
import type { GfxEventOut, GfxOp } from '../gfx/types';
import { place } from './layout';
import { draw, type Ctx, type Prim, type Target } from './widgets';
import { diffOps, isPaneScene, paneScene, paneSceneOp } from './ops';

/** What the window needs to host one pane: where it goes and how it looks (the game's dock, size and resizable are hints). */
export interface PaneInfo {
  key: string; type: string; surface: string; title: string; scene: string;
  dock: string; resizable: boolean; w: number; h: number; readonly: boolean; ready: boolean;
}
interface PaneStore { by: Record<string, PaneInfo[]>; set(session: string, panes: PaneInfo[]): void }
/** The panes of each session (CMCP 2 panel, dock, float contexts), for the window's pane hosts. */
export const usePaneHost = create<PaneStore>((set) => ({
  by: {},
  set: (session, panes) => set((s) => (JSON.stringify(s.by[session]) === JSON.stringify(panes) ? s : { by: { ...s.by, [session]: panes } })),
}));

interface PaneDraw { prev: Map<string, Prim>; targets: Map<string, Target>; key: string; open: boolean; local: Map<string, unknown>; history: Map<string, number[]> }

/** Draws the panes of a CMCP 2 session: each context the game wants on a panel, dock or float is its own scene, drawn like the main screen's
 * widgets (no text port: the main text pane is never drawn twice). The window's pane host places the scene; what a button does goes to the engine
 * as an event of THAT pane. */
export class PaneRenderer {
  private by = new Map<string, Map<string, PaneDraw>>(); // session -> pane key -> drawing state
  onError?: (text: string) => void;
  reduceMotion = false;
  constructor(private engine: EngineAPI, private apply: (session: string, ops: GfxOp[]) => void) {}

  private sizeOf(p: CmcpPane): { w: number; h: number } {
    const sz = p.size ?? {};
    return { w: Math.max(160, Number(sz.w) || 320), h: Math.max(120, Number(sz.h) || 420) };
  }

  /** Brings the drawn panes in line with the model: new ones drawn, changed ones updated, ones that left the stack taken away. */
  sync(ui: CmcpUI): void {
    const panes = ui.panes ?? [];
    let cur = this.by.get(ui.session);
    if (!cur) { cur = new Map(); this.by.set(ui.session, cur); }
    const live = new Set<string>();
    const infos: PaneInfo[] = [];
    for (const p of panes) {
      live.add(p.key);
      const scene = paneScene(p.key);
      const { w, h } = this.sizeOf(p);
      infos.push({ key: p.key, type: p.type, surface: p.surface, title: p.title || p.name || p.id || p.type, scene, dock: p.dock || 'right', resizable: !!p.resizable, w, h, readonly: !!p.readonly, ready: !!p.tree });
      if (!p.tree) continue; // its layout is still coming (pack download): the host shows the title only
      let st = cur.get(p.key);
      if (!st) { st = { prev: new Map(), targets: new Map(), key: '', open: false, local: new Map(), history: new Map() }; cur.set(p.key, st); }
      const key = `${p.tree.screen}|${p.tree.packKey}|${p.tree.generation}`;
      const ops: GfxOp[] = [];
      if (key !== st.key) { // another layout, pack or theme: start from a clean scene
        if (st.open) ops.push({ op: 'clear', scene });
        st.prev = new Map(); st.targets = new Map(); st.key = key; st.local.clear();
      }
      const bg = typeof p.tree.tokens['color.bg'] === 'string' ? (p.tree.tokens['color.bg'] as string) : '#000000';
      const ctx: Ctx = { tree: p.tree, local: st.local, history: st.history, images: new Map(), readonly: !!p.readonly, reduceMotion: this.reduceMotion, overlays: [], viewImages: new Map() };
      const prims = draw(place(p.tree.root!, { x: 0, y: 0, w, h }), ctx);
      const d = diffOps(st.prev, prims, undefined, scene);
      st.prev = d.map;
      st.targets = new Map(prims.filter((q) => q.target).map((q) => [q.id, q.target!]));
      if (!st.open) { ops.push(paneSceneOp(scene, w, h, bg)); st.open = true; }
      this.apply(ui.session, [...ops, ...d.ops]);
    }
    for (const [k, st] of [...cur]) { // a context that left the stack: its scene goes
      if (live.has(k)) continue;
      if (st.open) this.apply(ui.session, [{ op: 'clear', scene: paneScene(k) }, { op: 'scene', scene: paneScene(k), open: false }]);
      cur.delete(k);
    }
    usePaneHost.getState().set(ui.session, infos);
  }

  /** Forgets a session's panes (it ended). */
  drop(session: string): void {
    for (const [k, st] of this.by.get(session) ?? []) if (st.open) this.apply(session, [{ op: 'clear', scene: paneScene(k) }, { op: 'scene', scene: paneScene(k), open: false }]);
    this.by.delete(session);
    usePaneHost.getState().set(session, []);
  }

  /** A pointer event from a pane's scene: a click on a button sends that widget's event to the engine. Returns true when the scene is a pane's. */
  handle(session: string, e: GfxEventOut): boolean {
    if (!isPaneScene(e.scene)) return false;
    const key = e.scene.slice('cmcp.pane.'.length);
    const st = this.by.get(session)?.get(key);
    const tg = st?.targets.get(e.id);
    if (!st || !tg || e.event === 'enter' || e.event === 'leave' || e.event === 'drag') return true;
    const val = typeof tg.value === 'function' ? (tg.value as (x: number, y: number) => unknown)(e.x, e.y) : tg.value;
    if (tg.local) {
      const lv = typeof tg.local.value === 'function' ? (tg.local.value as (x: number, y: number) => unknown)(e.x, e.y) : tg.local.value;
      if (lv === null) st.local.delete(tg.local.key); else st.local.set(tg.local.key, lv);
    }
    if (!tg.event) return true;
    void this.engine.cmcpPaneEvent(session, key, tg.path, tg.event, val).then((r) => { for (const er of r.errors ?? []) this.onError?.(er); }).catch((err: unknown) => this.onError?.(String(err)));
    return true;
  }
}
