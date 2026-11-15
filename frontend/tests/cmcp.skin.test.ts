import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { skinFromTheme } from '../src/cmcp/skins/pack';
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

/** the same checks on the skins built from the theme packs' own gpu renditions (the pack format drives rendering) */
const PACK_DIR = '../../cmcp/examples/themes/';
const PACKS: Record<string, (typeof SKINS)[string]> = {};
for (const id of Object.keys(SKINS)) {
  const f = `${PACK_DIR}${id}.gpu.json`;
  if (existsSync(f)) PACKS[`pack:${id}`] = skinFromTheme(JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>, SKINS[id]).skin;
}

describe.each(Object.entries({ ...SKINS, ...PACKS }))('skin %s: the game text is the largest element and nothing overlaps', (_name, skin) => {
  it('gives the text at least 35% of the height and 60% of the width by default, about 80% of the height when expanded', () => {
    const [, , pw, ph] = skin.port.rect, [, , , eh] = skin.port.expanded;
    expect(ph / H).toBeGreaterThanOrEqual(0.35);
    expect(pw / W).toBeGreaterThanOrEqual(0.6);
    if (skin.source !== 'pack') expect(skin.side.port[2] / W).toBeGreaterThanOrEqual(0.6); // the side layout of dense screens keeps 60% of the width (a pack authors its own, ~48%)
    expect(eh / H).toBeGreaterThanOrEqual(0.76);
    expect(eh / H).toBeLessThanOrEqual(0.86);
  });
  it('keeps the port, its frame and its expanded state inside the scene and clear of the frame decoration, the nav column and the buttons', () => {
    // (a pack's decoration may sit behind the expanded text, and its jagged plates have coarse bounding boxes: those are checked on the table skins only)
    for (const r of skin.source === 'pack' ? [skin.port.rect] : [skin.port.rect, skin.port.expanded, skin.side.port]) {
      const ins = skin.source === 'pack' ? 0 : skin.port.frame.inset ?? 8;
      const fr = [r[0] - ins, r[1] - ins, r[2] + 2 * ins, r[3] + 2 * ins];
      expect(fr[0]).toBeGreaterThanOrEqual(0); expect(fr[1]).toBeGreaterThanOrEqual(0); expect(fr[0] + fr[2]).toBeLessThanOrEqual(W); expect(fr[1] + fr[3]).toBeLessThanOrEqual(H);
      // background panels (z < 0) and outline-only frames legitimately surround the port; any filled shape in front of it is a fault
    skin.frame.filter((s) => !(skin.source === 'pack' && s.t === 'polygon') && !(s.z !== undefined && s.z < 0) && ('fill' in s ? s.fill !== undefined && s.fill !== 'none' : false)).forEach((s) => bboxes(s).forEach((b) => expect(hit(fr, b), `frame shape ${s.id ?? s.t} covers the port`).toBe(false)));
      const b = skin.nav.button;
      skin.nav.items.forEach((_, i) => expect(hit(fr, [b.x, b.y + i * (b.dy ?? 0), b.w, b.h])).toBe(false));
      for (const x of [skin.log.button, skin.off.button, skin.alert ?? { ...skin.off.button, y: skin.off.button.y + 56 }]) expect(hit(fr, [x.x, x.y, x.w, x.h])).toBe(false);
    }
  });
  it('puts the widget band above/beside the port without overlap', () => {
    const [cx, cy, cw, ch] = skin.content, [px, py, pw, ph] = skin.port.rect;
    expect(hit([cx, cy, cw, ch], [px - 8, py - 8, pw + 16, ph + 16])).toBe(false);
    for (const [sel, r] of Object.values(skin.arrange).flatMap((a) => Object.entries(a))) expect(hit(r, [px - 8, py - 8, pw + 16, ph + 16]), `arrangement ${sel}`).toBe(false);
  });
  it.each(SCREENS)('lays out %s: widgets inside the band, none over the port or each other', (screen) => {
    const ui = fx(screen);
    for (const [expanded, pd] of [[false, 'balanced'], [true, 'balanced'], [false, 'large'], [false, 'compact']] as const) {
      const L = layoutSkinned(ui.tree!.root, skin, screen, expanded, pd)!;
      if (L.mode === 'stack' && !expanded) {
        const frac = L.port[3] / H;
        expect(frac).toBeGreaterThanOrEqual(pd === 'large' ? 0.5 : pd === 'balanced' ? 0.35 : 0.2 - 1e-9); // compact is the theme's own small text
      }
      expect(L).toBeTruthy();
      const port = [L.port[0] * K / L.scale, L.port[1] * K / L.scale, L.port[2] * K / L.scale, L.port[3] * K / L.scale];
      const portFrame = [port[0] - 8 * K / L.scale, port[1] - 8 * K / L.scale, port[2] + 16 * K / L.scale, port[3] + 16 * K / L.scale];
      const items = leaves(L.root).filter((p) => p.node.widget !== 'textport');
      const bc = L.mode === 'side' ? skin.side.content : [skin.content[0], skin.content[1], skin.content[2], L.port[1] - 8 - skin.content[1]];
      const band = [bc[0] * K / L.scale, bc[1] * K / L.scale, bc[2] * K / L.scale, bc[3] * K / L.scale];
      items.forEach((p) => {
        const r = [p.rect.x, p.rect.y, p.rect.w, p.rect.h];
        if (!expanded) {
          expect(hit(r, portFrame), `${screen}: ${p.node.widget} ${p.node.path} is over the text port`).toBe(false);
          if (pd === 'balanced') { // (the other sizes shrink the band; only the port clearance above applies)
            expect(r[0]).toBeGreaterThanOrEqual(band[0] - 1); expect(r[1]).toBeGreaterThanOrEqual(band[1] - 1);
            expect(r[0] + r[2]).toBeLessThanOrEqual(band[0] + band[2] + 1); expect(r[1] + r[3]).toBeLessThanOrEqual(band[1] + band[3] + 1);
          }
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
  it.each(SCREENS)('side layout by default (wide windows): %s keeps the text left at its cap, the widgets in the column, nothing over anything', (screen) => {
    const ui = fx(screen);
    for (const cap of [Infinity, 640]) {
      const L = layoutSkinned(ui.tree!.root, skin, screen, false, 'balanced', cap, true)!;
      expect(L.mode).toBe('side');
      expect(L.port[2]).toBeLessThanOrEqual(Math.max(300, cap) + 1e-6);
      expect(L.port[2] / W).toBeGreaterThan(0.3);
      const port = [L.port[0] * K / L.scale, L.port[1] * K / L.scale, L.port[2] * K / L.scale, L.port[3] * K / L.scale];
      const ins = (skin.port.frame.inset ?? 8) * K / L.scale;
      const frame = [port[0] - ins, port[1] - ins, port[2] + 2 * ins, port[3] + 2 * ins];
      const items = leaves(L.root).filter((p) => p.node.widget !== 'textport');
      items.forEach((p) => expect(hit([p.rect.x, p.rect.y, p.rect.w, p.rect.h], frame), `${screen}: ${p.node.widget} over the text port`).toBe(false));
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i].rect, b = items[j].rect;
        const inter = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        expect(inter, `${screen}: ${items[i].node.widget} overlaps ${items[j].node.widget}`).toBeLessThan(2);
      }
    }
  });
});
