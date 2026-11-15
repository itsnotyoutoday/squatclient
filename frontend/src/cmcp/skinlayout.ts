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
export type PortDefault = 'compact' | 'balanced' | 'large';

export function layoutSkinned(tree: CmcpNode, skin: Skin, screenName: string, logExpanded: boolean, portDefault: PortDefault = 'balanced', maxPortW = Infinity): SkinLayout | null {
  const find = (n: CmcpNode): string | null => { if (n.widget === 'textport') return n.path; for (const c of n.children ?? []) { const f = find(c); if (f) return f; } return null; };
  const tp = find(tree);
  if (!tp) return null;
  // the player's size choice for the default state (stacked): compact = the themes' own small text (182 of 900), balanced = 35%, large = 50% of the height
  const base = skin.port.rect;
  const stackedH = portDefault === 'compact' ? 182 : portDefault === 'large' ? 450 : 315; // owner decision: compact ~20%, balanced ~35%, large ~50% of the height
  const stacked: Rect4 = [base[0], base[1] + base[3] - stackedH, base[2], stackedH];
  const c0 = skin.content;
  const c: Rect4 = [c0[0], c0[1], c0[2], Math.max(96, stacked[1] - 8 - c0[1])];
  const arranged = skin.arrange[screenName] !== undefined && portDefault === 'balanced'; // the arrangements are written for the balanced band
  const dense = !arranged && intrinsic(withoutPort(tree, tp), 'h') > c[3] * K * 0.8; // some headroom: the estimate is a minimum
  const mode: Mode = dense ? 'side' : 'stack';
  const root = dense ? reflow(tree) : tree;
  // side layout: the text is at most `port.max_cols` columns wide (maxPortW, scene units) and the width it does not need goes to the widget column
  const sp = skin.side.port, sc = skin.side.content;
  const sideW = Math.min(sp[2], Math.max(300, maxPortW));
  const sidePort: Rect4 = [sp[0], sp[1], sideW, sp[3]];
  const sideContent: Rect4 = [sp[0] + sideW + 16, sc[1], Math.max(sc[2], sc[0] + sc[2] - (sp[0] + sideW + 16)), sc[3]];
  const port = logExpanded ? skin.port.expanded : dense ? sidePort : stacked;
  const band = dense ? sideContent : c;
  // a screen that still needs more height than the band has is drawn smaller as a whole (never below 55%) rather than overlapping
  const need = dense ? intrinsic(withoutPort(root, tp), 'h') : 0;
  const scale = dense ? Math.max(0.55, Math.min(1, (band[3] * K) / Math.max(1, need))) : 1;
  const ov = dense
    ? resolveArrange(root, skin.sideArrange?.[screenName], K, skin.sideArrange ? skin.sideSlots : undefined)
    : resolveArrange(root, arranged ? skin.arrange[screenName] : undefined, K, arranged && skin.slots && Object.keys(skin.slots).length ? skin.slots : undefined);
  if (dense && scale !== 1) for (const [k, r] of ov) ov.set(k, { x: r.x / scale, y: r.y / scale, w: r.w / scale, h: r.h / scale }); // the group is drawn at `scale`
  // a pack's slots place only what they name; the rest would flow over them. Use them only when they cover every widget of the screen
  // (the others are not carved out yet): otherwise the generic flow lays the screen out.
  if (skin.source === 'pack' && ov.size > 0) {
    const missing = leafWidgets(root).filter((n) => n.path !== tp && n.widget !== 'label' && !ov.has(n.path) && ![...ov.keys()].some((k) => n.path.startsWith(k + '.')));
    if (missing.length > 0) ov.clear();
  }
  ov.set(tp, { x: (port[0] * K) / scale, y: (port[1] * K) / scale, w: (port[2] * K) / scale, h: (port[3] * K) / scale });
  return { root: place(root, { x: (band[0] * K) / scale, y: (band[1] * K) / scale, w: (band[2] * K) / scale, h: (band[3] * K) / scale }, ov), port, mode, tree: root, scale };
}

function leafWidgets(n: CmcpNode, out: CmcpNode[] = []): CmcpNode[] {
  if (!(n.children ?? []).length) out.push(n);
  (n.children ?? []).forEach((c) => leafWidgets(c, out));
  return out;
}

/** the tree without its textport (its fixed size must not count against the band) */
function withoutPort(n: CmcpNode, tp: string): CmcpNode {
  return { ...n, children: (n.children ?? []).filter((c) => c.path !== tp).map((c) => withoutPort(c, tp)) };
}
