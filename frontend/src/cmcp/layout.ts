import type { CmcpLayout, CmcpNode } from './types';

/** Layout in abstract units (spec 6.3): 1 unit = 1 CSS px at a 1200-unit-wide base layout scaled to the window. */
export interface Rect { x: number; y: number; w: number; h: number }
export interface Placed { node: CmcpNode; rect: Rect; children: Placed[] }

const LEAF_H: Record<string, number> = {
  label: 26, bar: 34, button: 46, toggle: 40, slider: 52, gauge: 120, graph: 70, lights: 20, joystick: 170, 'helm-controls': 210,
  'bar-list': 120, list: 120, table: 120, radar: 220, scope: 220, schematic: 200, viewscreen: 220, 'contact-picker': 140,
  'team-assigner': 200, 'sector-map': 280, portrait: 180, log: 120, 'pad-diagram': 220, 'group-picker': 140, textport: 100,
};
const LEAF_W: Record<string, number> = { button: 150, toggle: 150, joystick: 170, 'helm-controls': 210, gauge: 120 };

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
export function place(n: CmcpNode, rect: Rect, ov?: Map<string, Rect>): Placed {
  const out: Placed = { node: n, rect, children: [] };
  const all = n.children ?? [];
  if (all.length === 0) return out;
  // children a skin pinned to a rectangle leave the flow; the rest share what is left
  const pinned = all.filter((c) => ov?.has(c.path));
  const kids = pinned.length ? all.filter((c) => !ov!.has(c.path)) : all;
  const pin = (): void => {
    for (const c of pinned) out.children.push(place(c, ov!.get(c.path)!, ov));
  };
  if (kids.length === 0) { pin(); return out; }
  const l = n.layout, pad = l.pad ?? 0, gap = l.gap ?? 0;
  const inner: Rect = { x: rect.x + pad, y: rect.y + pad, w: Math.max(0, rect.w - pad * 2), h: Math.max(0, rect.h - pad * 2) };
  const dir = l.dir || 'col';
  if (dir === 'stack') {
    out.children = kids.map((c) => place(c, inner, ov));
    pin();
    return out;
  }
  if (dir === 'grid') {
    const cols = Math.max(1, l.cols ?? Math.ceil(Math.sqrt(kids.length)));
    const used = kids.map((c, i) => ({ c, col: c.layout.col ?? i % cols, row: c.layout.row ?? Math.floor(i / cols), cs: c.layout.colspan ?? 1, rs: c.layout.rowspan ?? 1 }));
    const rows = Math.max(l.rows ?? 0, ...used.map((u) => u.row + u.rs));
    const cw = (inner.w - gap * (cols - 1)) / cols, ch = (inner.h - gap * (rows - 1)) / rows;
    out.children = used.map((u) => place(u.c, { x: inner.x + u.col * (cw + gap), y: inner.y + u.row * (ch + gap), w: cw * u.cs + gap * (u.cs - 1), h: ch * u.rs + gap * (u.rs - 1) }, ov));
    pin();
    return out;
  }
  const horiz = isRow(l);
  const total = horiz ? inner.w : inner.h;
  const axis: 'w' | 'h' = horiz ? 'w' : 'h';
  const fixed = kids.map((c) => (c.layout.hasSize && c.layout.size ? c.layout.size : (c.layout.weight ?? 0) > 0 ? 0 : intrinsic(c, axis)));
  const weights = kids.map((c) => (c.layout.hasSize && c.layout.size ? 0 : c.layout.weight ?? 0));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const fsum = fixed.reduce((a, b) => a + b, 0), gaps = gap * (kids.length - 1);
  let sizes = fixed.slice();
  if (fsum + gaps > total + 0.5) { // not enough room for even the natural sizes: shrink them alike, never overlap
    const k = Math.max(0, total - gaps) / Math.max(1, fsum);
    sizes = fixed.map((f) => f * k);
  } else if (wsum > 0) {
    const free = Math.max(0, total - fsum - gaps);
    sizes = fixed.map((f, i) => f + (weights[i] / wsum) * free);
  }
  let pos = horiz ? inner.x : inner.y;
  out.children = kids.map((c, i) => {
    const r: Rect = horiz ? { x: pos, y: inner.y, w: sizes[i], h: inner.h } : { x: inner.x, y: pos, w: inner.w, h: sizes[i] };
    pos += sizes[i] + gap;
    return place(c, r, ov);
  });
  pin();
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

/** Resolves a skin's arrangement selectors (`widget#n`, `container-of:widget#n`; n counts in document order) to node paths. */
export function resolveArrange(root: CmcpNode, arr: Record<string, [number, number, number, number]> | undefined, k = 1): Map<string, Rect> {
  const out = new Map<string, Rect>();
  if (!arr) return out;
  const seen: Record<string, number> = {};
  const list: { n: CmcpNode; parent: CmcpNode | null; idx: number; kind: string }[] = [];
  const walk = (n: CmcpNode, parent: CmcpNode | null): void => {
    const idx = (seen[n.widget] = (seen[n.widget] ?? -1) + 1);
    list.push({ n, parent, idx, kind: n.widget });
    (n.children ?? []).forEach((c) => walk(c, n));
  };
  walk(root, null);
  for (const [sel, r] of Object.entries(arr)) {
    const m = /^(?:(container-of):)?([\w-]+)#(\d+)$/.exec(sel);
    if (!m) continue;
    const hit = list.find((e) => e.kind === m[2] && e.idx === Number(m[3]));
    const target = m[1] ? hit?.parent : hit?.n;
    if (target) out.set(target.path, { x: r[0] * k, y: r[1] * k, w: r[2] * k, h: r[3] * k });
  }
  return out;
}
