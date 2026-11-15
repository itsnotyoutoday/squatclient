import type { CmcpUI } from './types';
import type { Prim } from './widgets';
import type { Colour, Pal, Role, Shape, Skin } from './skins/types';

const ROLES = new Set(['p', 's', 't', 'q', 'x', 'r', 'k', 'bg']);
/** palette role or literal colour */
export const col = (c: Colour | string | undefined, pal: Pal): string => (c === undefined ? '#00000000' : c === 'none' ? '#00000000' : ROLES.has(c) ? pal[c as Role] : c);

/** values for the skin's text templates, from the protocol (Space.Ship.Status, the ship and the console) */
export function templateVars(ui: CmcpUI, modeLabel: string): Record<string, string> {
  const st = (ui.status ?? ui.docs?.['Space.Ship.Status'] ?? {}) as Record<string, unknown>; // the pushed model carries `status`, a pulled one `docs`
  const hull = (st.hull ?? {}) as { cur?: number; max?: number };
  const pct = hull.max ? Math.round(((hull.cur ?? 0) / hull.max) * 100) : 0;
  const alert = String(st.alert ?? ui.alert ?? 'green');
  return {
    ship: (ui.ship?.name || ui.welcome?.ship?.name || String(st.name ?? '') || ui.ship?.class || ui.ship?.id || 'UNNAMED SHIP').toUpperCase(),
    class: (ui.ship?.class || ui.welcome?.ship?.class || String(st.class ?? '')).toUpperCase(),
    game: (ui.server?.game ?? ui.server?.server ?? '').toUpperCase(),
    mode: modeLabel.toUpperCase(),
    title: (ui.console?.name ?? ui.title ?? '').toUpperCase(),
    hull: String(pct),
    core: String(Math.round(Number(st.core_pct ?? 0))),
    lock: st.lock ? String(st.lock) : '0',
    alert: alert === 'green' ? 'OFF' : alert.toUpperCase(),
  };
}
const fill = (s: string, v: Record<string, string>): string => s.replace(/\{(\w+)\}/g, (_m, k: string) => v[k] ?? '');

/** The skin's static decoration as scene primitives (back to front). Every shape's colours are palette roles, so a palette swap recolours it. */
export function frameShapes(shapes: Shape[], pal: Pal, vars: Record<string, string>, idp: string): Prim[] {
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
      case 'text': return { id, type: 'text', props: { ...base, x: s.x, y: s.y, text: fill(s.text, vars), size: s.size, fill: col(s.fill ?? 'k', pal), align: s.align ?? 'left', baseline: 'middle', weight: s.weight ?? '700' } };
    }
  });
}

/** the nav column: decoration only (the game decides the console); the current screen's item carries the marker */
export function navShapes(skin: Skin, pal: Pal, current: number, idp: string, avail?: (screen: string) => { available: boolean; hint?: string }): Prim[] {
  const b = skin.nav.button, out: Prim[] = [];
  skin.nav.items.forEach((it, i) => {
    out.push({
      id: `${idp}nav${i}`, type: 'button', events: ['click'], target: { path: '', event: '', special: 'nav', screen: `std.${it.screens[0]}` },
      props: { x: b.x + i * (b.dx ?? 0), y: b.y + i * (b.dy ?? 0), w: b.w, h: b.h, r: b.r ?? b.h / 2, fill: col(it.role, pal), text: it.label, color: col(b.color, pal), size: b.size * (skin.font.tscale ?? 1), weight: skin.font.weight,
        align: b.align ?? 'center', padX: b.padX ?? 16, font: skin.font.family, glow: 0.04, key: `alt+${i + 1}`, skewX: b.skewX ?? 0, stroke: b.stroke ? col(b.stroke, pal) : undefined, strokeWidth: b.sw, opacity: i === current ? 1 : avail?.(`std.${it.screens[0]}`).available === false ? 0.35 : 0.85 },
    });
  });
  const m = skin.nav.marker;
  if (m && current >= 0) out.push({ id: `${idp}marker`, type: 'rect', props: { x: m.x, y: m.y + current * (b.dy ?? 0), w: m.w, h: m.h, fill: col(m.fill, pal), glow: m.glow } });
  return out;
}
