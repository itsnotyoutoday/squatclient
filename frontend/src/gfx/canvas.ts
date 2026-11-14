/**
 * Pixel canvases: the /canvas family of the terminal client (gtf docs/LAYOUTS.md) rasterised on the CPU into an
 * RGBA buffer that the renderer shows with nearest-neighbour scaling. Coordinates are canvas pixels (a W x H cell
 * canvas is W x 2H pixels); pixel centres sit at +0.5, edges of discs, rings, ellipses, polygons and rounded
 * corners are anti-aliased.
 */
import { parseColor, type RGBA } from './color';
import type { GfxOp } from './types';

export interface CanvasText { cx: number; cy: number; text: string; color: string; bold: boolean; alpha: number }

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PixelCanvas {
  data: Uint8ClampedArray;
  texts: CanvasText[] = [];
  /** bumped on every change; the renderer re-uploads when it differs from what it has */
  version = 0;
  bg: RGBA = [0, 0, 0, 0];

  constructor(public w: number, public h: number, bg?: string) {
    this.w = Math.max(1, Math.floor(w));
    this.h = Math.max(1, Math.floor(h));
    this.data = new Uint8ClampedArray(this.w * this.h * 4);
    if (bg) this.bg = parseColor(bg);
    this.fillAll(this.bg);
  }

  private fillAll(c: RGBA): void {
    const r = Math.round(c[0] * 255), g = Math.round(c[1] * 255), b = Math.round(c[2] * 255), a = Math.round(c[3] * 255);
    for (let i = 0; i < this.data.length; i += 4) { this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a; }
  }

  /** Source-over of (rgb, coverage*alpha) onto one pixel. */
  private blend(x: number, y: number, c: RGBA, cov: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const a = clamp01(cov) * c[3];
    if (a <= 0) return;
    const i = (y * this.w + x) * 4;
    const da = this.data[i + 3] / 255;
    const oa = a + da * (1 - a);
    const k = oa > 0 ? 1 / oa : 0;
    this.data[i] = (c[0] * 255 * a + this.data[i] * da * (1 - a)) * k;
    this.data[i + 1] = (c[1] * 255 * a + this.data[i + 1] * da * (1 - a)) * k;
    this.data[i + 2] = (c[2] * 255 * a + this.data[i + 2] * da * (1 - a)) * k;
    this.data[i + 3] = oa * 255;
  }

  private add(x: number, y: number, c: RGBA, k: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || k <= 0) return;
    const i = (y * this.w + x) * 4;
    this.data[i] += c[0] * 255 * k;
    this.data[i + 1] += c[1] * 255 * k;
    this.data[i + 2] += c[2] * 255 * k;
    this.data[i + 3] = Math.max(this.data[i + 3], Math.min(1, k * c[3]) * 255);
  }

  /** Fills every pixel whose centre has coverage(px,py) > 0, over the bounding box. */
  private shape(x0: number, y0: number, x1: number, y1: number, c: RGBA, alpha: number, cov: (px: number, py: number) => number): void {
    const col: RGBA = [c[0], c[1], c[2], c[3] * alpha];
    const ax = Math.max(0, Math.floor(x0)), ay = Math.max(0, Math.floor(y0));
    const bx = Math.min(this.w - 1, Math.ceil(x1)), by = Math.min(this.h - 1, Math.ceil(y1));
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      const k = cov(x + 0.5, y + 0.5);
      if (k > 0) this.blend(x, y, col, k);
    }
  }

  apply(op: GfxOp): void {
    const cmd = String(op.cmd);
    const a = (op.args as number[]) ?? [];
    const color = op.color !== undefined ? parseColor(op.color) : ([1, 1, 1, 1] as RGBA);
    const alpha = typeof op.alpha === 'number' ? op.alpha : 1;
    const t = typeof op.t === 'number' ? op.t : 1;
    this.version++;
    switch (cmd) {
      case 'clear': this.fillAll(op.color !== undefined ? color : this.bg); this.texts = []; break;
      case 'px': this.blend(Math.floor(a[0]), Math.floor(a[1]), [color[0], color[1], color[2], color[3] * alpha], 1); break;
      case 'line': this.line(a[0], a[1], a[2], a[3], color, alpha, t); break;
      case 'fill': this.shape(a[0], a[1], a[0] + a[2], a[1] + a[3], color, alpha, (px, py) => (px >= a[0] && px <= a[0] + a[2] && py >= a[1] && py <= a[1] + a[3] ? 1 : 0)); break;
      case 'rect': this.rectOutline(a[0], a[1], a[2], a[3], color, alpha); break;
      case 'rrect': this.rrect(a[0], a[1], a[2], a[3], a[4], color, alpha, op.corners as string[] | undefined); break;
      case 'disc': this.shape(a[0] - a[2] - 1, a[1] - a[2] - 1, a[0] + a[2] + 1, a[1] + a[2] + 1, color, alpha, (px, py) => clamp01(a[2] - Math.hypot(px - a[0], py - a[1]) + 0.5)); break;
      case 'circle': {
        const hw = t / 2;
        this.shape(a[0] - a[2] - t - 1, a[1] - a[2] - t - 1, a[0] + a[2] + t + 1, a[1] + a[2] + t + 1, color, alpha,
          (px, py) => clamp01(hw + 0.5 - Math.abs(Math.hypot(px - a[0], py - a[1]) - a[2])));
        break;
      }
      case 'ellipse': this.ellipse(a[0], a[1], a[2], a[3], color, alpha); break;
      case 'arc': this.arc(a[0], a[1], a[2], a[3], a[4], a[5], color, alpha); break;
      case 'poly': this.poly(a, color, alpha); break;
      case 'glow': this.glow(a[0], a[1], a[2], color, alpha); break;
      case 'grad': this.grad(a[0], a[1], a[2], a[3], color, parseColor(op.color2), op.vertical === true, alpha); break;
      case 'stars': this.stars(a[0], a[1], a[2], a[3], Number(op.count ?? 0), Number(op.seed ?? 0), typeof op.t === 'number' ? op.t : 0, alpha); break;
      case 'text':
        this.texts.push({ cx: a[0], cy: a[1], text: String(op.text ?? ''), color: String(op.color ?? '#ffffff'), bold: op.bold === true, alpha });
        break;
      default: break;
    }
  }

  private line(x1: number, y1: number, x2: number, y2: number, c: RGBA, alpha: number, t: number): void {
    const hw = Math.max(t, 1) / 2;
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    this.shape(Math.min(x1, x2) - hw - 1, Math.min(y1, y2) - hw - 1, Math.max(x1, x2) + hw + 1, Math.max(y1, y2) + hw + 1, c, alpha, (px, py) => {
      let u = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2;
      u = Math.max(0, Math.min(1, u));
      return clamp01(hw + 0.5 - Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy)));
    });
  }

  private rectOutline(x: number, y: number, w: number, h: number, c: RGBA, alpha: number): void {
    this.shape(x - 1, y - 1, x + w + 1, y + h + 1, c, alpha, (px, py) => {
      const inside = px >= x && px <= x + w && py >= y && py <= y + h;
      const inner = px >= x + 1 && px <= x + w - 1 && py >= y + 1 && py <= y + h - 1;
      return inside && !inner ? 1 : 0;
    });
  }

  private rrect(x: number, y: number, w: number, h: number, r: number, c: RGBA, alpha: number, corners?: string[]): void {
    const on = new Set((corners && corners.length ? corners : ['tl', 'tr', 'bl', 'br']).map((s) => s.toLowerCase()));
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    this.shape(x - 1, y - 1, x + w + 1, y + h + 1, c, alpha, (px, py) => {
      const left = px < x + rad, right = px > x + w - rad, top = py < y + rad, bottom = py > y + h - rad;
      let cx: number | null = null, cy = 0;
      if (left && top && on.has('tl')) { cx = x + rad; cy = y + rad; }
      else if (right && top && on.has('tr')) { cx = x + w - rad; cy = y + rad; }
      else if (left && bottom && on.has('bl')) { cx = x + rad; cy = y + h - rad; }
      else if (right && bottom && on.has('br')) { cx = x + w - rad; cy = y + h - rad; }
      if (cx !== null) return clamp01(rad - Math.hypot(px - cx, py - cy) + 0.5);
      const dx = Math.min(px - x, x + w - px), dy = Math.min(py - y, y + h - py);
      return clamp01(Math.min(dx, dy) + 0.5);
    });
  }

  private ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA, alpha: number): void {
    if (rx <= 0 || ry <= 0) return;
    this.shape(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, c, alpha, (px, py) => {
      const dx = px - cx, dy = py - cy;
      const k0 = Math.hypot(dx / rx, dy / ry), k1 = Math.hypot(dx / (rx * rx), dy / (ry * ry));
      if (k1 === 0) return 1;
      return clamp01(0.5 - (k0 * (k0 - 1)) / k1); // iq's distance estimate to the ellipse boundary
    });
  }

  /** Ring sector between r1 and r2, angles in degrees, 0 = up, clockwise. */
  private arc(cx: number, cy: number, r1: number, r2: number, a1: number, a2: number, c: RGBA, alpha: number): void {
    const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
    let span = ((a2 - a1) % 360 + 360) % 360;
    if (span === 0 && a2 !== a1) span = 360;
    const full = Math.abs(a2 - a1) >= 360;
    this.shape(cx - hi - 1, cy - hi - 1, cx + hi + 1, cy + hi + 1, c, alpha, (px, py) => {
      const dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy);
      const radial = clamp01(Math.min(d - lo, hi - d) + 0.5);
      if (radial <= 0) return 0;
      if (full) return radial;
      let ang = (Math.atan2(dx, -dy) * 180) / Math.PI;
      ang = (((ang - a1) % 360) + 360) % 360;
      const edge = ang <= span ? Math.min(ang, span - ang) : -Math.min(ang - span, 360 - ang);
      return Math.min(radial, clamp01((edge * Math.PI * d) / 180 + 0.5));
    });
  }

  private poly(p: number[], c: RGBA, alpha: number): void {
    const n = p.length / 2;
    if (n < 3) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, p[2 * i]); x1 = Math.max(x1, p[2 * i]); y0 = Math.min(y0, p[2 * i + 1]); y1 = Math.max(y1, p[2 * i + 1]); }
    this.shape(x0 - 1, y0 - 1, x1 + 1, y1 + 1, c, alpha, (px, py) => {
      let inside = false, dmin = Infinity;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        const ex = xj - xi, ey = yj - yi, l2 = ex * ex + ey * ey;
        const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - xi) * ex + (py - yi) * ey) / l2));
        dmin = Math.min(dmin, Math.hypot(px - (xi + u * ex), py - (yi + u * ey)));
      }
      return clamp01((inside ? 0.5 + dmin : 0.5 - dmin));
    });
  }

  private glow(cx: number, cy: number, r: number, c: RGBA, alpha: number): void {
    if (r <= 0) return;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d < 1) this.add(x, y, c, (1 - d) * (1 - d) * alpha);
    }
  }

  private grad(x: number, y: number, w: number, h: number, c1: RGBA, c2: RGBA, vertical: boolean, alpha: number): void {
    for (let j = Math.floor(y); j < y + h; j++) for (let i = Math.floor(x); i < x + w; i++) {
      const t = vertical ? (j + 0.5 - y) / h : (i + 0.5 - x) / w;
      const u = clamp01(t);
      this.blend(i, j, [c1[0] + (c2[0] - c1[0]) * u, c1[1] + (c2[1] - c1[1]) * u, c1[2] + (c2[2] - c1[2]) * u, (c1[3] + (c2[3] - c1[3]) * u) * alpha], 1);
    }
  }

  /** The same seed always gives the same sky; phase `t` makes about a third of the stars twinkle. */
  private stars(x: number, y: number, w: number, h: number, count: number, seed: number, phase: number, alpha: number): void {
    const rnd = mulberry32(Math.floor(seed) * 7919 + 17);
    for (let i = 0; i < count; i++) {
      const sx = x + rnd() * w, sy = y + rnd() * h, mag = 0.25 + rnd() * 0.75, tint = rnd(), tw = rnd(), sp = 1 + rnd() * 3;
      let b = mag;
      if (tw < 0.35) b *= 0.55 + 0.45 * Math.sin(phase * sp + i * 1.7);
      const col: RGBA = tint < 0.15 ? [0.75, 0.85, 1, 1] : tint < 0.25 ? [1, 0.88, 0.7, 1] : [1, 1, 1, 1];
      this.blend(Math.floor(sx), Math.floor(sy), col, clamp01(b) * alpha);
      if (mag > 0.9) { // a few bright stars get a cross
        this.blend(Math.floor(sx) + 1, Math.floor(sy), col, 0.35 * alpha);
        this.blend(Math.floor(sx) - 1, Math.floor(sy), col, 0.35 * alpha);
      }
    }
  }

  /** Reads one pixel (tests). */
  px(x: number, y: number): [number, number, number, number] {
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
}
