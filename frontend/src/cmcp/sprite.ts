/** Draws the shared sprite format (cmcp spec 7.2) with Canvas2D: layers of path/polygon/polyline/line/rect/circle/ellipse/group shapes with
 * solid or gradient fills and strokes, SVG-style transforms, zone tints (0..1, drawn over the finished sprite only where it is
 * drawn, like the Go rasteriser) and additive glows. Tokens arrive resolved from the engine. The result becomes an image of the
 * scene (spec 7.4: Canvas2D -> offscreen canvas -> texture). It is the browser's rasteriser, so it matches the Go one within the
 * parity bounds of conformance/sprite-parity.json (checked by scripts/cmcp-parity.mjs in real Chrome), not bit for bit. */
export interface SpriteView {
  viewBox?: [number, number, number, number];
  preserveAspect?: string;
  layers: Layer[];
  zones?: { id: string; color?: string; shapes?: Shape[] }[];
  glows?: { id: string; x: number; y: number; r: number; color: string; intensity?: number }[];
}
interface Layer { id?: string; opacity?: number; hidden?: boolean; transform?: string; shapes: Shape[] }
type Paint = string | { type?: string; stops?: [number, string][]; x1?: number; y1?: number; x2?: number; y2?: number; cx?: number; cy?: number; r?: number };
export interface Shape {
  type: string; zone?: string; fill?: Paint | null; stroke?: { paint?: Paint; width?: number; join?: string; cap?: string } | null;
  points?: number[]; d?: string; x?: number; y?: number; w?: number; h?: number; cx?: number; cy?: number; r?: number; rx?: number; ry?: number;
  x1?: number; y1?: number; x2?: number; y2?: number; opacity?: number; hidden?: boolean; transform?: string; children?: Shape[]; fillRule?: string;
}

export interface Drawn { canvas: HTMLCanvasElement; w: number; h: number; zones: Record<string, { x: number; y: number; w: number; h: number }> }

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

/** SVG transform list: translate, scale, rotate (with optional centre), skewX, skewY, matrix. */
export function parseTransform(s: string | undefined): M {
  let m: M = [1, 0, 0, 1, 0, 0];
  if (!s) return m;
  for (const t of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n: M = [1, 0, 0, 1, 0, 0];
    switch (t[1]) {
      case 'translate': n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case 'scale': n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), si = Math.sin(r);
        n = [c, si, -si, c, 0, 0];
        if (a.length >= 3) n = mul(mul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX': n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
      case 'matrix': if (a.length === 6) n = a as M; break;
      default: break;
    }
    m = mul(m, n);
  }
  return m;
}

/** Linear mix of two #rrggbb[aa] colours (t = 0 gives a). */
export function mix(a: string, b: string, t: number): string {
  const p = (c: string): number[] => {
    const h = c.replace('#', '');
    const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6);
    const n = parseInt(f, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [ar, ag, ab] = p(a), [br, bg, bb] = p(b);
  const f = (x: number, y: number): number => Math.round(x + (y - x) * t);
  return `rgb(${f(ar, br)},${f(ag, bg)},${f(ab, bb)})`;
}

function paintOf(ctx: CanvasRenderingContext2D, p: Paint | null | undefined): string | CanvasGradient | null {
  if (p === undefined || p === null) return null;
  if (typeof p === 'string') return p;
  const g = p.type === 'radial' ? ctx.createRadialGradient(p.cx ?? 0, p.cy ?? 0, 0, p.cx ?? 0, p.cy ?? 0, p.r ?? 1) : ctx.createLinearGradient(p.x1 ?? 0, p.y1 ?? 0, p.x2 ?? 0, p.y2 ?? 1);
  for (const [o, c] of p.stops ?? []) g.addColorStop(Math.max(0, Math.min(1, o)), c);
  return g;
}

function pathOf(s: Shape): Path2D | null {
  const P = new Path2D();
  switch (s.type) {
    case 'polygon': case 'polyline': {
      const pts = s.points ?? [];
      if (pts.length < 4) return null;
      P.moveTo(pts[0], pts[1]);
      for (let i = 2; i + 1 < pts.length; i += 2) P.lineTo(pts[i], pts[i + 1]);
      if (s.type === 'polygon') P.closePath();
      return P;
    }
    case 'path': return s.d ? new Path2D(s.d) : null;
    case 'rect': P.rect(s.x ?? 0, s.y ?? 0, s.w ?? 0, s.h ?? 0); return P;
    case 'circle': P.arc(s.cx ?? 0, s.cy ?? 0, s.r ?? 0, 0, Math.PI * 2); return P;
    case 'ellipse': P.ellipse(s.cx ?? 0, s.cy ?? 0, s.rx ?? 0, s.ry ?? 0, 0, 0, Math.PI * 2); return P;
    case 'line': P.moveTo(s.x1 ?? 0, s.y1 ?? 0); P.lineTo(s.x2 ?? 0, s.y2 ?? 0); return P;
    default: return null;
  }
}

type Box = { x0: number; y0: number; x1: number; y1: number };
function bounds(s: Shape, m: M, b: Box): void {
  const add = (x: number, y: number): void => {
    const X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5];
    b.x0 = Math.min(b.x0, X); b.y0 = Math.min(b.y0, Y); b.x1 = Math.max(b.x1, X); b.y1 = Math.max(b.y1, Y);
  };
  if (s.points) for (let i = 0; i + 1 < s.points.length; i += 2) add(s.points[i], s.points[i + 1]);
  else if (s.type === 'rect') { add(s.x ?? 0, s.y ?? 0); add((s.x ?? 0) + (s.w ?? 0), (s.y ?? 0) + (s.h ?? 0)); }
  else if (s.type === 'circle') { add((s.cx ?? 0) - (s.r ?? 0), (s.cy ?? 0) - (s.r ?? 0)); add((s.cx ?? 0) + (s.r ?? 0), (s.cy ?? 0) + (s.r ?? 0)); }
  else if (s.type === 'ellipse') { add((s.cx ?? 0) - (s.rx ?? 0), (s.cy ?? 0) - (s.ry ?? 0)); add((s.cx ?? 0) + (s.rx ?? 0), (s.cy ?? 0) + (s.ry ?? 0)); }
  else if (s.d) for (const mm of s.d.matchAll(/(-?\d+\.?\d*)[ ,]+(-?\d+\.?\d*)/g)) add(Number(mm[1]), Number(mm[2]));
}

/** Visits every visible leaf shape with its accumulated transform and opacity. */
function walk(shapes: Shape[], m: M, op: number, f: (s: Shape, m: M, op: number) => void): void {
  for (const s of shapes) {
    if (s.hidden) continue;
    const mm = mul(m, parseTransform(s.transform)), o = op * (s.opacity || 1);
    if (s.type === 'group') walk(s.children ?? [], mm, o, f);
    else f(s, mm, o);
  }
}

/** Renders a view at pxW pixels wide. amounts: zone tints and glow intensities from the engine (Sprite.Evaluate). */
export function drawSprite(v: SpriteView, pxW: number, amounts: { zones?: Record<string, number>; glows?: Record<string, number> }): Drawn | null {
  if (typeof document === 'undefined') return null;
  const vb = v.viewBox ?? [0, 0, 200, 100];
  const k = pxW / vb[2];
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(pxW));
  canvas.height = Math.max(1, Math.round(vb[3] * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const base: M = [k, 0, 0, k, -vb[0] * k, -vb[1] * k];
  const setM = (m: M): void => ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  const boxes = new Map<string, Box>();
  const note = (id: string, s: Shape, m: M): void => {
    let b = boxes.get(id);
    if (!b) { b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }; boxes.set(id, b); }
    bounds(s, m, b);
  };
  const root: M = [1, 0, 0, 1, 0, 0];
  for (const layer of v.layers) {
    if (layer.hidden) continue;
    walk(layer.shapes, mul(root, parseTransform(layer.transform)), layer.opacity || 1, (s, m, op) => {
      if (s.zone) note(s.zone, s, m);
      const P = pathOf(s);
      if (!P) return;
      setM(mul(base, m));
      ctx.globalAlpha = op;
      const fill = s.type === 'line' || s.type === 'polyline' ? null : paintOf(ctx, s.fill);
      if (fill) { ctx.fillStyle = fill; ctx.fill(P, s.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'); }
      if (s.stroke) {
        const sp = paintOf(ctx, s.stroke.paint ?? '#000000');
        if (sp) { ctx.strokeStyle = sp; ctx.lineWidth = s.stroke.width || 1; ctx.lineJoin = (s.stroke.join as CanvasLineJoin) || 'miter'; ctx.lineCap = (s.stroke.cap as CanvasLineCap) || 'butt'; ctx.stroke(P); }
      }
    });
  }
  // damage overlay: tint toward the zone colour over the finished sprite, only where it is drawn
  ctx.globalCompositeOperation = 'source-atop';
  for (const z of v.zones ?? []) {
    const a = amounts.zones?.[z.id] ?? 0;
    for (const s of z.shapes ?? []) note(z.id, s, root);
    if (a <= 0) continue;
    ctx.fillStyle = z.color ?? '#ff3030b4';
    ctx.globalAlpha = Math.min(1, a);
    const paint = (s: Shape, m: M): void => { const P = pathOf(s); if (P) { setM(mul(base, m)); ctx.fill(P); } };
    for (const s of z.shapes ?? []) walk([s], root, 1, (sh, m) => paint(sh, m));
    for (const layer of v.layers) walk(layer.shapes, mul(root, parseTransform(layer.transform)), 1, (sh, m) => { if (sh.zone === z.id) paint(sh, m); });
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const g of v.glows ?? []) {
    const a = amounts.glows?.[g.id] ?? g.intensity ?? 1;
    if (a <= 0) continue;
    ctx.globalAlpha = Math.min(1, a);
    const x = (g.x - vb[0]) * k, y = (g.y - vb[1]) * k, r = g.r * k;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, g.color);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
  const zones: Drawn['zones'] = {};
  for (const [id, b] of boxes) if (b.x0 < Infinity) zones[id] = { x: b.x0 - vb[0], y: b.y0 - vb[1], w: b.x1 - b.x0, h: b.y1 - b.y0 };
  return { canvas, w: vb[2], h: vb[3], zones };
}
