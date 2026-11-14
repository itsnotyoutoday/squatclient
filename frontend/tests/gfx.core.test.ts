import { describe, expect, it } from 'vitest';
import { parseColor, toHex, mixColor, xterm256 } from '../src/gfx/color';
import { easeFn, EASES } from '../src/gfx/ease';
import { compileExpr, compileTemplate, sprintf, type EvalCtx } from '../src/gfx/expr';
import { flattenPath, triangulate, area, pointInPolygon, trs, invert, apply, mul } from '../src/gfx/geom';

const ctx = (vars: Record<string, string | number>, time = 0): EvalCtx => ({ get: (n) => vars[n], time });

describe('colors', () => {
  it('parses hex, rgb(), names, 256 and rejects garbage visibly', () => {
    expect(toHex(parseColor('#f90'))).toBe('#ff9900');
    expect(parseColor('#ff990080')[3]).toBeCloseTo(0.5, 1);
    expect(toHex(parseColor('rgb(255, 0, 128)'))).toBe('#ff0080');
    expect(toHex(parseColor('orange'))).toBe('#ff9900');
    expect(toHex(xterm256(196))).toBe('#ff0000');
    expect(toHex(parseColor('256:244'))).toBe('#808080');
    expect(parseColor('nonsense')).toEqual([1, 0, 1, 1]);
    expect(parseColor('none')[3]).toBe(0);
  });
  it('mixes', () => {
    expect(toHex(mixColor(parseColor('#000000'), parseColor('#ffffff'), 0.5))).toBe('#808080');
  });
});

describe('easing', () => {
  it('hits the endpoints and is monotone for the common curves', () => {
    for (const n of ['linear', 'inQuad', 'outCubic', 'inOutSine', 'outExpo', 'inOutQuart', 'smooth']) {
      const f = easeFn(n);
      expect(f(0)).toBeCloseTo(0, 5);
      expect(f(1)).toBeCloseTo(1, 5);
      let prev = -1;
      for (let t = 0; t <= 1; t += 0.05) { expect(f(t)).toBeGreaterThanOrEqual(prev - 1e-9); prev = f(t); }
    }
    expect(Object.keys(EASES).length).toBeGreaterThan(30);
  });
  it('overshoot curves go past 1 and steps() is a staircase', () => {
    expect(Math.max(...[...Array(50)].map((_, i) => easeFn('outElastic')(i / 49)))).toBeGreaterThan(1);
    expect(easeFn('steps(4)')(0.3)).toBe(0.25);
    expect(easeFn('cubic(0.25,0.1,0.25,1)')(0.5)).toBeGreaterThan(0.5);
    expect(easeFn('bogus')(0.4)).toBe(0.4);
  });
});

describe('expressions', () => {
  it('does arithmetic, precedence, ternaries and strings', () => {
    const v = { a: 4, b: '6', s: 'red', hp: 30 };
    const c = ctx(v);
    expect(compileExpr('a * (b + 1) - 2 ** 3').run(c)).toBe(20);
    expect(compileExpr('s == "red" ? "#ff0000" : "#ff9900"').run(c)).toBe('#ff0000');
    expect(compileExpr('hp < 50 && a > 3').run(c)).toBe(1);
    expect(compileExpr('"X" + a').run(c)).toBe('X4');
    expect(compileExpr('a + b').run(c)).toBe(10); // numeric strings add as numbers
    expect(compileExpr('clamp(hp * 4, 0, 100)').run(c)).toBe(100);
    expect(compileExpr('mod(-1, 360)').run(c)).toBe(359);
    expect(compileExpr('1/0').run(c)).toBe(0);
    expect(compileExpr('color("#000000", "#ffffff", 0.5)').run(c)).toBe('#808080');
  });
  it('tracks dependencies and volatility', () => {
    const e = compileExpr('lc_core * 2 + sin(time())');
    expect([...e.deps]).toEqual(['lc_core']);
    expect(e.volatile).toBe(true);
    expect(compileExpr('a + gmcp:Char.Vitals.hp').deps).toEqual(new Set(['a', 'gmcp:Char.Vitals.hp']));
    expect(compileExpr('x').volatile).toBe(false);
  });
  it('reports syntax errors instead of guessing', () => {
    expect(() => compileExpr('1 +')).toThrow();
    expect(() => compileExpr('foo(')).toThrow();
    expect(() => compileExpr('nofunc(1)')).toThrow(/unknown function/);
    expect(() => compileExpr('1 2')).toThrow();
    expect(() => compileExpr('"open')).toThrow();
  });
  it('formats printf specs', () => {
    expect(sprintf('%5.1f', 3.14159)).toBe('  3.1');
    expect(sprintf('%03d', 7)).toBe('007');
    expect(sprintf('%-4d|', 7)).toBe('7   |');
    expect(sprintf('%+d', 3)).toBe('+3');
    expect(sprintf('%s!', 'x')).toBe('x!');
  });
  it('renders templates with filters', () => {
    const t = compileTemplate('STARDATE {lc_sd|%.1f}  {lc_alert|upper} \\{literal\\} {a > 1 || b}');
    expect(t.run(ctx({ lc_sd: 47634.456, lc_alert: 'red', a: 2 }))).toBe('STARDATE 47634.5  RED {literal} 1');
    expect([...t.deps].sort()).toEqual(['a', 'b', 'lc_alert', 'lc_sd']);
    expect(compileTemplate('{n|pad:-6}|').run(ctx({ n: 'ab' }))).toBe('ab    |');
    expect(compileTemplate('{n|default:none}').run(ctx({}))).toBe('none');
    expect(() => compileTemplate('{oops')).toThrow();
  });
});

describe('geometry', () => {
  it('flattens curves and closes paths', () => {
    const p = flattenPath('M0 0 L10 0 L10 10 Z M20 20 C 20 30 30 30 30 20');
    expect(p).toHaveLength(2);
    expect(p[0].closed).toBe(true);
    expect(p[1].pts.length).toBeGreaterThan(10);
    expect(p[1].pts.slice(-2)).toEqual([30, 20]);
    expect(flattenPath('m1 1 h5 v5')[0].pts).toEqual([1, 1, 6, 1, 6, 6]);
  });
  it('triangulates a concave polygon without overlap', () => {
    const poly = [0, 0, 10, 0, 10, 10, 5, 4, 0, 10];
    const tri = triangulate(poly);
    expect(tri.length).toBe(9);
    let sum = 0;
    for (let i = 0; i < tri.length; i += 3) {
      sum += Math.abs(area([poly[2 * tri[i]], poly[2 * tri[i] + 1], poly[2 * tri[i + 1]], poly[2 * tri[i + 1] + 1], poly[2 * tri[i + 2]], poly[2 * tri[i + 2] + 1]]));
    }
    expect(sum).toBeCloseTo(Math.abs(area(poly)), 6);
    expect(pointInPolygon(poly, 5, 2)).toBe(true);
    expect(pointInPolygon(poly, 5, 8)).toBe(false);
  });
  it('composes and inverts transforms', () => {
    const m = trs(100, 50, 90, 2, 2, 5, 0);
    const [x, y] = apply(m, 5, 0);
    expect([Math.round(x), Math.round(y)]).toEqual([100, 50]); // the pivot lands on the position
    const inv = invert(m)!;
    const [bx, by] = apply(inv, ...apply(m, 7, 3));
    expect(bx).toBeCloseTo(7); expect(by).toBeCloseTo(3);
    const [cx, cy] = apply(mul(m, trs(1, 2, 0, 1, 1, 0, 0)), 0, 0);
    expect(Number.isFinite(cx + cy)).toBe(true);
  });
});
