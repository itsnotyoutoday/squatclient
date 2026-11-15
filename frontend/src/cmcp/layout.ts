import type { CmcpLayout, CmcpNode } from './types';

/** Layout in abstract units (spec 6.3): 1 unit = 1 CSS px at a 1200-unit-wide base layout scaled to the window. */
export interface Rect { x: number; y: number; w: number; h: number }
export interface Placed { node: CmcpNode; rect: Rect; children: Placed[] }

const LEAF_H: Record<string, number> = {
  label: 26, bar: 34, button: 46, toggle: 40, slider: 52, gauge: 120, graph: 70, lights: 20, joystick: 170,
  'bar-list': 120, list: 120, table: 120, radar: 220, scope: 220, schematic: 200, viewscreen: 220, 'contact-picker': 140,
  'team-assigner': 200, 'group-picker': 140, textport: 100,
};
const LEAF_W: Record<string, number> = { button: 150, toggle: 150, joystick: 170, gauge: 120 };

const isRow = (l: CmcpLayout): boolean => l.dir === 'row';

/** Natural extent of a node along an axis when it has neither `size` nor `weight`. */
export function intrinsic(n: CmcpNode, axis: 'w' | 'h'): number {
  const l = n.layout;
  const kids = n.children ?? [];
  if (kids.length === 0) return axis === 'h' ? LEAF_H[n.widget] ?? 30 : LEAF_W[n.widget] ?? 100;
  const pad = (l.pad ?? 0) * 2, gap = l.gap ?? 0;
  const dir = l.dir || 'col';
  if (dir === 'stack') return Math.max(...kids.map((c) => intrinsic(c, axis))) + pad;
  const main = (dir === 'row') === (axis === 'w');
  const sizes = kids.map((c) => (c.layout.hasSize && c.layout.size ? c.layout.size : intrinsic(c, axis)));
  if (dir === 'grid') {
    const cols = Math.max(1, l.cols ?? kids.length), rows = Math.ceil(kids.length / cols);
    const per = axis === 'w' ? cols : rows;
    return Math.max(...kids.map((c) => intrinsic(c, axis))) * per + gap * (per - 1) + pad;
  }
  return main ? sizes.reduce((a, b) => a + b, 0) + gap * (kids.length - 1) + pad : Math.max(...sizes) + pad;
}

/** Places a node tree in a rectangle. Children are stretched across the parent's cross axis. */
export function place(n: CmcpNode, rect: Rect): Placed {
  const out: Placed = { node: n, rect, children: [] };
  const kids = n.children ?? [];
  if (kids.length === 0) return out;
  const l = n.layout, pad = l.pad ?? 0, gap = l.gap ?? 0;
  const inner: Rect = { x: rect.x + pad, y: rect.y + pad, w: Math.max(0, rect.w - pad * 2), h: Math.max(0, rect.h - pad * 2) };
  const dir = l.dir || 'col';
  if (dir === 'stack') {
    out.children = kids.map((c) => place(c, inner));
    return out;
  }
  if (dir === 'grid') {
    const cols = Math.max(1, l.cols ?? Math.ceil(Math.sqrt(kids.length)));
    const used = kids.map((c, i) => ({ c, col: c.layout.col ?? i % cols, row: c.layout.row ?? Math.floor(i / cols), cs: c.layout.colspan ?? 1, rs: c.layout.rowspan ?? 1 }));
    const rows = Math.max(l.rows ?? 0, ...used.map((u) => u.row + u.rs));
    const cw = (inner.w - gap * (cols - 1)) / cols, ch = (inner.h - gap * (rows - 1)) / rows;
    out.children = used.map((u) => place(u.c, { x: inner.x + u.col * (cw + gap), y: inner.y + u.row * (ch + gap), w: cw * u.cs + gap * (u.cs - 1), h: ch * u.rs + gap * (u.rs - 1) }));
    return out;
  }
  const horiz = isRow(l);
  const total = horiz ? inner.w : inner.h;
  const axis: 'w' | 'h' = horiz ? 'w' : 'h';
  const fixed = kids.map((c) => (c.layout.hasSize && c.layout.size ? c.layout.size : (c.layout.weight ?? 0) > 0 ? 0 : intrinsic(c, axis)));
  const weights = kids.map((c) => (c.layout.hasSize && c.layout.size ? 0 : c.layout.weight ?? 0));
  const wsum = weights.reduce((a, b) => a + b, 0);
  let free = total - fixed.reduce((a, b) => a + b, 0) - gap * (kids.length - 1);
  let sizes = fixed.slice();
  if (wsum > 0) {
    free = Math.max(0, free);
    sizes = fixed.map((f, i) => f + (weights[i] / wsum) * free);
  } else if (free < 0) {
    const k = Math.max(0, (total - gap * (kids.length - 1))) / Math.max(1, fixed.reduce((a, b) => a + b, 0));
    sizes = fixed.map((f) => f * k); // too small: shrink everything alike (the text pane keeps its own minimum elsewhere)
  }
  let pos = horiz ? inner.x : inner.y;
  out.children = kids.map((c, i) => {
    const r: Rect = horiz ? { x: pos, y: inner.y, w: sizes[i], h: inner.h } : { x: inner.x, y: pos, w: inner.w, h: sizes[i] };
    pos += sizes[i] + gap;
    return place(c, r);
  });
  return out;
}

/** Finds the textport: the one place the real game text shows through (every screen has exactly one, spec 6.2). */
export function findTextport(p: Placed): Placed | null {
  if (p.node.widget === 'textport') return p;
  for (const c of p.children) {
    const f = findTextport(c);
    if (f) return f;
  }
  return null;
}
