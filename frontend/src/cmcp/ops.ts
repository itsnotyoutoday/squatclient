import type { GfxOp } from '../api/types';
import type { Prim } from './widgets';

/** The scene the CMCP screen is drawn in (one per session; the runtime is per session already). */
export const SCENE = 'cmcp';
export const PORT_ID = 'cmcp.port';

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Turns the last frame's primitives and this frame's into the smallest list of scene operations. */
/** Which changed properties glide instead of jumping: returns a duration in seconds, or 0. */
export type Ease = (id: string, prop: string) => number;

export function diffOps(prev: Map<string, Prim>, next: Prim[], ease?: Ease): { ops: GfxOp[]; map: Map<string, Prim> } {
  const ops: GfxOp[] = [];
  const map = new Map<string, Prim>();
  next.forEach((p, z) => {
    const q = { ...p, props: { ...p.props, z } };
    map.set(p.id, q);
    const old = prev.get(p.id);
    const evs = (a?: Prim): string => (a?.events ?? []).join(',');
    if (!old || old.type !== q.type || Object.keys(old.props).some((k) => !(k in q.props))) {
      if (old) ops.push({ op: 'delete', scene: SCENE, id: p.id });
      ops.push({ op: 'create', scene: SCENE, id: p.id, type: q.type, ...(q.parent ? { parent: q.parent } : {}), props: q.props });
      for (const [prop, expr] of Object.entries(q.bind ?? {})) ops.push({ op: 'bind', scene: SCENE, id: p.id, prop, expr });
      if (q.events?.length) ops.push({ op: 'on', scene: SCENE, id: p.id, events: q.events });
      return;
    }
    const ch: Record<string, unknown> = {};
    const glide: Record<string, { to: unknown }> = {};
    let dur = 0;
    for (const [k, v] of Object.entries(q.props)) {
      if (same(old.props[k], v)) continue;
      const d = ease ? ease(p.id, k) : 0;
      if (d > 0 && old.props[k] !== undefined && (typeof v === 'number' || typeof v === 'string')) { glide[k] = { to: v }; dur = Math.max(dur, d); } else ch[k] = v;
    }
    if (Object.keys(ch).length) ops.push({ op: 'set', scene: SCENE, id: p.id, props: ch });
    if (Object.keys(glide).length) ops.push({ op: 'tween', scene: SCENE, target: p.id, tracks: glide, dur, ease: 'inOutSine' });
    if (evs(old) !== evs(q)) ops.push({ op: 'on', scene: SCENE, id: p.id, events: q.events ?? [] });
  });
  for (const id of prev.keys()) if (!map.has(id)) ops.push({ op: 'delete', scene: SCENE, id });
  return { ops, map };
}

/** The scene's own configuration: logical size, background, and the text port (the real game text shows through it). */
export function sceneOp(w: number, h: number, bg: string, bloom: number): GfxOp {
  return { op: 'scene', scene: SCENE, open: true, w, h, bg, dock: 'full', fit: 'contain', margin: [0, 0, 0, 0], portNode: PORT_ID, bloom: { strength: bloom, radius: 0.5 } };
}
