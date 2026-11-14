/** 2D geometry: affine matrices, SVG path flattening, polygon triangulation, hit tests. */

/** Affine matrix [a b c d tx ty]: x' = a x + c y + tx, y' = b x + d y + ty. */
export type Mat = [number, number, number, number, number, number];

export const IDENT: Mat = [1, 0, 0, 1, 0, 0];

export function mul(p: Mat, c: Mat): Mat {
  return [
    p[0] * c[0] + p[2] * c[1], p[1] * c[0] + p[3] * c[1],
    p[0] * c[2] + p[2] * c[3], p[1] * c[2] + p[3] * c[3],
    p[0] * c[4] + p[2] * c[5] + p[4], p[1] * c[4] + p[3] * c[5] + p[5],
  ];
}

/** translate · rotate(deg) · scale · translate(-pivot) */
export function trs(x: number, y: number, rotDeg: number, sx: number, sy: number, px: number, py: number): Mat {
  const r = (rotDeg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const a = c * sx, b = s * sx, cc = -s * sy, d = c * sy;
  return [a, b, cc, d, x - (a * px + cc * py), y - (b * px + d * py)];
}

export function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  const id = 1 / det;
  const a = m[3] * id, b = -m[1] * id, c = -m[2] * id, d = m[0] * id;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Flattens an SVG path (M L H V C S Q T Z, absolute and relative; arcs as lines to the end point) to polylines. */
export function flattenPath(d: string, tol = 0.25): { pts: number[]; closed: boolean }[] {
  const toks = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: { pts: number[]; closed: boolean }[] = [];
  let cur: number[] = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, prev = '';
  const n = (): number => parseFloat(toks[i++]);
  const flush = (closed: boolean): void => {
    if (cur.length >= 4) out.push({ pts: cur, closed });
    cur = [];
  };
  const quad = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(2, Math.min(64, Math.ceil(Math.sqrt(len / tol))));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      cur.push(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
    }
  };
  const cubic = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
    const steps = Math.max(3, Math.min(96, Math.ceil(Math.sqrt(len / tol))));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      cur.push(
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      );
    }
  };
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (C) {
      case 'M': flush(false); x = ox + n(); y = oy + n(); sx = x; sy = y; cur.push(x, y); cmd = rel ? 'l' : 'L'; break;
      case 'L': x = ox + n(); y = oy + n(); cur.push(x, y); break;
      case 'H': x = (rel ? x : 0) + n(); cur.push(x, y); break;
      case 'V': y = (rel ? y : 0) + n(); cur.push(x, y); break;
      case 'C': {
        const x1 = ox + n(), y1 = oy + n(), x2 = ox + n(), y2 = oy + n(), x3 = ox + n(), y3 = oy + n();
        cubic(x, y, x1, y1, x2, y2, x3, y3); cx = x2; cy = y2; x = x3; y = y3; break;
      }
      case 'S': {
        const x1 = prev === 'C' || prev === 'S' ? 2 * x - cx : x, y1 = prev === 'C' || prev === 'S' ? 2 * y - cy : y;
        const x2 = ox + n(), y2 = oy + n(), x3 = ox + n(), y3 = oy + n();
        cubic(x, y, x1, y1, x2, y2, x3, y3); cx = x2; cy = y2; x = x3; y = y3; break;
      }
      case 'Q': {
        const x1 = ox + n(), y1 = oy + n(), x2 = ox + n(), y2 = oy + n();
        quad(x, y, x1, y1, x2, y2); cx = x1; cy = y1; x = x2; y = y2; break;
      }
      case 'T': {
        const x1 = prev === 'Q' || prev === 'T' ? 2 * x - cx : x, y1 = prev === 'Q' || prev === 'T' ? 2 * y - cy : y;
        const x2 = ox + n(), y2 = oy + n();
        quad(x, y, x1, y1, x2, y2); cx = x1; cy = y1; x = x2; y = y2; break;
      }
      case 'A': { n(); n(); n(); n(); n(); x = ox + n(); y = oy + n(); cur.push(x, y); break; }
      case 'Z': flush(true); x = sx; y = sy; cur.push(x, y); break;
      default: i++;
    }
    prev = C;
  }
  flush(false);
  return out;
}

/** Signed area (positive = clockwise in y-down coordinates). */
export function area(p: number[]): number {
  let a = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
  }
  return a / 2;
}

/** Ear-clipping triangulation of a simple polygon; returns vertex indices (triples). */
export function triangulate(p: number[]): number[] {
  const n = p.length / 2;
  if (n < 3) return [];
  const idx = Array.from({ length: n }, (_, i) => i);
  if (area(p) < 0) idx.reverse();
  const out: number[] = [];
  const cross = (a: number, b: number, c: number): number =>
    (p[2 * b] - p[2 * a]) * (p[2 * c + 1] - p[2 * a + 1]) - (p[2 * b + 1] - p[2 * a + 1]) * (p[2 * c] - p[2 * a]);
  const inTri = (a: number, b: number, c: number, q: number): boolean => {
    const d1 = cross(a, b, q), d2 = cross(b, c, q), d3 = cross(c, a, q);
    return d1 >= 0 && d2 >= 0 && d3 >= 0;
  };
  let guard = n * n;
  let i = 0;
  while (idx.length > 3 && guard-- > 0) {
    const m = idx.length;
    const a = idx[(i + m - 1) % m], b = idx[i % m], c = idx[(i + 1) % m];
    let ear = cross(a, b, c) > 1e-9;
    if (ear) {
      for (const q of idx) {
        if (q !== a && q !== b && q !== c && inTri(a, b, c, q)) { ear = false; break; }
      }
    }
    if (ear) { out.push(a, b, c); idx.splice(i % m, 1); i = 0; } else i++;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

export function pointInPolygon(p: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length / 2 - 1, n = p.length / 2; i < n; j = i++) {
    const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
