import type { CmcpNode, CmcpStackEntry, CmcpTree } from './types';
import type { Overlay } from './overlays';
import type { Pal, Skin } from './skins/types';
import { findTextport, type Placed, type Rect } from './layout';

/** One graphics object of the scene protocol (docs/GFX.md) plus what a pointer event on it means. */
export interface Prim {
  id: string;
  type: string;
  parent?: string;
  /** property -> binding expression, re-evaluated by the renderer (the radar sweep follows time()) */
  bind?: Record<string, string>;
  props: Record<string, unknown>;
  events?: string[];
  target?: Target;
}
/** A pointer event on a primitive becomes a widget event of the pack (spec 6.9). `value` may depend on where it hit. */
export interface Target {
  path: string;
  event: string;
  value?: unknown | ((x: number, y: number) => unknown);
  /** widget-local state to write instead of/before sending (selection inside a widget) */
  local?: { key: string; value: unknown | ((x: number, y: number) => unknown) };
  /** a control of the skin itself: the LOG toggle or the screen-off button */
  special?: 'log' | 'off' | 'nav' | 'alert';
  /** nav: the screen this item shows */
  screen?: string;
  /** ui key to mirror to the engine (the team picked in a team-assigner is $ui.team) */
  setUi?: { key: string; value: unknown };
}

export interface Ctx {
  tree: CmcpTree;
  local: Map<string, unknown>;
  history: Map<string, number[]>;
  /** sprite pictures by sprite_key (already drawn by sprite.ts), as image names defined in the runtime */
  images: Map<string, { name: string; w: number; h: number; zones: Record<string, { x: number; y: number; w: number; h: number }> }>;
  readonly: boolean;
  reduceMotion: boolean;
  /** DOM inputs the scene cannot draw (typed entry), collected while drawing */
  overlays?: Overlay[];
  /** pictures of contact art by `art|view|amount key` (drawn by the controller from the sprites the engine resolved) */
  viewImages?: Map<string, { name: string; w: number; h: number }>;
  /** the theme's skin and the palette in force (normal or red alert); widgets follow them */
  skin?: Skin;
  pal?: Pal;
}

const tok = (ctx: Ctx, k: string, d = '#888888'): string => {
  const v = ctx.tree.tokens[k];
  return typeof v === 'string' ? v : d;
};
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? '' : String(v));
const radius = (ctx: Ctx): number => num(ctx.tree.tokens.radius, 4);

export function tone(ctx: Ctx, t: unknown): string {
  switch (t) {
    case 'alert': return tok(ctx, 'color.alert');
    case 'warn': return tok(ctx, 'color.warn');
    case 'ok': return tok(ctx, 'color.ok');
    case 'dim': return tok(ctx, 'color.dim');
    case 'accent2': return tok(ctx, 'color.accent2');
    default: return tok(ctx, 'color.accent');
  }
}

/** A sorted [key, row] list from a keyed map (numeric keys numerically) or a list. */
export function entries(v: unknown): [string, unknown][] {
  if (Array.isArray(v)) return v.map((x, i) => [String(i), x]);
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a.localeCompare(b)));
  }
  return [];
}

/** Formats a cell: bearings as az/mark, numbers trimmed, null as a dash. */
export function cell(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.az === 'number') return `${Math.round(o.az)}/${Math.round(num(o.mark))}`;
    return '';
  }
  return String(v);
}

function text(id: string, x: number, y: number, t: string, size: number, fill: string, o: Record<string, unknown> = {}): Prim {
  return { id, type: 'text', props: { x, y, text: t, size, fill, baseline: 'middle', align: 'left', ...o } };
}
function rect(id: string, r: Rect, fill: string, o: Record<string, unknown> = {}): Prim {
  return { id, type: 'rect', props: { x: r.x, y: r.y, w: Math.max(0, r.w), h: Math.max(0, r.h), fill, ...o } };
}
const font = (ctx: Ctx, title = false): string => str(ctx.tree.tokens[title ? 'font.title' : 'font.body']);
const frac = (v: unknown, max: unknown, dmax = 100): number | null => {
  if (typeof v !== 'number') return null;
  const m = typeof max === 'number' && max > 0 ? max : dmax;
  return Math.max(0, Math.min(1, v / m));
};

type Draw = (p: Placed, ctx: Ctx, out: Prim[]) => void;

/** Chamfered outline points of a rectangle (cut corners). */
function chamfer(r: Rect, c: number): number[] {
  return [r.x + c, r.y, r.x + r.w - c, r.y, r.x + r.w, r.y + c, r.x + r.w, r.y + r.h - c, r.x + r.w - c, r.y + r.h, r.x + c, r.y + r.h, r.x, r.y + r.h - c, r.x, r.y + c, r.x + c, r.y];
}

/** The frame of a widget group in the look of the theme (the Lua themes' families: tng LCARS, soft, klingon, romulan, tos, ferengi, ops).
 * Decoration only: it is drawn behind the content and never takes events. Returns the inner content rectangle. */
function panel(p: Placed, ctx: Ctx, out: Prim[], id: string, title?: string): Rect {
  if (ctx.skin) { // the skinned themes draw panels as bare text on black, the title in the panel-title role
    const r0 = p.rect, pt = ctx.skin.widgets.panelTitle;
    if (title) out.push(text(`${id}.t`, r0.x + 4, r0.y + 12, title.toUpperCase(), pt.size * 0.75, ctx.pal![pt.role], { font: font(ctx, true), weight: '700' }));
    return { x: r0.x + 4, y: r0.y + (title ? 26 : 4), w: r0.w - 8, h: r0.h - (title ? 30 : 8) };
  }
  const r = p.rect, th = ctx.tree.theme, acc = tok(ctx, 'color.accent'), pan = tok(ctx, 'color.panel'), dim = tok(ctx, 'color.dim'), a2 = tok(ctx, 'color.accent2');
  const head = (x: number, y: number, col: string, size = 14, o: Record<string, unknown> = {}): void => {
    if (title) out.push(text(`${id}.t`, x, y, title.toUpperCase(), size, col, { font: font(ctx, true), weight: '700', letterSpacing: 1, ...o }));
  };
  let inner: Rect = { x: r.x + 8, y: r.y + (title ? 28 : 8), w: r.w - 16, h: r.h - (title ? 34 : 16) };
  switch (th) {
    case 'klingon': {
      out.push({ id: `${id}.bg`, type: 'polygon', props: { points: chamfer(r, 14).slice(0, -2), fill: pan, opacity: 0.95 } });
      out.push({ id: `${id}.ln`, type: 'polyline', props: { points: chamfer(r, 14), stroke: acc, strokeWidth: 2, glow: 0.25 } });
      out.push({ id: `${id}.spike`, type: 'polygon', props: { points: [r.x + 14, r.y + 24, r.x + 40, r.y + 24, r.x + 14, r.y + 44], fill: acc, opacity: 0.8 } });
      head(r.x + 52, r.y + 14, acc, 15);
      inner = { x: r.x + 12, y: r.y + (title ? 32 : 12), w: r.w - 24, h: r.h - (title ? 38 : 20) };
      break;
    }
    case 'romulan': {
      out.push({ id: `${id}.bg`, type: 'polygon', props: { points: chamfer(r, 8).slice(0, -2), fill: tok(ctx, 'color.bg'), opacity: 0.6 } });
      out.push({ id: `${id}.ln`, type: 'polyline', props: { points: chamfer(r, 8), stroke: acc, strokeWidth: 1, glow: 0.6 } });
      out.push({ id: `${id}.tick`, type: 'line', props: { x1: r.x + 8, y1: r.y + 26, x2: r.x + r.w - 8, y2: r.y + 26, stroke: a2, strokeWidth: 1, opacity: 0.5 } });
      head(r.x + 12, r.y + 14, acc, 13, { letterSpacing: 3 });
      break;
    }
    case 'tos': {
      out.push(rect(`${id}.bg`, r, pan, { r: 10, opacity: 0.9 }));
      out.push(rect(`${id}.band`, { x: r.x, y: r.y, w: r.w, h: 24 }, acc, { r: [10, 10, 0, 0] }));
      head(r.x + 12, r.y + 13, tok(ctx, 'color.bg'), 14);
      inner = { x: r.x + 8, y: r.y + 30, w: r.w - 16, h: r.h - 36 };
      break;
    }
    case 'soft': {
      out.push(rect(`${id}.bg`, r, tok(ctx, 'color.bg'), { r: 8, stroke: dim, strokeWidth: 1, opacity: 0.55 }));
      if (title) {
        head(r.x + 14, r.y + 15, acc, 14, { weight: '600' });
        out.push(rect(`${id}.r1`, { x: r.x + 14, y: r.y + 26, w: Math.min(190, r.w - 28), h: 2 }, acc, { opacity: 0.9 }));
        out.push(rect(`${id}.r2`, { x: r.x + 14, y: r.y + 31, w: Math.min(150, r.w - 28), h: 1.5 }, acc, { opacity: 0.55 }));
      }
      inner = { x: r.x + 12, y: r.y + (title ? 38 : 10), w: r.w - 24, h: r.h - (title ? 44 : 20) };
      break;
    }
    case 'ferengi': {
      out.push(rect(`${id}.bg`, r, pan, { r: 14, stroke: acc, strokeWidth: 2, opacity: 0.95 }));
      out.push(rect(`${id}.in`, { x: r.x + 5, y: r.y + 5, w: r.w - 10, h: r.h - 10 }, '#00000000', { r: 10, stroke: dim, strokeWidth: 1 }));
      for (const [cx, cy] of [[r.x + 10, r.y + 10], [r.x + r.w - 10, r.y + 10], [r.x + 10, r.y + r.h - 10], [r.x + r.w - 10, r.y + r.h - 10]]) out.push({ id: `${id}.o${cx}.${cy}`, type: 'circle', props: { x: cx, y: cy, r: 3, fill: acc, glow: 0.3 } });
      head(r.x + r.w / 2, r.y + 17, acc, 15, { align: 'center' });
      inner = { x: r.x + 12, y: r.y + (title ? 32 : 12), w: r.w - 24, h: r.h - (title ? 40 : 24) };
      break;
    }
    case 'ops': {
      out.push({ id: `${id}.bg`, type: 'polygon', props: { points: chamfer(r, 6).slice(0, -2), fill: pan, opacity: 0.92 } });
      out.push({ id: `${id}.ln`, type: 'polyline', props: { points: chamfer(r, 6), stroke: dim, strokeWidth: 2 } });
      out.push(rect(`${id}.stripe`, { x: r.x + 6, y: r.y, w: r.w - 12, h: 5 }, acc, { glow: 0.3 }));
      head(r.x + 12, r.y + 18, tok(ctx, 'color.text'), 14);
      inner = { x: r.x + 10, y: r.y + (title ? 30 : 12), w: r.w - 20, h: r.h - (title ? 36 : 22) };
      break;
    }
    default: { // tng: LCARS rounded block with an accent elbow cap at the left
      out.push(rect(`${id}.bg`, r, pan, { r: radius(ctx) * 1.5, stroke: dim, strokeWidth: 1, opacity: 0.9 }));
      out.push({ id: `${id}.cap`, type: 'elbow', props: { x: r.x, y: r.y, w: 46, h: 26, corner: 'tl', ro: 14, ri: 5, bar: 8, side: 12, fill: acc } });
      head(r.x + 54, r.y + 14, acc, 14);
      inner = { x: r.x + 8, y: r.y + (title ? 30 : 8), w: r.w - 16, h: r.h - (title ? 36 : 16) };
    }
  }
  return inner;
}

const label: Draw = (p, ctx, out) => {
  const t = str(p.node.props.text);
  if (!t) return;
  const style = str(p.node.props.style);
  const big = style === 'title' || style === 'heading';
  const head = ctx.skin && /^0\.0$/.test(p.node.path); // the screen's title line
  out.push(text(`${p.node.path}.t`, p.rect.x + 4, p.rect.y + p.rect.h / 2, t, head ? 22 : big ? 24 : 18, head && ctx.skin ? ctx.pal![ctx.skin.widgets.head] : style === 'dim' ? tok(ctx, 'color.dim') : big ? tok(ctx, 'color.accent') : tok(ctx, 'color.text'), { font: font(ctx, big), weight: big ? '700' : '500', maxWidth: p.rect.w - 8 }));
};

const bar: Draw = (p, ctx, out) => {
  const id = p.node.path, r = p.rect, pr = p.node.props;
  const f = frac(pr.value, pr.max);
  const lab = str(pr.label);
  const lw = lab ? Math.min(r.w * 0.34, 190) : 0;
  const h = Math.min(r.h, 22), y = r.y + (r.h - h) / 2;
  if (lab) out.push(text(`${id}.l`, r.x + 4, r.y + r.h / 2, lab.toUpperCase(), 14, tok(ctx, 'color.dim'), { font: font(ctx), weight: '600', maxWidth: lw }));
  const tr: Rect = { x: r.x + lw, y, w: r.w - lw, h };
  out.push(rect(`${id}.tr`, tr, tok(ctx, 'color.panel'), { r: radius(ctx) / 2, stroke: tok(ctx, 'color.dim'), strokeWidth: 1 }));
  if (f !== null && f > 0) out.push(rect(`${id}.f`, { ...tr, w: tr.w * f }, tone(ctx, pr.tone), { r: radius(ctx) / 2, glow: 0.15 }));
  const t = pr.text !== undefined && pr.text !== null ? str(pr.text) : typeof pr.value === 'number' ? `${cell(pr.value)}${typeof pr.max === 'number' ? ' / ' + cell(pr.max) : ''}` : '-';
  out.push(text(`${id}.v`, tr.x + tr.w - 6, y + h / 2, t, 13, tok(ctx, 'color.text'), { align: 'right', font: font(ctx), weight: '600' }));
};

/** rows of {cur,max} or {pct} */
const barList: Draw = (p, ctx, out) => {
  const id = p.node.path, pr = p.node.props;
  const inner = panel(p, ctx, out, id, str(pr.label));
  const rows = entries(pr.rows);
  const rh = 26, nameW = Math.min(inner.w * 0.4, 190);
  const tail = rows.some(([, v]) => typeof ((v ?? {}) as Record<string, unknown>).state === 'string') ? 150 : 64;
  rows.slice(0, Math.max(0, Math.floor(inner.h / rh))).forEach(([k, v], i) => {
    const y = inner.y + i * rh, o = (v ?? {}) as Record<string, unknown>;
    const pc = typeof o.pct === 'number' ? o.pct : typeof o.charge_pct === 'number' ? o.charge_pct : undefined;
    const f = pc !== undefined ? Math.max(0, Math.min(1, pc / 100)) : frac(o.cur, o.max);
    out.push(text(`${id}.r${k}.n`, inner.x + 4, y + rh / 2, k.replace(/_/g, ' ').toUpperCase(), 13, tok(ctx, 'color.text'), { font: font(ctx), weight: '600', maxWidth: nameW }));
    const tr: Rect = { x: inner.x + nameW + 6, y: y + 5, w: Math.max(24, inner.w - nameW - tail), h: rh - 10 };
    out.push(rect(`${id}.r${k}.tr`, tr, tok(ctx, 'color.bg'), { r: 2, stroke: tok(ctx, 'color.dim'), strokeWidth: 1 }));
    if (f !== null) out.push(rect(`${id}.r${k}.f`, { ...tr, w: tr.w * f }, f < 0.35 ? tok(ctx, 'color.alert') : f < 0.7 ? tok(ctx, 'color.warn') : tone(ctx, undefined), { r: 2, glow: 0.1 }));
    const val = pc !== undefined ? `${Math.round(pc)}%` : typeof o.cur === 'number' ? `${cell(o.cur)}` : '-';
    const st = typeof o.state === 'string' ? o.state : '';
    out.push(text(`${id}.r${k}.v`, inner.x + inner.w - 4, y + rh / 2, st ? `${val} ${st}` : val, 13, tok(ctx, 'color.dim'), { align: 'right', font: font(ctx) }));
    if (pr.selectable === true && p.node.events?.includes('select')) {
      out.push({ id: `${id}.r${k}.hit`, type: 'rect', props: { x: inner.x, y, w: inner.w, h: rh, fill: '#00000000' }, events: ['click'], target: { path: p.node.path, event: 'select', value: k } });
    }
  });
};

interface Col { key: string; title: string }
function columnsOf(v: unknown): Col[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]).map((c) => ({ key: str(c.key), title: str(c.title ?? c.key) })) : [];
}

/** list / table / contact-picker */
const table: Draw = (p, ctx, out) => {
  const id = p.node.path, pr = p.node.props;
  const picker = p.node.widget === 'contact-picker';
  const inner = panel(p, ctx, out, id, picker ? 'Contacts' : str(pr.label));
  let cols = columnsOf(pr.columns);
  if (picker && cols.length === 0) cols = [{ key: 'cid', title: 'CID' }, { key: 'name', title: 'NAME' }, { key: 'distance_text', title: 'DIST' }];
  if (cols.length === 0) cols = [{ key: 'name', title: 'NAME' }];
  const rows = entries(pr.rows ?? pr.contacts);
  // rows of a keyed map (facings, groups, components) are named by their key: show it unless a column already names the row
  if (!Array.isArray(pr.rows) && !cols.some((c) => c.key === 'name' || c.key === 'cid' || c.key === '_key')) cols = [{ key: '_key', title: '' }, ...cols];
  const rh = 22, cw = inner.w / cols.length;
  cols.forEach((c, i) => out.push(text(`${id}.h${i}`, inner.x + i * cw + 4, inner.y + 10, c.title.toUpperCase(), 12, tok(ctx, 'color.dim'), { font: font(ctx), weight: '700', maxWidth: cw - 6 })));
  const selected = pr.selected === undefined || pr.selected === null ? null : String(pr.selected);
  const selectable = (pr.selectable === true || picker) && p.node.events?.includes('select');
  rows.slice(0, Math.max(0, Math.floor((inner.h - 22) / rh))).forEach(([k, v], i) => {
    const y = inner.y + 22 + i * rh, o = (v ?? {}) as Record<string, unknown>;
    const sel = selected !== null && (selected === k || selected === String(o.cid));
    if (sel) out.push(rect(`${id}.r${k}.sel`, { x: inner.x, y, w: inner.w, h: rh }, tok(ctx, 'color.accent'), { opacity: 0.28, r: 2 }));
    cols.forEach((c, j) => {
      const val = c.key === '_key' ? k : cell(o[c.key]);
      out.push(text(`${id}.r${k}.c${j}`, inner.x + j * cw + 4, y + rh / 2, val, 14, sel ? tok(ctx, 'color.text') : tok(ctx, 'color.text'), { font: font(ctx), maxWidth: cw - 6 }));
    });
    if (selectable) out.push({ id: `${id}.r${k}.hit`, type: 'rect', props: { x: inner.x, y, w: inner.w, h: rh, fill: '#00000000' }, events: ['click'], target: { path: p.node.path, event: 'select', value: typeof o.cid === 'number' ? o.cid : k } });
  });
};

const groupPicker: Draw = (p, ctx, out) => {
  const id = p.node.path, pr = p.node.props;
  const inner = panel(p, ctx, out, id, 'Power groups');
  const rows = entries(pr.groups);
  const rh = 34, selected = pr.selected === undefined || pr.selected === null ? null : String(pr.selected);
  rows.slice(0, Math.max(0, Math.floor(inner.h / rh))).forEach(([k, v], i) => {
    const y = inner.y + i * rh, o = (v ?? {}) as Record<string, unknown>;
    const sel = selected === k;
    out.push(rect(`${id}.g${k}.bg`, { x: inner.x, y: y + 2, w: inner.w, h: rh - 4 }, sel ? tok(ctx, 'color.accent') : tok(ctx, 'color.bg'), { r: radius(ctx), stroke: tok(ctx, 'color.accent'), strokeWidth: 1, opacity: sel ? 0.9 : 1 }));
    out.push(text(`${id}.g${k}.n`, inner.x + 10, y + rh / 2, str(o.name).toUpperCase(), 16, sel ? tok(ctx, 'color.bg') : tok(ctx, 'color.text'), { font: font(ctx, true), weight: '700' }));
    out.push(text(`${id}.g${k}.p`, inner.x + inner.w - 10, y + rh / 2, typeof o.pct === 'number' ? `${Math.round(o.pct)}%` : '-', 16, sel ? tok(ctx, 'color.bg') : tok(ctx, 'color.accent2'), { align: 'right', font: font(ctx) }));
    if (p.node.events?.includes('select')) out.push({ id: `${id}.g${k}.hit`, type: 'rect', props: { x: inner.x, y, w: inner.w, h: rh, fill: '#00000000' }, events: ['click'], target: { path: p.node.path, event: 'select', value: /^\d+$/.test(k) ? Number(k) : k } });
  });
};

/** a pack's mnemonic letter works as Alt+letter in the graphical client (the text pane and input keep every plain key) */
const mnemonic = (k: unknown): string | undefined => (typeof k === 'string' && /^[a-zA-Z0-9]$/.test(k) ? `alt+${k.toLowerCase()}` : undefined);

const button: Draw = (p, ctx, out) => {
  const pr = p.node.props, id = p.node.path;
  const on = p.node.enabled && !ctx.readonly;
  let col = on ? tone(ctx, pr.tone) : tok(ctx, 'color.dim');
  if (ctx.skin && on) { // buttons take the skin's role colours in turn along their row
    const roles = ctx.skin.widgets.button.roles, idx = Number(id.split('.').pop()) || 0;
    col = ctx.pal![pr.tone === 'alert' ? 'r' : roles[idx % roles.length]];
  }
  const r: Rect = { x: p.rect.x + 2, y: p.rect.y + 2, w: p.rect.w - 4, h: Math.min(p.rect.h - 4, ctx.skin ? ctx.skin.widgets.button.h * 0.75 : 52) };
  out.push({
    id: `${id}.b`, type: 'button',
    props: { x: r.x, y: r.y, w: r.w, h: r.h, key: mnemonic(pr.key), text: str(pr.text).toUpperCase() + (pr.key ? `  [${str(pr.key).toUpperCase()}]` : ''), fill: on ? col : tok(ctx, 'color.panel'), color: on ? tok(ctx, 'color.bg') : tok(ctx, 'color.dim'), size: ctx.skin ? 15 : 18, weight: '700', font: font(ctx, true), r: ctx.skin ? (ctx.skin.sharp ? 0 : r.h / 2) : radius(ctx) * 1.5, glow: on ? 0.12 : 0, opacity: on ? 1 : 0.7, align: 'center' },
    events: on ? ['click'] : [], target: on ? { path: p.node.path, event: 'click' } : undefined,
  });
};

const toggle: Draw = (p, ctx, out) => {
  const pr = p.node.props, id = p.node.path;
  const on = pr.value === true, can = p.node.enabled && !ctx.readonly;
  const r = p.rect;
  out.push(rect(`${id}.k`, { x: r.x + 4, y: r.y + r.h / 2 - 11, w: 44, h: 22 }, on ? tone(ctx, 'ok') : tok(ctx, 'color.panel'), { r: 11, stroke: tok(ctx, 'color.dim'), strokeWidth: 1 }));
  out.push({ id: `${id}.n`, type: 'circle', props: { x: r.x + (on ? 37 : 15), y: r.y + r.h / 2, r: 8, fill: tok(ctx, 'color.text') } });
  out.push(text(`${id}.t`, r.x + 58, r.y + r.h / 2, str(pr.text).toUpperCase(), 16, tok(ctx, 'color.text'), { font: font(ctx) }));
  if (can) out.push({ id: `${id}.hit`, type: 'rect', props: { x: r.x, y: r.y, w: r.w, h: r.h, fill: '#00000000' }, events: ['click'], target: { path: p.node.path, event: 'change', value: !on } });
};

const slider: Draw = (p, ctx, out) => {
  const pr = p.node.props, id = p.node.path, r = p.rect;
  const min = num(pr.min, 0), max = num(pr.max, 100), step = num(pr.step, 1) || 1;
  const v = typeof pr.value === 'number' ? pr.value : min;
  const f = max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0;
  const lab = str(pr.label);
  if (lab) out.push(text(`${id}.l`, r.x + 4, r.y + 12, lab.toUpperCase(), 13, tok(ctx, 'color.dim'), { font: font(ctx), weight: '600' }));
  const tr: Rect = { x: r.x + 8, y: r.y + r.h - 20, w: r.w - 70, h: 8 };
  out.push(rect(`${id}.tr`, tr, tok(ctx, 'color.panel'), { r: 4, stroke: tok(ctx, 'color.dim'), strokeWidth: 1 }));
  out.push(rect(`${id}.f`, { ...tr, w: tr.w * f }, tone(ctx, undefined), { r: 4 }));
  out.push({ id: `${id}.k`, type: 'circle', props: { x: tr.x + tr.w * f, y: tr.y + 4, r: 10, fill: tok(ctx, 'color.text'), stroke: tone(ctx, undefined), strokeWidth: 2 } });
  out.push(text(`${id}.v`, r.x + r.w - 6, tr.y + 4, cell(v), 16, tok(ctx, 'color.text'), { align: 'right', font: font(ctx), weight: '700' }));
  if (p.node.enabled && !ctx.readonly) {
    out.push({
      id: `${id}.hit`, type: 'rect', props: { x: tr.x - 8, y: tr.y - 12, w: tr.w + 16, h: 32, fill: '#00000000' }, events: ['click'],
      target: { path: p.node.path, event: 'change', value: (x: number) => { const t = Math.max(0, Math.min(1, (x - tr.x) / tr.w)); return Math.max(min, Math.min(max, Math.round((min + t * (max - min)) / step) * step)); } },
    });
  }
};

const graph: Draw = (p, ctx, out) => {
  const pr = p.node.props, id = p.node.path;
  const hist = ctx.history.get(id) ?? [];
  const inner = panel(p, ctx, out, id, str(pr.label));
  const min = num(pr.min, 0), max = num(pr.max, 100), n = Math.max(2, Math.min(num(pr.samples, 60), 600));
  const vals = hist.slice(-n);
  if (vals.length >= 2) {
    const pts: number[] = [];
    vals.forEach((v, i) => { pts.push(inner.x + (i / (n - 1)) * inner.w, inner.y + inner.h - Math.max(0, Math.min(1, (v - min) / (max - min || 1))) * inner.h); });
    out.push({ id: `${id}.ln`, type: 'polyline', props: { points: pts, stroke: tone(ctx, undefined), strokeWidth: 2, glow: 0.2 } });
  }
  const last = vals[vals.length - 1];
  if (last !== undefined) out.push(text(`${id}.v`, inner.x + inner.w - 2, inner.y + 8, `${Math.round(last)}%`, 14, tok(ctx, 'color.text'), { align: 'right', font: font(ctx) }));
};

const gauge: Draw = (p, ctx, out) => {
  const pr = p.node.props, id = p.node.path, r = p.rect;
  const f = frac(pr.value, pr.max) ?? 0, rad = Math.min(r.w, r.h) / 2 - 6, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  out.push({ id: `${id}.bg`, type: 'arc', props: { x: cx, y: cy, r0: rad - 10, r1: rad, a0: 225, a1: 495, fill: tok(ctx, 'color.panel') } });
  if (f > 0) out.push({ id: `${id}.fg`, type: 'arc', props: { x: cx, y: cy, r0: rad - 10, r1: rad, a0: 225, a1: 225 + 270 * f, fill: tone(ctx, undefined), glow: 0.2 } });
  out.push(text(`${id}.v`, cx, cy, cell(pr.value), 20, tok(ctx, 'color.text'), { align: 'center', font: font(ctx, true) }));
  if (pr.label) out.push(text(`${id}.l`, cx, cy + rad * 0.55, str(pr.label).toUpperCase(), 11, tok(ctx, 'color.dim'), { align: 'center', font: font(ctx) }));
};

/** the contacts of a radar object: id:bearing:range:type;... (range 0..100, type F friendly H hostile N neutral U unknown) */
function radarContacts(pr: Record<string, unknown>): string {
  const cs = entries(pr.contacts);
  const range = num(pr.range_m, 0) || Math.max(1, ...cs.map(([, v]) => num(((v ?? {}) as Record<string, unknown>).distance_m, 0))) * 1.05;
  return cs.map(([k, v]) => {
    const o = (v ?? {}) as Record<string, unknown>, rel = (o.rel ?? o.bearing ?? {}) as Record<string, unknown>;
    const t = o.iff === 'friend' ? 'F' : o.iff === 'hostile' ? 'H' : o.iff === 'neutral' ? 'N' : 'U';
    return `${String(o.cid ?? k).replace(/\D/g, '') || k}:${Math.round(num(rel.az))}:${Math.round(100 * Math.sqrt(num(o.distance_m) / range))}:${t}`;
  }).join(';');
}

/** plot of contacts around the ship: rel az (0 = ahead, clockwise) and distance */
const radar: Draw = (p, ctx, out) => {
  const pr = p.node.props, id = p.node.path;
  if (ctx.skin) { // the dish of the themes: a ring, the sweeping radar object, the sensor array caption
    const sk = ctx.skin.widgets.radar, r0 = p.rect, pal = ctx.pal!;
    const R = Math.max(20, Math.min(r0.w, r0.h - 22) / 2 - 2), cx = r0.x + r0.w / 2, cy = r0.y + (r0.h - 22) / 2;
    out.push({ id: `${id}.ring`, type: 'arc', props: { x: cx, y: cy, r0: R - 7, r1: R, a0: 0, a1: 360, fill: pal[sk.ring], glow: 0.35 } });
    out.push({ id: `${id}.dish`, type: 'radar', bind: { sweep: 'mod(time() * 80, 360)' }, props: { x: cx, y: cy, r: R - 10, trail: 110, rings: sk.rings, color: pal[sk.color], bg: sk.bg, glow: 0.7, contacts: radarContacts(pr) } });
    out.push(text(`${id}.cap`, cx, r0.y + r0.h - 8, p.node.widget === 'scope' ? 'TACTICAL SCOPE' : 'TACTICAL SENSOR ARRAY', Math.min(17, r0.w / 15), pal[ctx.skin.widgets.head], { align: 'center', font: font(ctx, true), weight: '700' }));
    const sel0 = pr.selected === undefined || pr.selected === null ? null : String(pr.selected);
    void sel0;
    return;
  }
  const inner = panel(p, ctx, out, id, p.node.widget === 'scope' ? 'Scope' : 'Radar');
  const R = Math.max(10, Math.min(inner.w, inner.h) / 2 - 6), cx = inner.x + inner.w / 2, cy = inner.y + inner.h / 2;
  for (let i = 1; i <= 3; i++) out.push({ id: `${id}.ring${i}`, type: 'arc', props: { x: cx, y: cy, r0: (R * i) / 3 - 1, r1: (R * i) / 3, a0: 0, a1: 360, fill: tok(ctx, 'color.dim'), opacity: 0.5 } });
  out.push({ id: `${id}.ax`, type: 'line', props: { x1: cx, y1: cy - R, x2: cx, y2: cy + R, stroke: tok(ctx, 'color.dim'), strokeWidth: 1, opacity: 0.4 } });
  out.push({ id: `${id}.ay`, type: 'line', props: { x1: cx - R, y1: cy, x2: cx + R, y2: cy, stroke: tok(ctx, 'color.dim'), strokeWidth: 1, opacity: 0.4 } });
  out.push({ id: `${id}.me`, type: 'polygon', props: { points: [cx, cy - 8, cx - 6, cy + 6, cx + 6, cy + 6], fill: tone(ctx, undefined) } });
  const cs = entries(pr.contacts);
  const dists = cs.map(([, v]) => num(((v ?? {}) as Record<string, unknown>).distance_m, 0));
  const range = num(pr.range_m, 0) || Math.max(1, ...dists) * 1.05;
  const sel = pr.selected === undefined || pr.selected === null ? null : String(pr.selected);
  cs.forEach(([k, v]) => {
    const o = (v ?? {}) as Record<string, unknown>, rel = (o.rel ?? o.bearing ?? {}) as Record<string, unknown>;
    const az = (num(rel.az) * Math.PI) / 180, d = Math.min(1, Math.sqrt(num(o.distance_m) / range));
    const x = cx + Math.sin(az) * d * R, y = cy - Math.cos(az) * d * R;
    const isSel = sel !== null && sel === String(o.cid ?? k);
    out.push({ id: `${id}.c${k}`, type: 'circle', props: { x, y, r: isSel ? 7 : 5, fill: isSel ? tok(ctx, 'color.accent2') : tok(ctx, 'color.warn'), glow: isSel ? 0.5 : 0.2 }, events: p.node.events?.includes('select') ? ['click'] : [], target: { path: p.node.path, event: 'select', value: typeof o.cid === 'number' ? o.cid : k } });
    if (isSel || cs.length <= 4) out.push(text(`${id}.c${k}.n`, x + 9, y, str(o.name), 11, tok(ctx, 'color.text'), { font: font(ctx), maxWidth: 110 }));
  });
};

const teamAssigner: Draw = (p, ctx, out) => {
  const pr = p.node.props, id = p.node.path;
  const inner = panel(p, ctx, out, id, 'Damage control teams');
  const teams = entries(pr.teams), systems = Array.isArray(pr.systems) ? (pr.systems as unknown[]).map(String) : entries(pr.systems).map(([k]) => k);
  const picked = ctx.local.get(`${id}.team`);
  const rh = 32;
  teams.slice(0, Math.max(0, Math.floor((inner.h * 0.5) / rh))).forEach(([k, v], i) => {
    const y = inner.y + i * rh, o = (v ?? {}) as Record<string, unknown>, sel = picked === k;
    out.push(rect(`${id}.t${k}.bg`, { x: inner.x, y: y + 2, w: inner.w, h: rh - 4 }, sel ? tok(ctx, 'color.accent') : tok(ctx, 'color.bg'), { r: radius(ctx), stroke: tok(ctx, 'color.accent'), strokeWidth: 1 }));
    out.push(text(`${id}.t${k}.n`, inner.x + 10, y + rh / 2, `TEAM ${k}   ${num(o.crew)} CREW`, 15, sel ? tok(ctx, 'color.bg') : tok(ctx, 'color.text'), { font: font(ctx, true), weight: '700' }));
    out.push(text(`${id}.t${k}.a`, inner.x + inner.w - 10, y + rh / 2, str(o.assign).replace(/_/g, ' ').toUpperCase(), 14, sel ? tok(ctx, 'color.bg') : tok(ctx, 'color.accent2'), { align: 'right', font: font(ctx) }));
    out.push({ id: `${id}.t${k}.hit`, type: 'rect', props: { x: inner.x, y, w: inner.w, h: rh, fill: '#00000000' }, events: ['click'], target: { path: p.node.path, event: '', local: { key: `${id}.team`, value: sel ? null : k }, setUi: { key: 'team', value: sel || !/^\d+$/.test(k) ? null : Number(k) } } });
  });
  const y0 = inner.y + Math.min(teams.length, Math.floor((inner.h * 0.5) / rh)) * rh + 10;
  out.push(text(`${id}.hint`, inner.x + 4, y0 + 8, picked ? `SEND TEAM ${String(picked)} TO:` : 'PICK A TEAM FIRST, THEN A SYSTEM', 13, tok(ctx, 'color.dim'), { font: font(ctx), weight: '600' }));
  const bw = 150, bh = 34;
  const perRow = Math.max(1, Math.floor(inner.w / (bw + 6)));
  systems.forEach((s, i) => {
    const x = inner.x + (i % perRow) * (bw + 6), y = y0 + 22 + Math.floor(i / perRow) * (bh + 6);
    if (y + bh > inner.y + inner.h) return;
    const on = !!picked && !ctx.readonly && p.node.enabled;
    out.push({
      id: `${id}.s${s}`, type: 'button',
      props: { x, y, w: bw, h: bh, text: s.replace(/_/g, ' ').toUpperCase(), fill: on ? tone(ctx, undefined) : tok(ctx, 'color.panel'), color: on ? tok(ctx, 'color.bg') : tok(ctx, 'color.dim'), size: 14, weight: '700', font: font(ctx, true), r: radius(ctx) },
      events: on ? ['click'] : [], target: on ? { path: p.node.path, event: 'assign', value: { team: /^\d+$/.test(String(picked)) ? Number(picked) : picked, system: s } } : undefined,
    });
  });
};

const joystick: Draw = (p, ctx, out) => {
  const pr = p.node.props, id = p.node.path, r = p.rect;
  const R = Math.max(20, Math.min(r.w - 56, r.h - 30) / 2 - 8), cx = r.x + (r.w - 40) / 2, cy = r.y + (r.h - 22) / 2;
  out.push({ id: `${id}.base`, type: 'circle', props: { x: cx, y: cy, r: R, fill: tok(ctx, 'color.panel'), stroke: tone(ctx, undefined), strokeWidth: 3, glow: 0.1 } });
  out.push({ id: `${id}.h`, type: 'line', props: { x1: cx - R, y1: cy, x2: cx + R, y2: cy, stroke: tok(ctx, 'color.dim'), strokeWidth: 1 } });
  out.push({ id: `${id}.v`, type: 'line', props: { x1: cx, y1: cy - R, x2: cx, y2: cy + R, stroke: tok(ctx, 'color.dim'), strokeWidth: 1 } });
  const can = p.node.enabled && !ctx.readonly;
  const thr = num(ctx.local.get(`${id}.thr`), 0);
  out.push({
    id: `${id}.knob`, type: 'circle',
    props: { x: cx, y: cy, r: R * 0.32, fill: tone(ctx, undefined), stroke: tok(ctx, 'color.text'), strokeWidth: 2, glow: 0.3, drag: can ? { r: R * 0.68, home: true, scale: 100 } : undefined },
    events: can ? ['drag', 'settle'] : [],
    target: { path: p.node.path, event: 'change', value: (x: number, y: number) => ({ yaw: x / 100, pitch: -y / 100, throttle: thr / 100 }) },
  });
  if (pr.label) out.push(text(`${id}.l`, cx, r.y + r.h - 8, str(pr.label).toUpperCase(), 13, tok(ctx, 'color.dim'), { align: 'center', font: font(ctx), weight: '700' }));
  // throttle: a column to the right of the stick
  const tx = r.x + r.w - 34, ty = r.y + 14, th = Math.max(40, r.h - 44);
  out.push(rect(`${id}.thr.tr`, { x: tx, y: ty, w: 16, h: th }, tok(ctx, 'color.panel'), { r: 8, stroke: tok(ctx, 'color.dim'), strokeWidth: 1 }));
  out.push(rect(`${id}.thr.f`, { x: tx, y: ty + th * (1 - thr / 100), w: 16, h: (th * thr) / 100 }, tone(ctx, 'accent2'), { r: 8 }));
  out.push(text(`${id}.thr.v`, tx + 8, ty - 10, `${Math.round(thr)}%`, 11, tok(ctx, 'color.text'), { align: 'center', font: font(ctx) }));
  if (can) out.push({ id: `${id}.thr.hit`, type: 'rect', props: { x: tx - 8, y: ty - 4, w: 32, h: th + 8, fill: '#00000000' }, events: ['click'], target: { path: p.node.path, event: 'change', local: { key: `${id}.thr`, value: (_x: number, y: number) => Math.max(0, Math.min(100, Math.round(((ty + th - y) / th) * 100))) }, value: (_x: number, y: number) => ({ yaw: 0, pitch: 0, throttle: Math.max(0, Math.min(1, (ty + th - y) / th)) }) } });
};

const schematic: Draw = (p, ctx, out) => {
  const pr = p.node.props, id = p.node.path;
  const inner = panel(p, ctx, out, id, 'Ship');
  const key = str(pr.sprite_key);
  const img = ctx.images.get(key);
  if (!img) {
    out.push(text(`${id}.wait`, inner.x + inner.w / 2, inner.y + inner.h / 2, 'LOADING SCHEMATIC', 14, tok(ctx, 'color.dim'), { align: 'center', font: font(ctx) }));
    return;
  }
  const k = Math.min(inner.w / img.w, inner.h / img.h), w = img.w * k, h = img.h * k, x = inner.x + (inner.w - w) / 2, y = inner.y + (inner.h - h) / 2;
  out.push({ id: `${id}.img`, type: 'image', props: { x, y, w, h, src: img.name } });
  if (p.node.events?.includes('click')) {
    for (const [zone, zr] of Object.entries(img.zones)) {
      out.push({ id: `${id}.z${zone}`, type: 'rect', props: { x: x + zr.x * k, y: y + zr.y * k, w: zr.w * k, h: zr.h * k, fill: '#00000000', stroke: tok(ctx, 'color.accent2'), strokeWidth: 1, opacity: 0.0 }, events: p.node.enabled && !ctx.readonly ? ['click'] : [], target: { path: p.node.path, event: 'click', value: zone } });
    }
  }
};

export const amountKey = (a: unknown): string => JSON.stringify(a, (_k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v));

interface ViewItem { cid?: string; name?: string; x?: number; y?: number; size?: number; min_px?: number; type?: string; art?: string; views?: { view: string; weight: number; zones?: Record<string, number>; glows?: Record<string, number> }[]; mirror?: boolean; roll?: number }

/** What the viewscreen needs drawn as pictures: contact art views (spec 7.7), with the tint amounts the engine evaluated per contact. */
export function viewNeeds(n: CmcpNode): { art: string; view: string; amounts: { zones?: Record<string, number>; glows?: Record<string, number> } }[] {
  const out: ReturnType<typeof viewNeeds> = [];
  const walk = (x: CmcpNode): void => {
    if (x.widget === 'viewscreen' && Array.isArray(x.props.items)) {
      for (const it of x.props.items as ViewItem[]) for (const v of it.views ?? []) if (it.art) out.push({ art: it.art, view: v.view, amounts: { zones: v.zones, glows: v.glows } });
    }
    (x.children ?? []).forEach(walk);
  };
  walk(n);
  return out;
}

/** the forward view: backdrop, planets, contacts far to near with the view of their art chosen for the angle they show us (and
 * cross-faded with the next nearest when the scene says so), effects are added by the controller on top */
const viewscreen: Draw = (p, ctx, out) => {
  const id = p.node.path, r = p.rect;
  const vsk = ctx.skin?.widgets.viewscreen;
  out.push(rect(`${id}.bg`, r, ctx.skin ? '#030816' : '#000000', vsk ? { stroke: ctx.pal![vsk.role], strokeWidth: vsk.width * 0.75, r: vsk.r * 0.75, glow: 0.3 } : { stroke: tok(ctx, 'color.accent'), strokeWidth: 2, r: radius(ctx) }));
  const bd = (p.node.props.backdrop ?? {}) as Record<string, unknown>;
  if (bd.kind !== 'none') out.push({ id: `${id}.stars`, type: 'starfield', props: { x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4, count: Math.round(num(bd.density, 0.35) * 700), seed: num(bd.seed, 4711), size: 1.8, speed: ctx.reduceMotion ? 0 : 0.01 } });
  const items = Array.isArray(p.node.props.items) ? (p.node.props.items as ViewItem[]) : [];
  items.forEach((it, i) => {
    const x = r.x + num(it.x, 0.5) * r.w, y = r.y + num(it.y, 0.5) * r.h, w = Math.max(num(it.min_px, 3), num(it.size, 0.02) * r.w);
    let drawn = false;
    for (const v of it.views ?? []) {
      const img = ctx.viewImages?.get(`${it.art}|${v.view}|${amountKey({ zones: v.zones, glows: v.glows })}`);
      if (!img) continue;
      drawn = true;
      const h = (w * img.h) / img.w;
      out.push({ id: `${id}.i${i}.${v.view}`, type: 'image', props: { x: x - w / 2, y: y - h / 2, w, h, src: img.name, opacity: v.weight, pivotX: w / 2, pivotY: h / 2, scaleX: it.mirror ? -1 : 1, rotation: num(it.roll, 0) } });
    }
    if (!drawn) {
      const s = Math.max(3, w);
      out.push({ id: `${id}.i${i}`, type: 'circle', props: { x, y, r: s / 2, fill: it.type === 'Planet' ? tok(ctx, 'color.accent2') : tok(ctx, 'color.warn'), glow: 0.4 } });
    }
    if (it.name && num(it.size) > 0.03) out.push(text(`${id}.i${i}.n`, x + w / 2 + 4, y, str(it.name), 11, tok(ctx, 'color.text'), { font: font(ctx) }));
  });
  if (ctx.skin) {
    const hd = (p.node.props.heading ?? {}) as Record<string, unknown>;
    out.push(text(`${id}.hd`, r.x + 14, r.y + 16, 'FORWARD VIEWSCREEN', 17, ctx.pal![ctx.skin.widgets.head], { font: font(ctx, true), weight: '700' }));
    if (r.w > 380) out.push(text(`${id}.hh`, r.x + r.w - 14, r.y + 16, `HEADING ${String(Math.round(num(hd.az))).padStart(3, '0')} MARK ${String(Math.round(num(hd.mark))).padStart(3, '0')}`, 16, ctx.pal![ctx.skin.widgets.text], { align: 'right', font: font(ctx, true), weight: '700' }));
  } else out.push(text(`${id}.hd`, r.x + 10, r.y + 14, 'VIEWSCREEN', 12, tok(ctx, 'color.dim'), { font: font(ctx, true), weight: '700', letterSpacing: 1 }));
};

const textport: Draw = (p, ctx, out) => {
  if (ctx.skin) return; // the skin's port frame is drawn with the frame
  // the hole itself is the scene's portNode; draw only a thin frame around it (never over it)
  const r = p.rect;
  out.push(rect(`${p.node.path}.frame`, { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 }, '#00000000', { stroke: tok(ctx, 'color.accent'), strokeWidth: 2, r: radius(ctx) }));
};

/** a labelled button primitive */
function btn(ctx: Ctx, id: string, r: Rect, label: string, on: boolean, target: Target | undefined, t: unknown = 'accent'): Prim {
  return {
    id, type: 'button',
    props: { x: r.x, y: r.y, w: r.w, h: r.h, text: label, fill: on ? tone(ctx, t) : tok(ctx, 'color.panel'), color: on ? tok(ctx, 'color.bg') : tok(ctx, 'color.dim'), size: 15, weight: '700', font: font(ctx, true), r: radius(ctx), glow: on ? 0.1 : 0, align: 'center' },
    events: on && target ? ['click'] : [], target: on ? target : undefined,
  };
}

/** The whole helm from ordinary inputs (spec 6.4 helm-controls): heading with step buttons, speed and warp, STOP, course/dock to the selected contact, ENGAGE. */
const helmControls: Draw = (p, ctx, out) => {
  const pr = p.node.props, id = p.node.path;
  const inner = panel(p, ctx, out, id, 'Helm');
  const can = p.node.enabled && !ctx.readonly;
  const br = (pr.bearing ?? {}) as Record<string, unknown>, az = num(br.az), mk = num(br.mark);
  const step = num(pr.step_deg, 5) || 5;
  const warp = (pr.warp ?? {}) as Record<string, unknown>, wmax = Math.max(1, num(warp.max, 9)), wf = num(warp.factor, 0);
  const sel = pr.selected === undefined || pr.selected === null ? null : Number(pr.selected);
  const rowH = 38, gap = 6, lab = 74, fieldW = 64;
  let y = inner.y;
  const t = (k: string, x: number, yy: number, txt: string, size = 14, fill = tok(ctx, 'color.dim'), o: Record<string, unknown> = {}): void => { out.push(text(`${id}.${k}`, x, yy, txt, size, fill, { font: font(ctx), weight: '600', ...o })); };
  const ev = (event: string, value?: unknown): Target => ({ path: p.node.path, event, value });
  /** n buttons share the width left of x0 */
  const evenRow = (x0: number, yy: number, labels: string[], mk: (i: number) => { on: boolean; tg?: Target }, key: string): void => {
    const w = (inner.x + inner.w - x0 - gap * (labels.length - 1)) / labels.length;
    labels.forEach((l, i) => { const m = mk(i); out.push(btn(ctx, `${id}.${key}${i}`, { x: x0 + i * (w + gap), y: yy + 2, w, h: rowH - 4 }, l, m.on, m.tg)); });
  };
  // heading: label, typed field (or the number), step buttons
  t('h.l', inner.x + 4, y + rowH / 2, 'HEADING', 13);
  if (can && ctx.overlays) ctx.overlays.push({ id: `${id}.in.h`, x: inner.x + lab, y: y + 4, w: fieldW, h: rowH - 8, label: 'Heading, degrees', value: String(Math.round(az)), kind: 'number', min: 0, max: 359.99, path: p.node.path, event: 'heading', build: (n) => ({ az: n, mark: mk }) });
  else t('h.v', inner.x + lab, y + rowH / 2, `${Math.round(az)}`, 20, tok(ctx, 'color.text'), { weight: '700' });
  const steps = [-step * 2, -step, step, step * 2];
  evenRow(inner.x + lab + fieldW + gap, y, steps.map((d) => (d > 0 ? `+${d}` : String(d))), (i) => ({ on: can, tg: ev('heading', { az: (((az + steps[i]) % 360) + 360) % 360, mark: mk }) }), 'h');
  t('h.m', inner.x + 4, y + rowH + 4, `MARK ${Math.round(mk)}   SPEED ${cell(num(pr.speed_mps))} M/S`, 11);
  y += rowH + gap + 10;
  // impulse: label, typed percent, preset buttons
  t('s.l', inner.x + 4, y + rowH / 2, 'IMPULSE %', 13);
  if (can && ctx.overlays) ctx.overlays.push({ id: `${id}.in.s`, x: inner.x + lab, y: y + 4, w: fieldW, h: rowH - 8, label: 'Impulse, percent', value: '', kind: 'int', min: 0, max: 100, path: p.node.path, event: 'speed', build: (n) => n });
  const presets = [0, 25, 50, 75, 100];
  evenRow(inner.x + lab + fieldW + gap, y, presets.map((v) => `${v}%`), (i) => ({ on: can, tg: ev('speed', presets[i]) }), 's');
  y += rowH + gap;
  // warp: label, typed factor, - value +
  t('w.l', inner.x + 4, y + rowH / 2, 'WARP', 13);
  if (can && ctx.overlays) ctx.overlays.push({ id: `${id}.in.w`, x: inner.x + lab, y: y + 4, w: fieldW, h: rowH - 8, label: 'Warp factor', value: '', kind: 'number', min: 0, max: wmax, path: p.node.path, event: 'warp', build: (n) => n });
  const wx = inner.x + lab + fieldW + gap;
  const ww = (inner.x + inner.w - wx - gap * 2) / 4;
  out.push(btn(ctx, `${id}.wm`, { x: wx, y: y + 2, w: ww, h: rowH - 4 }, '-', can && wf > 0, ev('warp', Math.max(0, wf - 1))));
  t('w.v', wx + ww + gap + ww, y + rowH / 2, `${cell(wf)} / ${cell(wmax)}`, 18, tok(ctx, 'color.text'), { align: 'center', weight: '700' });
  out.push(btn(ctx, `${id}.wp`, { x: wx + ww * 3 + gap * 2, y: y + 2, w: ww, h: rowH - 4 }, '+', can && wf < wmax, ev('warp', Math.min(wmax, wf + 1))));
  y += rowH + gap + 4;
  // actions
  const aw = Math.min(150, (inner.w - gap * 3) / 4), ah = rowH;
  const act = (i: number, row: number, k: string, label: string, on: boolean, tg: Target, tn: unknown = 'accent'): void => {
    out.push(btn(ctx, `${id}.a${k}`, { x: inner.x + i * (aw + gap), y: y + row * (ah + gap), w: aw, h: ah }, label, on, tg, tn));
  };
  act(0, 0, 'stop', 'STOP', can, ev('stop'), 'alert');
  act(1, 0, 'imp', 'ENGAGE IMPULSE', can, ev('engage', 'impulse'));
  act(2, 0, 'wrp', 'ENGAGE WARP', can, ev('engage', 'warp'));
  act(0, 1, 'crs', 'COURSE TO CONTACT', can && sel !== null, ev('course', sel));
  act(1, 1, 'dck', 'DOCK', can && sel !== null, ev('dock', sel));
  act(2, 1, 'udk', 'UNDOCK', can, ev('undock'));
  t('sel', inner.x + 4, y + 2 * (ah + gap) + 6, sel !== null ? `SELECTED CONTACT ${sel}` : 'SELECT A CONTACT FOR COURSE / DOCK', 12);
};

/** decorative status lights (spec 6.4: clients MAY draw nothing); drawn as a row of dots */
const lights: Draw = (p, ctx, out) => {
  const n = Math.max(1, Math.min(24, num(p.node.props.count, 6))), id = p.node.path, r = p.rect;
  const col = tone(ctx, p.node.props.tone);
  for (let i = 0; i < n; i++) out.push({ id: `${id}.${i}`, type: 'circle', props: { x: r.x + 8 + i * 14, y: r.y + r.h / 2, r: 4, fill: col, opacity: ctx.reduceMotion || (i * 7) % 3 !== 0 ? 0.9 : 0.35 } });
};

/** the sector from above: bodies, waypoints, the plotted course; a click on a marker selects it, a click on empty space plots a point (spec 6.4 sector-map) */
const sectorMap: Draw = (p, ctx, out) => {
  const pr = p.node.props, id = p.node.path;
  const inner = panel(p, ctx, out, id, 'Sector');
  const m = (pr.map ?? {}) as Record<string, unknown>;
  const sector = (m.sector ?? {}) as Record<string, unknown>;
  const size = num(sector.size_m, 0) || 2e9;
  const side = Math.max(20, Math.min(inner.w, inner.h));
  const x0 = inner.x + (inner.w - side) / 2, y0 = inner.y + (inner.h - side) / 2;
  const toXY = (pos: unknown): [number, number] => {
    const a = Array.isArray(pos) ? (pos as number[]) : [0, 0];
    return [x0 + (num(a[0]) / size) * side, y0 + side - (num(a[1]) / size) * side];
  };
  out.push(rect(`${id}.field`, { x: x0, y: y0, w: side, h: side }, tok(ctx, 'color.bg'), { stroke: tok(ctx, 'color.dim'), strokeWidth: 1, r: 2 }));
  for (let i = 1; i < 4; i++) {
    out.push({ id: `${id}.gx${i}`, type: 'line', props: { x1: x0 + (side * i) / 4, y1: y0, x2: x0 + (side * i) / 4, y2: y0 + side, stroke: tok(ctx, 'color.dim'), strokeWidth: 1, opacity: 0.3 } });
    out.push({ id: `${id}.gy${i}`, type: 'line', props: { x1: x0, y1: y0 + (side * i) / 4, x2: x0 + side, y2: y0 + (side * i) / 4, stroke: tok(ctx, 'color.dim'), strokeWidth: 1, opacity: 0.3 } });
  }
  const evs = p.node.events ?? [];
  if (evs.includes('plot') && p.node.enabled && !ctx.readonly) {
    out.push({ id: `${id}.bgHit`, type: 'rect', props: { x: x0, y: y0, w: side, h: side, fill: '#00000000' }, events: ['click'],
      target: { path: p.node.path, event: 'plot', value: (x: number, y: number) => [Math.round(((x - x0) / side) * size), Math.round(((y0 + side - y) / side) * size), Math.round(size / 2)] } });
  }
  const sel = pr.selected === undefined || pr.selected === null ? null : String(pr.selected);
  const bodies = entries(m.bodies);
  bodies.forEach(([k, v]) => {
    const b = (v ?? {}) as Record<string, unknown>, [x, y] = toXY(b.pos_m);
    const kind = str(b.kind), r = kind === 'star' ? 12 : kind === 'planet' ? 8 : 4;
    const col = kind === 'star' ? tok(ctx, 'color.warn') : kind === 'planet' ? tok(ctx, 'color.accent2') : tok(ctx, 'color.dim');
    out.push({ id: `${id}.b${k}`, type: 'circle', props: { x, y, r: sel === k ? r + 3 : r, fill: col, glow: kind === 'star' ? 0.5 : 0.15, stroke: sel === k ? tok(ctx, 'color.text') : undefined, strokeWidth: 2 }, events: evs.includes('select') ? ['click'] : [], target: { path: p.node.path, event: 'select', value: k } });
    out.push(text(`${id}.b${k}.n`, x + r + 5, y, str(b.name), 11, tok(ctx, 'color.text'), { font: font(ctx), maxWidth: 120 }));
  });
  const wps = entries(m.waypoints);
  wps.forEach(([k, v]) => {
    const w = (v ?? {}) as Record<string, unknown>, [x, y] = toXY(w.pos_m);
    out.push({ id: `${id}.w${k}`, type: 'polygon', props: { points: [x, y - 7, x + 6, y, x, y + 7, x - 6, y], fill: sel === k ? tok(ctx, 'color.accent') : tok(ctx, 'color.ok') }, events: evs.includes('select') ? ['click'] : [], target: { path: p.node.path, event: 'select', value: k } });
    out.push(text(`${id}.w${k}.n`, x + 10, y, str(w.name), 11, tok(ctx, 'color.ok'), { font: font(ctx), maxWidth: 110 }));
  });
  const course = (m.course ?? pr.course ?? {}) as Record<string, unknown>;
  const legs = Array.isArray(course.legs) ? (course.legs as unknown[]) : [];
  const pts: number[] = [];
  for (const l of legs) {
    const wp = (m.waypoints as Record<string, Record<string, unknown>> | undefined)?.[String(l)];
    if (wp) pts.push(...toXY(wp.pos_m));
  }
  if (pts.length >= 4) out.push({ id: `${id}.course`, type: 'polyline', props: { points: pts, stroke: tok(ctx, 'color.accent'), strokeWidth: 2, glow: 0.2 } });
  if (course.eta_s !== undefined) out.push(text(`${id}.eta`, inner.x + 6, inner.y + inner.h - 8, `COURSE ${str(course.mode).toUpperCase()}  ETA ${Math.round(num(course.eta_s))} S`, 12, tok(ctx, 'color.accent'), { font: font(ctx), weight: '700' }));
};

/** a face for a hail: a parametric head with a mood */
const portrait: Draw = (p, ctx, out) => {
  const pr = p.node.props, id = p.node.path, r = p.rect;
  const inner = panel(p, ctx, out, id, str(pr.name) || 'No hail');
  if (!pr.name && !pr.model && !pr.sprite) return;
  const prm = (pr.params ?? {}) as Record<string, unknown>;
  const tint = typeof prm.tint === 'string' ? prm.tint : tok(ctx, 'color.accent2');
  const R = Math.max(10, Math.min(inner.w, inner.h) / 2 - 8), cx = inner.x + inner.w / 2, cy = inner.y + inner.h / 2 + 6;
  const mood = str(pr.mood);
  out.push({ id: `${id}.head`, type: 'ellipse', props: { x: cx, y: cy, rx: R * 0.75, ry: R, fill: tint, opacity: 0.85, glow: 0.2 } });
  for (const s of [-1, 1]) {
    out.push({ id: `${id}.eye${s}`, type: 'ellipse', props: { x: cx + s * R * 0.3, y: cy - R * 0.2, rx: R * 0.1, ry: mood === 'angry' ? R * 0.05 : R * 0.1, fill: '#0a0f14' } });
    if (mood === 'angry') out.push({ id: `${id}.brow${s}`, type: 'line', props: { x1: cx + s * R * 0.45, y1: cy - R * 0.4 + s * 4, x2: cx + s * R * 0.15, y2: cy - R * 0.3 - s * 4, stroke: '#0a0f14', strokeWidth: 3 } });
  }
  const smile = mood === 'friendly' ? 1 : mood === 'angry' || mood === 'threat' ? -1 : 0;
  out.push({ id: `${id}.mouth`, type: 'line', props: { x1: cx - R * 0.3, y1: cy + R * 0.45, x2: cx + R * 0.3, y2: cy + R * 0.45 - smile * 6, stroke: '#0a0f14', strokeWidth: 3, cap: 'round' } });
  if (mood) out.push(text(`${id}.mood`, r.x + r.w / 2, r.y + r.h - 12, mood.toUpperCase(), 11, tok(ctx, 'color.dim'), { align: 'center', font: font(ctx) }));
};

/** a scrolling log, oldest first (the newest rows at the bottom) */
const logw: Draw = (p, ctx, out) => {
  const pr = p.node.props, id = p.node.path;
  const inner = panel(p, ctx, out, id, 'Log');
  const kinds = str(pr.kinds).split(',').map((k) => k.trim()).filter(Boolean);
  let rows = entries(pr.rows).map(([k, v]) => [k, (v ?? {}) as Record<string, unknown>] as const).filter(([, o]) => !kinds.length || kinds.includes(str(o.kind)));
  rows.sort((a, b) => num(a[1].t) - num(b[1].t));
  const rh = 18, fit = Math.max(1, Math.floor(inner.h / rh));
  rows = rows.slice(-Math.min(fit, num(pr.max, 200) || 200));
  rows.forEach(([k, o], i) => {
    const y = inner.y + i * rh + rh / 2, sev = str(o.severity);
    const col = sev === 'alert' || sev === 'error' ? tok(ctx, 'color.alert') : sev === 'warn' ? tok(ctx, 'color.warn') : tok(ctx, 'color.text');
    const d = typeof o.t === 'number' ? new Date(o.t) : null;
    const clock = d ? d.toISOString().slice(11, 19) : '';
    out.push(text(`${id}.r${k}.t`, inner.x + 4, y, clock, 11, tok(ctx, 'color.dim'), { font: font(ctx) }));
    out.push(text(`${id}.r${k}.x`, inner.x + 66, y, `${o.from ? str(o.from).toUpperCase() + ': ' : ''}${str(o.text ?? o.line)}`, 13, col, { font: font(ctx), maxWidth: inner.w - 72 }));
    if (p.node.events?.includes('select')) out.push({ id: `${id}.r${k}.hit`, type: 'rect', props: { x: inner.x, y: y - rh / 2, w: inner.w, h: rh, fill: '#00000000' }, events: ['click'], target: { path: p.node.path, event: 'select', value: k } });
  });
};

/** the transporter pads with their occupants and the energizing progress */
const padDiagram: Draw = (p, ctx, out) => {
  const pr = p.node.props, id = p.node.path;
  const inner = panel(p, ctx, out, id, 'Transporter pads');
  const pads = entries(pr.pads);
  const sel = pr.selected === undefined || pr.selected === null ? null : String(pr.selected);
  const n = Math.max(1, pads.length), cols = Math.min(n, Math.max(1, Math.floor(inner.w / 130))), rowsN = Math.ceil(n / cols);
  const cw = inner.w / cols, ch = (inner.h - 22) / rowsN;
  pads.forEach(([k, v], i) => {
    const o = (v ?? {}) as Record<string, unknown>, occ = entries(o.occupants);
    const cx = inner.x + (i % cols) * cw + cw / 2, cy = inner.y + Math.floor(i / cols) * ch + ch / 2 - 6, R = Math.max(14, Math.min(cw, ch) / 2 - 22);
    const busy = occ.length > 0, isSel = sel === k;
    out.push({ id: `${id}.p${k}.ring`, type: 'circle', props: { x: cx, y: cy, r: R, fill: busy ? tok(ctx, 'color.accent') : tok(ctx, 'color.panel'), opacity: busy ? 0.35 : 1, stroke: isSel ? tok(ctx, 'color.text') : tok(ctx, 'color.accent2'), strokeWidth: isSel ? 4 : 2, glow: busy ? 0.4 : 0.1 }, events: p.node.events?.includes('select') ? ['click'] : [], target: { path: p.node.path, event: 'select', value: /^\d+$/.test(k) ? Number(k) : k } });
    out.push(text(`${id}.p${k}.l`, cx, cy - 4, str(o.label) || `PAD ${k}`, 13, tok(ctx, 'color.text'), { align: 'center', font: font(ctx, true), weight: '700' }));
    out.push(text(`${id}.p${k}.s`, cx, cy + 12, str(o.state).toUpperCase(), 10, tok(ctx, 'color.dim'), { align: 'center', font: font(ctx) }));
    occ.slice(0, 3).forEach(([ok, ov], j) => out.push(text(`${id}.p${k}.o${ok}`, cx, cy + R + 10 + j * 12, str(((ov ?? {}) as Record<string, unknown>).name), 10, tok(ctx, 'color.text'), { align: 'center', font: font(ctx), maxWidth: cw - 8 })));
  });
  const pg = frac(pr.progress, 1, 1);
  if (pg !== null) {
    const tr: Rect = { x: inner.x, y: inner.y + inner.h - 14, w: inner.w, h: 8 };
    out.push(rect(`${id}.pg.tr`, tr, tok(ctx, 'color.bg'), { r: 4, stroke: tok(ctx, 'color.dim'), strokeWidth: 1 }));
    if (pg > 0) out.push(rect(`${id}.pg.f`, { ...tr, w: tr.w * pg }, tone(ctx, 'ok'), { r: 4, glow: 0.3 }));
  }
};

const DRAW: Record<string, Draw> = {
  'sector-map': sectorMap, portrait, log: logw, 'pad-diagram': padDiagram,
  'helm-controls': helmControls, lights,
  label, bar, 'bar-list': barList, list: table, table, 'contact-picker': table, 'group-picker': groupPicker, button, toggle, slider, graph, gauge,
  radar, scope: radar, 'team-assigner': teamAssigner, joystick, schematic, viewscreen, textport,
};

/** Draws a placed tree into primitives (back to front). */
export function draw(p: Placed, ctx: Ctx, out: Prim[] = []): Prim[] {
  const f = DRAW[p.node.widget];
  if (f) f(p, ctx, out);
  for (const c of p.children) draw(c, ctx, out);
  return out;
}

/** The rectangle of the text port in scene units. */
export function textportRect(root: Placed): Rect | null {
  return findTextport(root)?.rect ?? null;
}

/** Updates the rolling histories of graph widgets from a tree (called once per tree). */
export function recordHistory(n: CmcpNode, hist: Map<string, number[]>): void {
  if (n.widget === 'graph' && typeof n.props.value === 'number') {
    const h = hist.get(n.path) ?? [];
    h.push(n.props.value);
    if (h.length > 600) h.splice(0, h.length - 600);
    hist.set(n.path, h);
  }
  for (const c of n.children ?? []) recordHistory(c, hist);
}

/** The held contexts as chips along the top (highest priority at the left); the active one is lit. Informational: the server decides. */
export function contextStrip(stack: CmcpStackEntry[], w: number, ctx: Ctx): Prim[] {
  const out: Prim[] = [];
  let x = 6;
  [...stack].reverse().forEach((e, i) => {
    const label = (e.title || e.name || e.id).toUpperCase().slice(0, 22);
    const cw = Math.max(70, label.length * 9 + 24);
    if (x + cw > w - 40) return;
    out.push(rect(`ctx.${i}.bg`, { x, y: 3, w: cw, h: 20 }, e.active ? tok(ctx, 'color.accent') : tok(ctx, 'color.panel'), { r: 10, stroke: tok(ctx, 'color.accent'), strokeWidth: 1, opacity: e.active ? 1 : 0.8 }));
    out.push(text(`ctx.${i}.t`, x + cw / 2, 13, `${label}${e.readonly ? ' (VIEW)' : ''}`, 12, e.active ? tok(ctx, 'color.bg') : tok(ctx, 'color.text'), { align: 'center', font: font(ctx, true), weight: '700', maxWidth: cw - 8 }));
    x += cw + 6;
  });
  return out;
}

/** Why nothing can be clicked: the ship is on AI, or somebody else took the console (spec 3.1 rule 4). */
export function readonlyBadge(ai: boolean, mannedBy: string | undefined, w: number, ctx: Ctx): Prim[] {
  const t = ai ? 'AI CONTROL - VIEW ONLY' : mannedBy ? `${mannedBy.toUpperCase()} HAS THE CONSOLE - VIEW ONLY` : 'VIEW ONLY';
  const bw = Math.min(w / 2, t.length * 8.5 + 28);
  return [
    rect('ro.bg', { x: w - bw - 44, y: 4, w: bw, h: 22 }, tok(ctx, 'color.warn'), { r: 11, glow: 0.2 }),
    text('ro.t', w - bw / 2 - 44, 15, t, 13, tok(ctx, 'color.bg'), { align: 'center', font: font(ctx, true), weight: '700', maxWidth: bw - 12 }),
  ];
}
