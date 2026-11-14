/** Easing functions, by the names used in /gfx anim ease=NAME. */
export type EaseFn = (t: number) => number;

const pow = (n: number): EaseFn => (t) => Math.pow(t, n);
const outOf = (f: EaseFn): EaseFn => (t) => 1 - f(1 - t);
const inOutOf = (f: EaseFn): EaseFn => (t) => (t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2);

const bounceOut: EaseFn = (t) => {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};
const backIn: EaseFn = (t) => 2.70158 * t * t * t - 1.70158 * t * t;
const elasticOut: EaseFn = (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1);

const base: Record<string, EaseFn> = {
  Quad: pow(2), Cubic: pow(3), Quart: pow(4), Quint: pow(5),
  Sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  Expo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  Circ: (t) => 1 - Math.sqrt(1 - t * t),
  Back: backIn,
  Elastic: outOf(elasticOut),
  Bounce: outOf(bounceOut),
};

export const EASES: Record<string, EaseFn> = { linear: (t) => t, smooth: (t) => t * t * (3 - 2 * t) };
for (const [n, f] of Object.entries(base)) {
  EASES['in' + n] = f;
  EASES['out' + n] = n === 'Elastic' ? elasticOut : n === 'Bounce' ? bounceOut : outOf(f);
  EASES['inOut' + n] = n === 'Elastic' || n === 'Bounce' ? inOutOf(outOf(f)) : inOutOf(f);
}
EASES.out = EASES.outCubic;
EASES.in = EASES.inCubic;
EASES.inOut = EASES.inOutCubic;

/** ease("steps(4)") and ease("cubic(x1,y1,x2,y2)") are parsed; unknown names are linear. */
export function easeFn(name: string | undefined): EaseFn {
  if (!name) return EASES.outCubic;
  const hit = EASES[name];
  if (hit) return hit;
  let m = /^steps\((\d+)\)$/.exec(name);
  if (m) {
    const n = +m[1];
    return (t) => Math.min(1, Math.floor(t * n) / n);
  }
  m = /^cubic\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)$/.exec(name);
  if (m) return cubicBezier(+m[1], +m[2], +m[3], +m[4]);
  return EASES.linear;
}

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number): number => ((ay * t + by) * t + cy) * t;
  const dx = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-5) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const e = sx(t);
      if (Math.abs(e - x) < 1e-5) break;
      if (x > e) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}
