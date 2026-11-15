import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SKINS } from '../src/cmcp/skins';
import { layoutSkinned } from '../src/cmcp/skinlayout';
import { place } from '../src/cmcp/layout';
import { draw, type Ctx } from '../src/cmcp/widgets';
import type { CmcpNode, CmcpUI } from '../src/cmcp/types';

const fx = (n: string): CmcpUI => JSON.parse(readFileSync(`public/cmcp/${n}.json`, 'utf8')) as CmcpUI;
const node = (id: string, text: string): CmcpNode => ({ path: id, id, widget: 'button', props: { text, tone: 'accent' }, layout: {}, enabled: true, events: ['click'] });
const tokens = { 'color.bg': '#000000', 'color.panel': '#101010', 'color.text': '#ffffff', 'color.dim': '#888888', 'color.accent': '#ff9900', 'color.accent2': '#33ccff', 'color.ok': '#00ff00', 'color.warn': '#ffff00', 'color.alert': '#ff0000', radius: 4 };

describe('scan mode tabs', () => {
  const root: CmcpNode = { path: 'r', widget: 'label', props: {}, layout: { dir: 'row' }, enabled: true, children: [node('tab_srs', 'SRS'), node('tab_lrs', 'LRS'), node('tab_passive', 'PASSIVE')] };
  const draw1 = (mode: string | undefined, skinned: boolean) => {
    const ctx = { tree: { tokens, ui: mode ? { scan_mode: mode } : {} } as never, local: new Map(), history: new Map(), images: new Map(), readonly: false, reduceMotion: true, ...(skinned ? { skin: SKINS.tng, pal: SKINS.tng.pal.normal } : {}) } as Ctx;
    return draw(place(root, { x: 0, y: 0, w: 600, h: 40 }), ctx).filter((p) => p.type === 'button');
  };
  it('draws the selected tab filled and the others outlined (default srs)', () => {
    for (const skinned of [false, true]) {
      const t = draw1('lrs', skinned);
      const filled = t.map((p) => p.props.fill !== tokens['color.panel']);
      expect(filled).toEqual([false, true, false]);
      expect(t[0].props.stroke).toBeTruthy();
      expect(t[1].props.stroke).toBeUndefined();
      expect(draw1(undefined, skinned).map((p) => p.props.fill !== tokens['color.panel'])).toEqual([true, false, false]);
    }
  });
});

describe('port.max_cols: the text is at most 80 columns wide in the side layout, the rest goes to the widgets', () => {
  it('caps the side port and widens the widget column; the stacked layout is untouched', () => {
    const skin = SKINS.tng;
    const ui = fx('command'); // dense: side layout
    const wide = layoutSkinned(ui.tree!.root, skin, 'command', false, 'balanced', Infinity)!;
    const capped = layoutSkinned(ui.tree!.root, skin, 'command', false, 'balanced', 600)!;
    expect(wide.mode).toBe('side');
    expect(capped.port[2]).toBe(600);
    expect(wide.port[2]).toBe(skin.side.port[2]);
    expect(capped.port[0] + capped.port[2]).toBeLessThan(wide.port[0] + wide.port[2]);
    // the freed width goes to the widget column: it starts right of the narrower port and is wider than before
    const colX = (l: typeof wide) => Math.min(...l.root.children.filter((c) => c.node.widget !== 'textport').map((c) => c.rect.x)) / 0.75;
    expect(colX(capped)).toBeLessThan(colX(wide));
    const stacked = layoutSkinned(fx('sensors').tree!.root, skin, 'sensors', false, 'balanced', 300)!;
    expect(stacked.mode).toBe('stack');
    expect(stacked.port[2]).toBe(skin.port.rect[2]);
  });
});
