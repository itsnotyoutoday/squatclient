import type { CmcpUI } from './types';
import type { Prim } from './widgets';
import type { Colour, Pal, Role, Shape, Skin, TextMap } from './skins/types';

/** Text must fit the shape it sits in. The width of a string at a size is measured with the real font where a canvas exists (the app), else
 * estimated; a text too wide for its box shrinks (down to FIT_FLOOR of its size) and, when that is not enough, ends with an ellipsis. */
export const FIT_FLOOR = 0.55;
let mctx: CanvasRenderingContext2D | null | undefined;
export function measureText(text: string, size: number, font = 'sans-serif', weight = '700'): number {
  if (mctx === undefined) {
    try { mctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null; } catch { mctx = null; }
  }
  if (mctx) {
    mctx.font = `${weight} ${size}px ${font}`;
    const w = mctx.measureText(text).width;
    if (w > 0) return w;
  }
  return text.length * size * 0.55; // a safe estimate for the condensed and the wide faces alike
}
export function fitText(text: string, size: number, maxW: number, font?: string, weight?: string, floor = FIT_FLOOR): { text: string; size: number } {
  if (maxW <= 0 || measureText(text, size, font, weight) <= maxW) return { text, size };
  const s = Math.max(size * floor, (size * maxW) / measureText(text, size, font, weight));
  if (measureText(text, s, font, weight) <= maxW) return { text, size: Math.floor(s * 10) / 10 };
  let t = text;
  while (t.length > 1 && measureText(t + '\u2026', s, font, weight) > maxW) t = t.slice(0, -1);
  return { text: t + '\u2026', size: Math.floor(s * 10) / 10 };
}

type R4 = [number, number, number, number];
const boxOf = (s: Shape): R4 | null => {
  if (s.t === 'rect') return [s.x, s.y, s.w, s.h];
  if (s.t === 'polygon') { const xs = s.points.filter((_, i) => i % 2 === 0), ys = s.points.filter((_, i) => i % 2 === 1); return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; }
  return null;
};
const containers = new WeakMap<Shape[], (R4 | null)[]>();
/** the smallest filled shape a text anchors in: the box its text must fit (cached per frame) */
export function textBoxes(shapes: Shape[]): (R4 | null)[] {
  let c = containers.get(shapes);
  if (c) return c;
  c = shapes.map((t) => {
    if (t.t !== 'text') return null;
    let best: R4 | null = null;
    for (const o of shapes) {
      if (o === t || o.t === 'text' || ('fill' in o && (o.fill === undefined || o.fill === 'none'))) continue;
      const b = boxOf(o);
      if (b && t.x >= b[0] && t.x <= b[0] + b[2] && t.y >= b[1] && t.y <= b[1] + b[3] && (!best || b[2] * b[3] < best[2] * best[3])) best = b;
    }
    return best;
  });
  containers.set(shapes, c);
  return c;
}
/** the width a text may use at its anchor: inside its shape (with a margin), else up to the scene edge */
export function textRoom(t: Extract<Shape, { t: 'text' }>, box: R4 | null): number {
  const m = 16, al = t.align ?? 'left'; // (a slanted or notched plate is narrower than its bounding box at the ends)
  if (box) {
    if (al === 'center') return 2 * Math.min(t.x - box[0], box[0] + box[2] - t.x) - 2 * m;
    if (al === 'right') return t.x - box[0] - m;
    return box[0] + box[2] - t.x - m;
  }
  return al === 'center' ? 2 * Math.min(t.x, 1600 - t.x) - 2 * m : al === 'right' ? t.x - m : 1600 - t.x - m;
}

const ROLES = new Set(['p', 's', 't', 'q', 'x', 'r', 'k', 'bg']);
/** palette role or literal colour */
export const col = (c: Colour | string | undefined, pal: Pal): string => (c === undefined ? '#00000000' : c === 'none' ? '#00000000' : ROLES.has(c) ? pal[c as Role] : c);

/** the lock may be a contact id, a name or an object ({cid, name}) */
const lockText = (v: unknown): string => {
  if (!v) return '0';
  if (typeof v === 'object') { const o = v as { name?: unknown; cid?: unknown; id?: unknown }; return String(o.name ?? o.cid ?? o.id ?? '0'); }
  return String(v);
};

/** values for the skin's text templates, from the protocol (Space.Ship.Status, the ship and the console) */
export function templateVars(ui: CmcpUI, modeLabel: string): Record<string, string> {
  // the "No ship" sentinel (ship id none) is the absence of a ship: it never becomes a ship name
  if (ui.ship?.id === 'none') ui = { ...ui, ship: undefined };
  const st = (ui.status ?? ui.docs?.['Space.Ship.Status'] ?? {}) as Record<string, unknown>; // the pushed model carries `status`, a pulled one `docs`
  const hull = (st.hull ?? {}) as { cur?: number; max?: number };
  const pct = hull.max ? Math.round(((hull.cur ?? 0) / hull.max) * 100) : 0;
  const alert = String(st.alert ?? ui.alert ?? 'green');
  return {
    // the ship now: the console's own ship, then the live status, then the welcome's (which names the ship at login: "No ship" when none)
    ship: (ui.ship?.name || String(st.name ?? '') || (ui.welcome?.ship && ui.welcome.ship.id !== 'none' && ui.welcome.ship.name !== 'No ship' ? ui.welcome.ship.name : '') || ui.ship?.class || ui.ship?.id || 'UNNAMED SHIP').toUpperCase(),
    class: (ui.ship?.class || String(st.class ?? '') || (ui.welcome?.ship && ui.welcome.ship.id !== 'none' ? ui.welcome.ship.class : '') || '').toUpperCase(),
    // the game's own name only: the server software's name (server.server) is never shown
    game: (ui.server?.game ?? '').toUpperCase(),
    mode: modeLabel.toUpperCase(),
    title: (ui.console?.name ?? ui.title ?? '').toUpperCase(),
    hull: String(pct),
    core: String(Math.round(Number(st.core_pct ?? 0))),
    lock: lockText(st.lock),
    alert: alert === 'green' ? 'OFF' : alert.toUpperCase(),
  };
}
/** {name} and {name|fmt}: fmt is upper, lower, %d or %.Nf */
const fmtVar = (val: string, f: string | undefined): string => {
  if (!f) return val;
  if (f === 'upper') return val.toUpperCase();
  if (f === 'lower') return val.toLowerCase();
  const n = Number(val);
  if (f === '%d') return Number.isFinite(n) ? String(Math.round(n)) : val;
  const m = /^%\.(\d)f$/.exec(f);
  return m && Number.isFinite(n) ? n.toFixed(Number(m[1])) : val;
};
const fill = (s: string, v: Record<string, string>): string => s.replace(/\{(\w+)(?:\|([^}]*))?\}/g, (_m, k: string, f?: string) => fmtVar(v[k] ?? '', f));
const MODE_ALIAS: Record<string, string> = { operations: 'ops', engineering: 'power', helm: 'sensors' };
/** a pack's `text: {by, map, default}`: the entry for this screen (vars.screen is its short name), else the default */
const pick = (t: string | TextMap, v: Record<string, string>): string => {
  if (typeof t === 'string') return t;
  const key = (v[t.by === 'mode' ? 'screen' : t.by] ?? '').toLowerCase();
  return t.map[key] ?? t.map[MODE_ALIAS[key] ?? ''] ?? t.default ?? '';
};

/** The skin's static decoration as scene primitives (back to front). Every shape's colours are palette roles, so a palette swap recolours it. */
export function frameShapes(shapes: Shape[], pal: Pal, vars: Record<string, string>, idp: string, font?: string): Prim[] {
  const boxes = textBoxes(shapes);
  return shapes.map((s, i): Prim => {
    const id = `${idp}${s.id ?? i}`;
    const base: Record<string, unknown> = {};
    if (s.glow !== undefined) base.glow = s.glow;
    if (s.opacity !== undefined) base.opacity = s.opacity;
    switch (s.t) {
      case 'rect': return { id, type: 'rect', props: { ...base, x: s.x, y: s.y, w: s.w, h: s.h, r: s.r ?? 0, fill: col(s.fill, pal), stroke: s.stroke ? col(s.stroke, pal) : undefined, strokeWidth: s.sw } };
      case 'elbow': return { id, type: 'elbow', props: { ...base, x: s.x, y: s.y, w: s.w, h: s.h, corner: s.corner, ro: s.ro, ri: s.ri, bar: s.bar, side: s.side, fill: col(s.fill, pal) } };
      case 'polygon': return { id, type: 'polygon', props: { ...base, points: s.points, fill: col(s.fill, pal), stroke: s.stroke ? col(s.stroke, pal) : undefined, strokeWidth: s.sw } };
      case 'polyline': return { id, type: 'polyline', props: { ...base, points: s.points, stroke: col(s.stroke, pal), strokeWidth: s.sw ?? 2 } };
      case 'path': return { id, type: 'path', props: { ...base, d: s.d, stroke: col(s.stroke, pal), strokeWidth: s.sw ?? 2, fill: s.fill ? col(s.fill, pal) : '#00000000' } };
      case 'circle': return { id, type: 'circle', props: { ...base, x: s.x, y: s.y, r: s.r, fill: col(s.fill, pal), stroke: s.stroke ? col(s.stroke, pal) : undefined, strokeWidth: s.sw } };
      case 'arc': return { id, type: 'arc', props: { ...base, x: s.x, y: s.y, r0: s.r0, r1: s.r1, a0: s.a0, a1: s.a1, fill: col(s.fill, pal) } };
      case 'line': return { id, type: 'line', props: { ...base, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, stroke: col(s.stroke, pal), strokeWidth: s.sw ?? 2 } };
      case 'text': { const ft = fitText(vars.room ? fill(pick(s.text, vars), vars).replace(/\bCONSOLE\b/gi, 'ROOM') : fill(pick(s.text, vars), vars), s.size, textRoom(s, boxes[i]), font, s.weight ?? '700'); return { id, type: 'text', props: { ...base, x: s.x, y: s.y, text: ft.text, size: ft.size, fill: col(s.fill ?? 'k', pal), align: s.align ?? 'left', baseline: 'middle', weight: s.weight ?? '700' } }; }
    }
  });
}

/** the nav column: decoration only (the game decides the console); the current screen's item carries the marker */
export function navShapes(skin: Skin, pal: Pal, current: number, idp: string, avail?: (screen: string) => { available: boolean; hint?: string }): Prim[] {
  const b = skin.nav.button, out: Prim[] = [];
  // only the screens this console can show are listed; the nav slots close up (the full list is behind the menu's "more")
  const shown = skin.nav.items.map((it, i) => ({ it, i })).filter(({ it }) => !avail || it.screens.some((sc) => avail(`std.${sc}`).available));
  const curShown = shown.findIndex(({ i }) => i === current);
  shown.forEach(({ it, i: orig }, i) => {
    const nf = fitText(it.label, b.size * (skin.font.tscale ?? 1), b.w - 2 * (b.padX ?? 16) - Math.abs(b.skewX ?? 0), skin.font.family, skin.font.weight);
    out.push({
      id: `${idp}nav${i}`, type: 'button', events: ['click'], target: { path: '', event: '', special: 'nav', screen: `std.${it.screens.find((sc) => !avail || avail(`std.${sc}`).available) ?? it.screens[0]}` },
      props: { x: b.x + i * (b.dx ?? 0), y: b.y + i * (b.dy ?? 0), w: b.w, h: b.h, r: b.r ?? b.h / 2, fill: col(it.role, pal), text: nf.text, color: col(b.color, pal), size: nf.size, weight: skin.font.weight,
        align: b.align ?? 'center', padX: b.padX ?? 16, font: skin.font.family, glow: 0.04, key: `alt+${i + 1}`, skewX: b.skewX ?? 0, stroke: b.stroke ? col(b.stroke, pal) : undefined, strokeWidth: b.sw, opacity: orig === current ? 1 : 0.85 },
    });
  });
  const m = skin.nav.marker;
  if (m && curShown >= 0) out.push({ id: `${idp}marker`, type: 'rect', props: { x: m.x, y: m.y + curShown * (b.dy ?? 0), w: m.w, h: m.h, fill: col(m.fill, pal), glow: m.glow } });
  return out;
}

/** CMCP 2: the nav column shows the layouts the active context allows (the screen menu of 20.5), not a row of console tabs. A console is a
 * context with a layout; switching here is only a local view among the layouts the game allows for it. The skin supplies the slots and the roles. */
export interface NavEntry { id: string; title: string; available: boolean; active: boolean }
export function navShapesV2(skin: Skin, pal: Pal, entries: NavEntry[], idp: string): Prim[] {
  const b = skin.nav.button, out: Prim[] = [];
  const shown = entries.filter((e) => e.available).slice(0, 8);
  shown.forEach((e, i) => {
    const role = skin.nav.items[i % Math.max(1, skin.nav.items.length)]?.role ?? 'p';
    const nf = fitText((e.title || e.id).toUpperCase(), b.size * (skin.font.tscale ?? 1), b.w - 2 * (b.padX ?? 16) - Math.abs(b.skewX ?? 0), skin.font.family, skin.font.weight);
    out.push({
      id: `${idp}nav${i}`, type: 'button', events: ['click'], target: { path: '', event: '', special: 'nav', screen: e.id },
      props: { x: b.x + i * (b.dx ?? 0), y: b.y + i * (b.dy ?? 0), w: b.w, h: b.h, r: b.r ?? b.h / 2, fill: col(role, pal), text: nf.text, color: col(b.color, pal), size: nf.size, weight: skin.font.weight,
        align: b.align ?? 'center', padX: b.padX ?? 16, font: skin.font.family, glow: 0.04, key: `alt+${i + 1}`, skewX: b.skewX ?? 0, stroke: b.stroke ? col(b.stroke, pal) : undefined, strokeWidth: b.sw, opacity: e.active ? 1 : 0.8 },
    });
  });
  const m = skin.nav.marker, cur = shown.findIndex((e) => e.active);
  if (m && cur >= 0) out.push({ id: `${idp}marker`, type: 'rect', props: { x: m.x, y: m.y + cur * (b.dy ?? 0), w: m.w, h: m.h, fill: col(m.fill, pal), glow: m.glow } });
  return out;
}

/** Where the notice pill goes: centred at the top edge unless that covers one of the frame's texts (a title that starts near the top), then the
 * right end, then the left end, then wherever it overlaps least. Returns the pill's left edge (scene units). `texts` are the frame's text prims. */
export function noticeX(texts: { x: number; y: number; text: string; size: number; align?: string; weight?: string }[], w: number, h: number, font?: string): number {
  const boxes = texts.filter((t) => t.text).map((t) => {
    const tw = measureText(t.text, t.size, font, t.weight ?? '700');
    const x0 = t.align === 'center' ? t.x - tw / 2 : t.align === 'right' ? t.x - tw : t.x;
    return [x0, t.y - t.size * 0.4, tw, t.size * 0.8] as [number, number, number, number];
  });
  const clash = (x: number): number => boxes.reduce((n, b) => n + (x < b[0] + b[2] && x + w > b[0] && 2 < b[1] + b[3] && 2 + h > b[1] ? 1 : 0), 0);
  const cands = [800 - w / 2, 1580 - w, 20, 400, 1000];
  return cands.reduce((best, x) => (clash(x) < clash(best) ? x : best), cands.find((x) => clash(x) === 0) ?? cands[0]);
}
