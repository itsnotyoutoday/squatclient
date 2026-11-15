import { intrinsic, place, resolveArrange, type Placed } from './layout';
import type { CmcpNode } from './types';
import type { Rect4, Skin } from './skins/types';

/** the widget layout is done in the 1200-unit base and drawn in a group scaled by 4/3 inside the skin's 1600-unit scene */
export const K = 0.75;

/** Lays a screen out in a skin: the tree's textport is pinned to the skin's big port, every other widget flows in the band around it
 * (or sits where the skin's arrangement for that screen puts it). Rectangles of the result are in base units (x 4/3 = scene units). */
/** rows become columns (buttons stay in a row), for the narrow side column */
function reflow(n: CmcpNode): CmcpNode {
  const kids = (n.children ?? []).map(reflow);
  const allButtons = kids.length > 0 && kids.every((c) => c.widget === 'button');
  const dir = n.layout.dir === 'row' && !allButtons ? 'col' : n.layout.dir;
  return { ...n, layout: { ...n.layout, dir, weight: n.layout.dir === 'row' && !allButtons ? 0 : n.layout.weight }, children: kids.length ? kids : n.children };
}

export type Mode = 'stack' | 'side';
export interface SkinLayout { root: Placed; port: Rect4; mode: Mode; tree: CmcpNode; /** extra shrink of the whole widget group for very dense screens (1 = none) */ scale: number }

/** Lays a screen out in a skin: the tree's textport is pinned to the skin's big port, every other widget flows in the band around it
 * (or sits where the skin's arrangement for that screen puts it). A screen too dense for the band (stacked) switches to the side
 * layout. Rectangles of the result are in base units (x 4/3 = scene units). */
export function layoutSkinned(tree: CmcpNode, skin: Skin, screenName: string, logExpanded: boolean): SkinLayout | null {
  const find = (n: CmcpNode): string | null => { if (n.widget === 'textport') return n.path; for (const c of n.children ?? []) { const f = find(c); if (f) return f; } return null; };
  const tp = find(tree);
  if (!tp) return null;
  const arranged = skin.arrange[screenName] !== undefined;
  const c = skin.content;
  const dense = !arranged && intrinsic(withoutPort(tree, tp), 'h') > c[3] * K * 1.02;
  const mode: Mode = dense ? 'side' : 'stack';
  const root = dense ? reflow(tree) : tree;
  const port = logExpanded ? skin.port.expanded : dense ? skin.side.port : skin.port.rect;
  const band = dense ? skin.side.content : c;
  // a screen that still needs more height than the band has is drawn smaller as a whole (never below 55%) rather than overlapping
  const need = dense ? intrinsic(withoutPort(root, tp), 'h') : 0;
  const scale = dense ? Math.max(0.55, Math.min(1, (band[3] * K) / Math.max(1, need))) : 1;
  const ov = dense ? new Map<string, { x: number; y: number; w: number; h: number }>() : resolveArrange(root, skin.arrange[screenName], K);
  ov.set(tp, { x: (port[0] * K) / scale, y: (port[1] * K) / scale, w: (port[2] * K) / scale, h: (port[3] * K) / scale });
  return { root: place(root, { x: (band[0] * K) / scale, y: (band[1] * K) / scale, w: (band[2] * K) / scale, h: (band[3] * K) / scale }, ov), port, mode, tree: root, scale };
}

/** the tree without its textport (its fixed size must not count against the band) */
function withoutPort(n: CmcpNode, tp: string): CmcpNode {
  return { ...n, children: (n.children ?? []).filter((c) => c.path !== tp).map((c) => withoutPort(c, tp)) };
}
