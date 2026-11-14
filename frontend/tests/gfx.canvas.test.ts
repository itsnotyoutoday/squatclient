import { describe, expect, it } from 'vitest';
import { PixelCanvas } from '../src/gfx/canvas';

const draw = (c: PixelCanvas, cmd: string, args: number[], extra: Record<string, unknown> = {}): void =>
  c.apply({ op: 'draw', cmd, args, ...extra });

describe('/canvas rasteriser', () => {
  it('draws filled rectangles exactly and alpha-composites', () => {
    const c = new PixelCanvas(8, 4, '#000000');
    draw(c, 'fill', [1, 1, 3, 2], { color: '#ff0000' });
    expect(c.px(1, 1)).toEqual([255, 0, 0, 255]);
    expect(c.px(0, 0)).toEqual([0, 0, 0, 255]);
    draw(c, 'fill', [1, 1, 1, 1], { color: '#0000ff', alpha: 0.5 });
    const p = c.px(1, 1);
    expect(p[0]).toBeGreaterThan(100); expect(p[2]).toBeGreaterThan(100);
  });
  it('anti-aliases a disc: full inside, partial on the edge, empty outside', () => {
    const c = new PixelCanvas(20, 20);
    draw(c, 'disc', [10, 10, 5], { color: '#ffffff' });
    expect(c.px(10, 10)[3]).toBe(255);
    expect(c.px(0, 0)[3]).toBe(0);
    const edge = c.px(15, 10)[3]; // centre x=15.5: 5.5 from the middle
    expect(edge).toBeLessThan(255);
    const mid = c.px(13, 10)[3];
    expect(mid).toBe(255);
    let partial = 0;
    for (let i = 0; i < c.data.length; i += 4) if (c.data[i + 3] > 0 && c.data[i + 3] < 255) partial++;
    expect(partial).toBeGreaterThan(10);
  });
  it('draws a ring (circle t=) with an empty middle', () => {
    const c = new PixelCanvas(30, 30);
    draw(c, 'circle', [15, 15, 10], { color: '#fff', t: 2 });
    expect(c.px(15, 15)[3]).toBe(0);
    expect(c.px(25, 15)[3]).toBeGreaterThan(100);
  });
  it('rounded corners are selected with corners=', () => {
    const c = new PixelCanvas(20, 10);
    draw(c, 'rrect', [0, 0, 20, 10, 5], { color: '#fff', corners: ['tl'] });
    expect(c.px(0, 0)[3]).toBeLessThan(40);   // top-left is cut
    expect(c.px(19, 0)[3]).toBe(255);         // top-right stays square
    expect(c.px(0, 9)[3]).toBe(255);
    const full = new PixelCanvas(20, 10);
    draw(full, 'rrect', [0, 0, 20, 10, 5], { color: '#fff' });
    expect(full.px(19, 9)[3]).toBeLessThan(40);
  });
  it('arcs are 0 = up, clockwise, between the radii', () => {
    const c = new PixelCanvas(40, 40);
    draw(c, 'arc', [20, 20, 8, 12, 0, 90], { color: '#fff' }); // upper right quadrant
    expect(c.px(26, 12)[3]).toBeGreaterThan(200);  // up-right
    expect(c.px(14, 12)[3]).toBe(0);               // up-left
    expect(c.px(20, 20)[3]).toBe(0);               // inside the inner radius
    expect(c.px(26, 28)[3]).toBe(0);               // down-right
  });
  it('fills polygons with anti-aliased edges', () => {
    const c = new PixelCanvas(20, 20);
    draw(c, 'poly', [2, 2, 18, 2, 10, 18], { color: '#fff' });
    expect(c.px(10, 5)[3]).toBe(255);
    expect(c.px(2, 17)[3]).toBe(0);
  });
  it('lines have thickness, glow is additive, gradients ramp', () => {
    const c = new PixelCanvas(30, 10);
    draw(c, 'line', [0, 5, 30, 5], { color: '#fff', t: 3 });
    expect(c.px(15, 5)[3]).toBe(255); expect(c.px(15, 9)[3]).toBe(0);
    const g = new PixelCanvas(10, 2, '#000000');
    draw(g, 'glow', [5, 1, 4], { color: '#ff0000', alpha: 1 });
    const hot = g.px(5, 1)[0], cool = g.px(8, 1)[0];
    expect(hot).toBeGreaterThan(cool);
    const r = new PixelCanvas(10, 2);
    draw(r, 'grad', [0, 0, 10, 2], { color: '#000000', color2: '#ffffff', vertical: false });
    expect(r.px(0, 0)[0]).toBeLessThan(r.px(9, 0)[0]);
  });
  it('stars are deterministic per seed and differ between seeds', () => {
    const mk = (seed: number): PixelCanvas => { const c = new PixelCanvas(60, 20, '#000000'); draw(c, 'stars', [0, 0, 60, 20], { count: 40, seed }); return c; };
    expect(Array.from(mk(7).data)).toEqual(Array.from(mk(7).data));
    expect(Array.from(mk(7).data)).not.toEqual(Array.from(mk(8).data));
    expect(mk(7).data.some((v, i) => i % 4 === 0 && v > 0)).toBe(true);
  });
  it('clear resets pixels and text; text is stored on the cell grid', () => {
    const c = new PixelCanvas(10, 4, '#112233');
    draw(c, 'text', [2, 1], { color: '#fff', text: 'HI  THERE', bold: true });
    expect(c.texts).toHaveLength(1);
    expect(c.texts[0]).toMatchObject({ cx: 2, cy: 1, text: 'HI  THERE', bold: true });
    draw(c, 'clear', []);
    expect(c.texts).toHaveLength(0);
    expect(c.px(3, 3)).toEqual([17, 34, 51, 255]);
    draw(c, 'clear', [], { color: '#000000' });
    expect(c.px(3, 3)).toEqual([0, 0, 0, 255]);
  });
  it('ignores drawing outside the buffer', () => {
    const c = new PixelCanvas(4, 4);
    expect(() => { draw(c, 'disc', [-10, -10, 3], { color: '#fff' }); draw(c, 'px', [99, 99], { color: '#fff' }); }).not.toThrow();
  });
  it('bumps its version on every change so the renderer re-uploads', () => {
    const c = new PixelCanvas(4, 4);
    const v = c.version;
    draw(c, 'px', [1, 1], { color: '#fff' });
    expect(c.version).toBe(v + 1);
  });
});
