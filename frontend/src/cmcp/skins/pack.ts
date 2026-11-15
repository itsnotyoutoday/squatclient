import type { Button, ButtonSkin, Colour, NavItem, Rect4, Role, Shape, Skin, TextMap } from './types';
import { tng } from './tng';

/** Builds a Skin from a downloaded theme pack's gpu rendition (spec ch. 19), the way a pack authors it: the TOP LEVEL is the side layout
 * (port + content + slots + arrange), `stacked` is the text-under-the-widgets layout, frame shapes use `type`/`width`/`@role`, and text may
 * be `{by, map, default}`. Anything missing falls back to `base` (the built-in table of the same id, else tng), and fields this renderer
 * does not draw yet are listed in `notes` (never silently dropped). */
type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const rect4 = (v: unknown): Rect4 | undefined => (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number') ? (v as Rect4) : undefined);
const ROLES = 'p s t q x r k bg'.split(' ');
/** "@p" -> role p; a hex colour stays; anything else is dropped */
const colour = (v: unknown): Colour | undefined => {
  if (typeof v !== 'string') return undefined;
  if (v === 'none') return 'none';
  if (v.startsWith('@') && ROLES.includes(v.slice(1))) return v.slice(1) as Role;
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v as Colour;
  if (ROLES.includes(v)) return v as Role;
  return undefined;
};
const role = (v: unknown, d: Role): Role => {
  const c = colour(v);
  return c && ROLES.includes(c) ? (c as Role) : d;
};

function textOf(v: unknown): string | TextMap {
  if (isObj(v)) {
    const map: Record<string, string> = {};
    if (isObj(v.map)) for (const [k, t] of Object.entries(v.map)) map[k] = str(t);
    return { by: str(v.by, 'mode'), map, default: v.default === undefined ? undefined : str(v.default) };
  }
  return str(v);
}

function shapeOf(s: J, i: number, notes: Set<string>): Shape | null {
  const common = { id: str(s.id, `s${i}`), opacity: typeof s.opacity === 'number' ? s.opacity : undefined, glow: typeof s.glow === 'number' ? s.glow : undefined };
  for (const k of ['bind', 'motion', 'skewY', 'z']) if (s[k] !== undefined) notes.add(`frame.${k} is not drawn`);
  const sw = typeof s.width === 'number' ? s.width : undefined;
  switch (s.type) {
    case 'rect': return { ...common, t: 'rect', x: num(s.x), y: num(s.y), w: num(s.w), h: num(s.h), r: s.r as number | number[] | undefined, fill: colour(s.fill), stroke: colour(s.stroke), sw };
    case 'polygon': return { ...common, t: 'polygon', points: (s.points as number[]) ?? [], fill: colour(s.fill), stroke: colour(s.stroke), sw };
    case 'polyline': return { ...common, t: 'polyline', points: (s.points as number[]) ?? [], stroke: colour(s.stroke) ?? 'p', sw };
    case 'path': return { ...common, t: 'path', d: str(s.d), stroke: colour(s.stroke) ?? 'none', sw, fill: colour(s.fill) };
    case 'circle': return { ...common, t: 'circle', x: num(s.x), y: num(s.y), r: num(s.r), fill: colour(s.fill), stroke: colour(s.stroke), sw };
    case 'arc': return { ...common, t: 'arc', x: num(s.x), y: num(s.y), r0: num(s.r0), r1: num(s.r1), a0: num(s.a0), a1: num(s.a1), fill: colour(s.fill) ?? 'p' };
    case 'line': return { ...common, t: 'line', x1: num(s.x1), y1: num(s.y1), x2: num(s.x2), y2: num(s.y2), stroke: colour(s.stroke) ?? 'p', sw };
    case 'elbow': return { ...common, t: 'elbow', x: num(s.x), y: num(s.y), w: num(s.w), h: num(s.h), corner: (str(s.corner, 'tl') as 'tl'), ro: num(s.ro), ri: num(s.ri), bar: num(s.bar), side: num(s.side), fill: colour(s.fill) ?? 'p' };
    case 'text': return { ...common, t: 'text', x: num(s.x), y: num(s.y), text: textOf(s.text), size: num(s.size, 24), fill: colour(s.fill), align: s.align as 'left' | 'center' | 'right' | undefined, weight: typeof s.weight === 'string' ? s.weight : undefined };
    default: notes.add(`frame shape type ${String(s.type)} is not drawn`); return null;
  }
}

const buttonOf = (b: J, d: ButtonSkin): ButtonSkin => ({
  x: num(b.x, d.x), y: num(b.y, d.y), w: num(b.w, d.w), h: num(b.h, d.h), dx: typeof b.dx === 'number' ? b.dx : d.dx, dy: typeof b.dy === 'number' ? b.dy : d.dy,
  r: (b.r as number | number[] | undefined) ?? d.r, size: num(b.size, d.size), align: (b.align as ButtonSkin['align']) ?? d.align, padX: typeof b.padX === 'number' ? b.padX : d.padX,
  color: colour(b.color) ?? d.color, skewX: typeof b.skewX === 'number' ? b.skewX : d.skewX, stroke: colour(b.stroke) ?? d.stroke, sw: d.sw,
});

const rects = (v: unknown): Record<string, Rect4> => {
  const out: Record<string, Rect4> = {};
  if (isObj(v)) for (const [k, r] of Object.entries(v)) { const q = rect4(r); if (q) out[k] = q; }
  return out;
};
/** arrange: { "std.sensors": { slots: { "radar#0": [x,y,w,h] } } } -> { sensors: { "radar#0": [...] } } (the keys of the skin tables are the short names) */
const arrangeOf = (v: unknown): Record<string, Record<string, Rect4>> => {
  const out: Record<string, Record<string, Rect4>> = {};
  if (isObj(v)) for (const [k, a] of Object.entries(v)) if (isObj(a)) out[k.replace(/^std\./, '')] = rects(a.slots);
  return out;
};

export interface ThemeLoad { skin: Skin; notes: string[] }

export function skinFromTheme(doc: J, builtin?: Skin): ThemeLoad {
  const notes = new Set<string>();
  const base = builtin ?? tng;
  const f = isObj(doc.font) ? doc.font : {};
  const family = str(f.family, base.font.family);
  const pal = isObj(doc.pal) ? doc.pal : {};
  const palOf = (v: unknown, d: Skin['pal']['normal']): Skin['pal']['normal'] => {
    const o = { ...d };
    if (isObj(v)) for (const r of ROLES) if (typeof v[r] === 'string') o[r as Role] = v[r] as string;
    return o;
  };
  const normal = palOf(pal.normal, base.pal.normal);
  const red = palOf(pal.red, base.pal.red);

  const port = isObj(doc.port) ? doc.port : {};
  const stacked = isObj(doc.stacked) ? doc.stacked : {};
  const sPort = isObj(stacked.port) ? stacked.port : {};
  const sContent = isObj(stacked.content) ? stacked.content : {};
  const content = isObj(doc.content) ? doc.content : {};
  const pf = isObj(port.frame) ? port.frame : {};
  const portRect = rect4(sPort.rect) ?? base.port.rect;
  const sideRect = rect4(port.rect) ?? base.side.port;

  const navDoc = isObj(doc.nav) ? doc.nav : {};
  const items: NavItem[] = Array.isArray(navDoc.items)
    ? navDoc.items.filter(isObj).map((it) => {
        const list = Array.isArray(it.screens) ? (it.screens as string[]) : it.screen ? [str(it.screen)] : [];
        return { label: str(it.label), role: role(it.role, 'p'), screens: list.map((x) => x.replace(/^std\./, '')) };
      })
    : base.nav.items;
  const navBtn = buttonOf(navDoc, base.nav.button);

  const logDoc = isObj(doc.log) ? doc.log : {};
  const logLab = isObj(logDoc.label) ? logDoc.label : {};
  const logBtn = { ...buttonOf(logDoc, base.log.button), role: role(logDoc.role, base.log.button.role) };
  const ac = isObj(doc.alert_control) ? doc.alert_control : undefined;
  const alert = ac ? { ...buttonOf(ac, base.alert ?? base.off.button), role: role(ac.role, 'r') } : base.alert;
  // a pack has no screen-off button: it sits under the LOG button, same size
  const off: Skin['off'] = base.source === 'pack' ? base.off : { button: { ...logBtn, y: logBtn.y + logBtn.h + 8, h: Math.max(36, logBtn.h - 8), role: 'p' as Role }, label: 'SCREEN OFF' };

  const w = isObj(doc.widgets) ? doc.widgets : {};
  const bar = isObj(w.bar) ? w.bar : {}, btn = isObj(w.button) ? w.button : {}, radar = isObj(w.radar) ? w.radar : {}, vs = isObj(w.viewscreen) ? w.viewscreen : {}, panel = isObj(w.panel) ? w.panel : {}, table = isObj(w.table) ? w.table : {};
  const track = colour(bar.track);
  const widgets: Skin['widgets'] = {
    ...base.widgets,
    panelTitle: { role: role(panel.role, base.widgets.panelTitle.role), size: base.widgets.panelTitle.size },
    head: role(table.head, base.widgets.head),
    button: { ...base.widgets.button, h: num(btn.h, base.widgets.button.h), color: colour(btn.color) ?? base.widgets.button.color },
    bar: { h: num(bar.h, base.widgets.bar.h), track: track && !ROLES.includes(track) ? track : base.widgets.bar.track, fill: role(bar.fill, base.widgets.bar.fill) },
    radar: { kind: (['dish', 'hex', 'wing'].includes(str(radar.kind)) ? str(radar.kind) : base.widgets.radar.kind) as 'dish' | 'hex' | 'wing', ring: base.widgets.radar.ring, color: role(radar.color, base.widgets.radar.color), bg: base.widgets.radar.bg, rings: num(radar.rings, base.widgets.radar.rings) },
    viewscreen: { r: num(vs.r, base.widgets.viewscreen.r), width: num(vs.width, base.widgets.viewscreen.width), role: role(vs.role, base.widgets.viewscreen.role) },
  };
  if (isObj(doc.effects) && Object.keys(doc.effects).some((k) => k !== 'bloom')) notes.add('effects beyond bloom are not drawn');
  if (f.files && family !== base.font.family) notes.add(`font ${family} is not bundled: the glyphs fall back to the system font`);
  const al = isObj(doc.alert_edge) ? doc.alert_edge : undefined;
  const mo = isObj(doc.motion) ? doc.motion : undefined;
  const ar = str(doc.alert_recolour);

  const skin: Skin = {
    name: str(doc.id, str(doc.name, base.name)),
    font: { family, weight: str(f.weight, base.font.weight), files: family === base.font.family ? base.font.files : [], tscale: typeof f.tscale === 'number' ? f.tscale : base.font.tscale, ctscale: typeof f.ctscale === 'number' ? f.ctscale : base.font.ctscale },
    sharp: doc.sharp === true || (doc.sharp === undefined && base.sharp),
    bloom: num(doc.bloom, num(isObj(doc.effects) ? doc.effects.bloom : undefined, base.bloom)),
    pal: { normal, red },
    frame: Array.isArray(doc.frame) ? (doc.frame.filter(isObj).map((s, i) => shapeOf(s, i, notes)).filter(Boolean) as Shape[]) : base.frame,
    nav: { items, button: navBtn as Button, marker: base.nav.marker && items === base.nav.items ? base.nav.marker : undefined },
    log: { button: logBtn, shrink: str(logLab.shrink, base.log.shrink), expand: str(logLab.expand, base.log.expand) },
    off,
    alert,
    port: { rect: portRect, expanded: rect4(sPort.expanded) ?? base.port.expanded, frame: { role: role(pf.role, base.port.frame.role), r: num(pf.r, base.port.frame.r), width: num(pf.width, base.port.frame.width), glow: num(pf.glow, base.port.frame.glow), inset: typeof pf.inset === 'number' ? pf.inset : undefined } },
    side: { port: sideRect, content: rect4(content.rect) ?? base.side.content },
    content: rect4(sContent.rect) ?? base.content,
    widgets,
    arrange: isObj(stacked.arrange) ? arrangeOf(stacked.arrange) : base.arrange,
    slots: rects(stacked.slots),
    sideSlots: rects(doc.slots),
    sideArrange: arrangeOf(doc.arrange),
    maxCols: typeof port.max_cols === 'number' ? port.max_cols : undefined,
    alertEdge: al ? { color: str(al.color, '#ff2020'), width: num(al.width, 8), r: num(al.r, 0) } : undefined,
    motion: mo ? { calm: typeof mo.calm === 'number' ? mo.calm : undefined, alertMs: typeof mo.alert_ms === 'number' ? mo.alert_ms : undefined } : undefined,
    alertRecolour: ar === 'full' || ar === 'edge' || ar === 'off' ? ar : undefined,
    source: 'pack',
  };
  return { skin, notes: [...notes] };
}
