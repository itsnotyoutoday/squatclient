import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SKINS } from '../src/cmcp/skins';
import { K, layoutSkinned } from '../src/cmcp/skinlayout';
import type { Placed } from '../src/cmcp/layout';
import type { CmcpUI } from '../src/cmcp/types';
import type { Shape } from '../src/cmcp/skins/types';

const SCREENS = ['operations', 'power', 'damage', 'sensors', 'tactical', 'helm', 'command', 'communications', 'medical', 'security', 'cargo', 'away', 'engineering', 'transporter'];
const fx = (n: string): CmcpUI => JSON.parse(readFileSync(`public/cmcp/${n}.json`, 'utf8')) as CmcpUI;
const W = 1600, H = 900;

const bboxes = (s: Shape): [number, number, number, number][] => {
  if (s.t === 'elbow') { // an L: the side column and the bar along the top or bottom
    const top = s.corner[0] === 't';
    return [[s.x, s.y, s.side, s.h], [s.x, top ? s.y : s.y + s.h - s.bar, s.w, s.bar]];
  }
  const b = bbox(s);
  return b ? [b] : [];
};
const bbox = (s: Shape): [number, number, number, number] | null => {
  switch (s.t) {
    case 'rect': return [s.x, s.y, s.w, s.h];
    case 'polygon': { const xs = s.points.filter((_, i) => i % 2 === 0), ys = s.points.filter((_, i) => i % 2 === 1); return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; }
    default: return null;
  }
};
const hit = (a: number[], b: number[]): boolean => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
const leaves = (p: Placed, out: Placed[] = []): Placed[] => { if (p.children.length === 0 && p.node.widget !== 'label') out.push(p); p.children.forEach((c) => leaves(c, out)); return out; };

describe.each(Object.entries(SKINS))('skin %s: the game text is the largest element and nothing overlaps', (_name, skin) => {
  it('gives the text at least 45% of the height and 60% of the width by default, about 80% of the height when expanded', () => {
    const [, , pw, ph] = skin.port.rect, [, , , eh] = skin.port.expanded;
    expect(ph / H).toBeGreaterThanOrEqual(0.45);
    expect(pw / W).toBeGreaterThanOrEqual(0.6);
    expect(skin.side.port[2] / W).toBeGreaterThanOrEqual(0.6); // the side layout of dense screens keeps 60% of the width
    expect(eh / H).toBeGreaterThanOrEqual(0.78);
    expect(eh / H).toBeLessThanOrEqual(0.86);
  });
  it('keeps the port, its frame and its expanded state inside the scene and clear of the frame decoration, the nav column and the buttons', () => {
    for (const r of [skin.port.rect, skin.port.expanded, skin.side.port]) {
      const fr = [r[0] - 8, r[1] - 8, r[2] + 16, r[3] + 16];
      expect(fr[0]).toBeGreaterThanOrEqual(0); expect(fr[1]).toBeGreaterThanOrEqual(0); expect(fr[0] + fr[2]).toBeLessThanOrEqual(W); expect(fr[1] + fr[3]).toBeLessThanOrEqual(H);
      skin.frame.forEach((s) => bboxes(s).forEach((b) => expect(hit(fr, b), `frame shape ${s.id ?? s.t} covers the port`).toBe(false)));
      const b = skin.nav.button;
      skin.nav.items.forEach((_, i) => expect(hit(fr, [b.x, b.y + i * (b.dy ?? 0), b.w, b.h])).toBe(false));
      for (const x of [skin.log.button, skin.off.button]) expect(hit(fr, [x.x, x.y, x.w, x.h])).toBe(false);
    }
  });
  it('puts the widget band above/beside the port without overlap', () => {
    const [cx, cy, cw, ch] = skin.content, [px, py, pw, ph] = skin.port.rect;
    expect(hit([cx, cy, cw, ch], [px - 8, py - 8, pw + 16, ph + 16])).toBe(false);
    for (const [sel, r] of Object.values(skin.arrange).flatMap((a) => Object.entries(a))) expect(hit(r, [px - 8, py - 8, pw + 16, ph + 16]), `arrangement ${sel}`).toBe(false);
  });
  it.each(SCREENS)('lays out %s: widgets inside the band, none over the port or each other', (screen) => {
    const ui = fx(screen);
    for (const expanded of [false, true]) {
      const L = layoutSkinned(ui.tree!.root, skin, screen, expanded)!;
      expect(L).toBeTruthy();
      const port = [L.port[0] * K / L.scale, L.port[1] * K / L.scale, L.port[2] * K / L.scale, L.port[3] * K / L.scale];
      const portFrame = [port[0] - 8 * K / L.scale, port[1] - 8 * K / L.scale, port[2] + 16 * K / L.scale, port[3] + 16 * K / L.scale];
      const items = leaves(L.root).filter((p) => p.node.widget !== 'textport');
      const bc = L.mode === 'side' ? skin.side.content : skin.content;
      const band = [bc[0] * K / L.scale, bc[1] * K / L.scale, bc[2] * K / L.scale, bc[3] * K / L.scale];
      items.forEach((p) => {
        const r = [p.rect.x, p.rect.y, p.rect.w, p.rect.h];
        if (!expanded) {
          expect(hit(r, portFrame), `${screen}: ${p.node.widget} ${p.node.path} is over the text port`).toBe(false);
          expect(r[0]).toBeGreaterThanOrEqual(band[0] - 1); expect(r[1]).toBeGreaterThanOrEqual(band[1] - 1);
          expect(r[0] + r[2]).toBeLessThanOrEqual(band[0] + band[2] + 1); expect(r[1] + r[3]).toBeLessThanOrEqual(band[1] + band[3] + 1);
        }
      });
      if (!expanded) {
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
          const a = items[i].rect, b = items[j].rect;
          const inter = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          expect(inter, `${screen}: ${items[i].node.widget} ${items[i].node.path} overlaps ${items[j].node.widget} ${items[j].node.path}`).toBeLessThan(2);
        }
      }
    }
  });
});
