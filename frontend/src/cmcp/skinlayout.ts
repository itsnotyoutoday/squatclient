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
export interface SkinLayout { root: Placed; port: Rect4; mode: Mode; tree: CmcpNode; /** the widget column is paged when one readable column cannot hold the screen: the page shown and the pager strip (scene units) */ pages?: { count: number; index: number }; pager?: Rect4; /** the window is too narrow for the side layout's max_cols columns: the stacked layout was used */ narrow?: boolean; /** extra shrink of the whole widget group for very dense screens (1 = none) */ scale: number }

/** Lays a screen out in a skin: the tree's textport is pinned to the skin's big port, every other widget flows in the band around it
 * (or sits where the skin's arrangement for that screen puts it). A screen too dense for the band (stacked) switches to the side
 * layout. Rectangles of the result are in base units (x 4/3 = scene units). */
export type PortDefault = 'compact' | 'balanced' | 'large';

export function layoutSkinned(tree: CmcpNode, skin: Skin, screenName: string, logExpanded: boolean, portDefault: PortDefault = 'balanced', maxPortW = Infinity, preferSide = false, page = 0): SkinLayout | null {
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
  // port.max_cols: the side layout's text pane is as wide as max_cols columns (maxPortW, scene units) whenever the window leaves a widget column
  // beside it; a window too narrow for that many columns uses the stacked layout (the text then has the full width) instead of a pane that wraps the
  // game's 80-column boxes
  const availMax = skin.side.content[0] + skin.side.content[2] - skin.side.port[0] - 16 - 320;
  const narrow = preferSide && Number.isFinite(maxPortW) && maxPortW > availMax;
  // (a screen too dense for the stacked band still uses the side layout in a narrow window: its pane is then narrower than max_cols, flagged `narrow`)
  const dense = (!narrow && preferSide) || (!arranged && intrinsic(withoutPort(tree, tp), 'h') > c[3] * K * 0.8); // some headroom: the estimate is a minimum
  const mode: Mode = dense ? 'side' : 'stack';
  let root = dense ? reflow(tree) : tree;
  // side layout: the text is at most `port.max_cols` columns wide (maxPortW, scene units) and the width it does not need goes to the widget column
  const sp = skin.side.port, sc = skin.side.content;
  const sideW = Number.isFinite(maxPortW) ? Math.min(Math.max(300, maxPortW), Math.max(sp[2], availMax)) : sp[2];
  const sidePort: Rect4 = [sp[0], sp[1], sideW, sp[3]];
  const sideContent: Rect4 = [sp[0] + sideW + 16, sc[1], Math.max(sc[2], sc[0] + sc[2] - (sp[0] + sideW + 16)), sc[3]];
  const port = logExpanded ? skin.port.expanded : dense ? sidePort : stacked;
  const band0 = dense ? sideContent : c;
  // a screen that needs more height than one READABLE column (scale >= MIN_SCALE) has is split into pages of whole panels with a pager,
  // never shrunk to illegible text and never drawn over itself
  let pages: SkinLayout['pages'];
  if (dense && intrinsic(withoutPort(root, tp), 'h') * MIN_SCALE > band0[3] * K) {
    const built = paginate(tree, tp, band0[3] * K, page);
    if (built) { root = built.root; pages = built.pages; }
  }
  const PAGER = 44;
  const band: Rect4 = pages ? [band0[0], band0[1] + PAGER, band0[2], band0[3] - PAGER] : band0;
  const pager: Rect4 | undefined = pages ? [band0[0], band0[1], band0[2], PAGER - 6] : undefined;
  // the hero widgets (viewscreen, radar, scope, sector map, schematic) take the height the column has left over: big, not their minimum
  if (dense) root = stretchHero(root, tp);
  // (a single panel taller than the band still shrinks, never below 55%)
  const need = dense ? intrinsic(withoutPort(root, tp), 'h') : 0;
  const scale = dense ? Math.max(0.55, Math.min(1, (band[3] * K) / Math.max(1, need))) : 1;
  const ov = pages ? new Map<string, { x: number; y: number; w: number; h: number }>() : dense
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
  return { root: place(root, { x: (band[0] * K) / scale, y: (band[1] * K) / scale, w: (band[2] * K) / scale, h: (band[3] * K) / scale }, ov), port, mode, tree: root, scale, pages, pager, narrow };
}

const HERO = new Set(['viewscreen', 'radar', 'scope', 'sector-map', 'schematic']);
const hasHero = (n: CmcpNode): boolean => HERO.has(n.widget) || (n.children ?? []).some(hasHero);
/** hero leaves flex (weight 1, no fixed size) so they fill what the column leaves over */
function stretchHero(n: CmcpNode, tp: string): CmcpNode {
  if (n.path === tp) return n;
  if (!(n.children ?? []).length) return HERO.has(n.widget) && !n.layout.hasSize ? { ...n, layout: { ...n.layout, weight: Math.max(1, n.layout.weight ?? 0) } } : n;
  return { ...n, children: (n.children ?? []).map((c) => stretchHero(c, tp)) };
}

/** the smallest scale at which the widgets' text is still readable */
export const MIN_SCALE = 0.8;

/** Splits a dense screen into pages of whole panels (the sections of its rows) that each fit one readable column; null when it fits one page
 * or has no sections to split. The title label stays on every page; the text port stays where it is. */
function paginate(tree: CmcpNode, tp: string, bandK: number, page: number): { root: CmcpNode; pages: { count: number; index: number } } | null {
  const kids = tree.children ?? [];
  const port = kids.find((k) => k.path === tp);
  if (!port) return null;
  const title = kids[0] && kids[0].widget === 'label' && !(kids[0].children ?? []).length ? kids[0] : null;
  const rest = kids.filter((k) => k !== port && k !== title);
  const sections: CmcpNode[] = [];
  for (const k of rest) {
    const parts = k.layout.dir === 'row' && (k.children ?? []).length > 1 ? (k.children ?? []) : [k];
    for (const p of parts) sections.push(reflow({ ...p, layout: { ...p.layout, weight: 0 } }));
  }
  if (sections.length < 2) return null;
  // the hero widgets come first (the picture is what the player looks at), the other panels keep their order
  sections.splice(0, sections.length, ...sections.filter(hasHero), ...sections.filter((x) => !hasHero(x)));
  const gap = 4, head = (title ? intrinsic(title, 'h') + gap : 0) + 44 * K;
  const cap = Math.max(60, (bandK - head) / MIN_SCALE);
  const groups: CmcpNode[][] = [];
  let cur: CmcpNode[] = [], h = 0;
  for (const sct of sections) {
    const sh = intrinsic(sct, 'h') + gap;
    if (cur.length && h + sh > cap) { groups.push(cur); cur = []; h = 0; }
    cur.push(sct);
    h += sh;
  }
  if (cur.length) groups.push(cur);
  if (groups.length < 2) return null;
  const index = ((page % groups.length) + groups.length) % groups.length;
  return { root: { ...tree, layout: { ...tree.layout, dir: 'col', gap }, children: [...(title ? [title] : []), ...groups[index], port] }, pages: { count: groups.length, index } };
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
