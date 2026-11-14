import { describe, expect, it } from 'vitest';
import { holeClip, portRect, viewFit } from '../src/gfx/port';

const cfg = (o: object = {}) => ({ w: 1600, h: 900, fit: 'contain' as const, port: [240, 640, 860, 182] as [number, number, number, number], ...o });

describe('text port geometry', () => {
  it('letterboxes the scene (contain) and maps the port into CSS pixels', () => {
    const v = viewFit(cfg(), 800, 800); // wide scene in a square box: scale 0.5, bars top and bottom
    expect(v.sx).toBeCloseTo(0.5);
    expect(v.oy).toBeCloseTo(175);
    const r = portRect(cfg(), 800, 800)!;
    expect(r).toEqual({ x: 120, y: 175 + 320, w: 430, h: 91 });
  });
  it('is scale-consistent: the port keeps its place in the picture at every pane shape', () => {
    for (const [w, h] of [[1500, 420], [1100, 560], [520, 700]]) {
      const v = viewFit(cfg(), w, h), r = portRect(cfg(), w, h)!;
      expect((r.x - v.ox) / v.sx).toBeCloseTo(240);
      expect((r.y - v.oy) / v.sy).toBeCloseTo(640);
      expect(r.w / v.sx).toBeCloseTo(860);
    }
  });
  it('handles cover and stretch and returns null without a usable port', () => {
    expect(portRect(cfg({ fit: 'stretch' }), 1600, 450)!.h).toBeCloseTo(91);
    expect(portRect(cfg({ fit: 'cover' }), 800, 800)!.w).toBeGreaterThan(430);
    expect(portRect(cfg({ port: undefined }), 800, 800)).toBeNull();
    expect(portRect(cfg({ port: 'none' as unknown as undefined }), 800, 800)).toBeNull();
    expect(portRect(cfg(), 0, 0)).toBeNull();
  });
  it('cuts a hole out of the canvas with an even-odd clip', () => {
    const c = holeClip({ w: 100, h: 50 }, { x: 10, y: 10, w: 20, h: 20 });
    expect(c.startsWith('polygon(evenodd,')).toBe(true);
    expect(c).toContain('10px 10px');
    expect(c).toContain('30px 30px');
  });
});

describe('wide-short panes keep the whole frame, the text port and the input line inside the pane', () => {
  const full = (o: object = {}) => ({ w: 1600, h: 900, fit: 'contain' as const, dock: 'full' as const, port: [240, 640, 860, 182] as [number, number, number, number], inputPort: [492, 826, 762, 60] as [number, number, number, number], ...o });
  for (const [w, h] of [[1500, 640], [1800, 500], [1300, 560], [1100, 720], [2400, 700]]) {
    it(`${w}x${h}`, async () => {
      const { planScene, MIN_TEXT } = await import('../src/gfx/port');
      const p = planScene(full(), { w, h });
      if (p.mode === 'hidden') return; // allowed: the text takes the whole pane
      expect(p.mode).toBe('frame');
      if (p.mode !== 'frame') return;
      for (const r of [p.out, p.input!]) {
        expect(r.x).toBeGreaterThanOrEqual(-0.5);
        expect(r.y).toBeGreaterThanOrEqual(-0.5);
        expect(r.x + r.w).toBeLessThanOrEqual(w + 0.5);
        expect(r.y + r.h).toBeLessThanOrEqual(h + 0.5);
      }
      expect(p.input!.h).toBeGreaterThanOrEqual(34);
      expect(p.out.h).toBeGreaterThanOrEqual(MIN_TEXT.h);
      const v = viewFit(full(), w, h); // the whole scene fits: scaled by the limiting dimension, never by width alone
      expect(v.sx * 1600).toBeLessThanOrEqual(w + 0.5);
      expect(v.sy * 900).toBeLessThanOrEqual(h + 0.5);
    });
  }
});
