import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SKINS } from '../src/cmcp/skins';
import { K, MIN_SCALE, layoutSkinned } from '../src/cmcp/skinlayout';
import type { Placed } from '../src/cmcp/layout';
import type { CmcpNode, CmcpUI } from '../src/cmcp/types';

const SCREENS = ['operations', 'power', 'damage', 'sensors', 'tactical', 'helm', 'command', 'communications', 'medical', 'security', 'cargo', 'away', 'engineering', 'transporter'];
const LIVE = ['nhaalveth-opera', 'drakhar-sci', 'goldenmargin-opera', 'nhaalveth-helm']; // the game's own layout-pack screens, from a live session
const tree = (name: string): { root: CmcpNode; screen: string } => {
  if (name.startsWith('live-')) {
    const t = (JSON.parse(readFileSync(`public/cmcp/${name}.tree.json`, 'utf8')) as { tree: { root: CmcpNode; screen: string } }).tree;
    return { root: t.root, screen: t.screen.split(/[./]/).pop() ?? '' };
  }
  return { root: (JSON.parse(readFileSync(`public/cmcp/${name}.json`, 'utf8')) as CmcpUI).tree!.root, screen: name };
};
const hit = (a: number[], b: number[]): boolean => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
const leaves = (p: Placed, out: Placed[] = []): Placed[] => { if (p.children.length === 0 && p.node.widget !== 'label') out.push(p); p.children.forEach((c) => leaves(c, out)); return out; };
const WIDTHS = [1100, 1300, 1600];

const lows: string[] = [];
describe.each(Object.entries(SKINS))('side layout, skin %s', (_n, skin) => {
  it.each([...SCREENS, ...LIVE.map((l) => `live-${l}`)])('%s: nothing overlaps at 1100, 1300 and 1600 px; the text stays readable (paged when it cannot fit); every widget is on a page', (name) => {
    const { root, screen } = tree(name);
    for (const w of WIDTHS) {
      const k = w / 1600, cap = (80 * 0.6 * 14 + 28) / k; // port.max_cols 80 at 14 px mono (CSS px)
      const first = layoutSkinned(root, skin, screen, false, 'balanced', cap, true, 0)!;
      if (!first.narrow) expect(first.mode).toBe('side'); // (a window too narrow for 80 columns beside a widget column is stacked, or, for a screen too dense for that, flagged)
      const count = first.pages?.count ?? 1;
      const seen = new Set<string>();
      for (let pg = 0; pg < count; pg++) {
        const L = layoutSkinned(root, skin, screen, false, 'balanced', cap, true, pg)!;
        expect(L.pages?.index ?? 0).toBe(pg);
        const sp = skin.side.content;
        const port = [L.port[0] * K / L.scale, L.port[1] * K / L.scale, L.port[2] * K / L.scale, L.port[3] * K / L.scale];
        const ins = (skin.port.frame.inset ?? 8) * K / L.scale;
        const frame = [port[0] - ins, port[1] - ins, port[2] + 2 * ins, port[3] + 2 * ins];
        const items = leaves(L.root).filter((p) => p.node.widget !== 'textport');
        items.forEach((p) => {
          seen.add(p.node.path);
          expect(hit([p.rect.x, p.rect.y, p.rect.w, p.rect.h], frame), `${name}@${w} p${pg}: ${p.node.widget} over the text port`).toBe(false);
        });
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
          const a = items[i].rect, b = items[j].rect;
          const inter = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          expect(inter, `${name}@${w} p${pg}: ${items[i].node.widget} overlaps ${items[j].node.widget}`).toBeLessThan(2);
        }
        // readable: never below the minimum scale unless one single panel is taller than the whole column
        if (L.scale < MIN_SCALE - 1e-9) lows.push(`${_n}/${name}@${w} p${pg}: ${L.scale.toFixed(2)}`);
        expect(L.scale, `${name}@${w} p${pg}`).toBeGreaterThanOrEqual(0.55);
        if (L.pager) {
          const pr = [L.pager[0] * K, L.pager[1] * K, L.pager[2] * K, L.pager[3] * K];
          items.forEach((p) => expect(hit([p.rect.x * L.scale, p.rect.y * L.scale, p.rect.w * L.scale, p.rect.h * L.scale], pr), `${name}@${w}: ${p.node.widget} under the pager`).toBe(false));
          expect(L.pager[1] + L.pager[3]).toBeLessThanOrEqual(sp[1] + sp[3]);
        }
      }
      // every widget of the screen is on exactly one of the pages
      const all = (n: CmcpNode, o: string[] = []): string[] => { if (!(n.children ?? []).length && n.widget !== 'label' && n.widget !== 'textport') o.push(n.path); (n.children ?? []).forEach((c) => all(c, o)); return o; };
      for (const path of all(root)) expect(seen.has(path), `${name}@${w}: ${path} is on no page`).toBe(true);
    }
  });
});

it('no page is drawn below the readable scale', () => { expect(lows).toEqual([]); });

describe.each(Object.entries(SKINS))('the text pane is at least max_cols columns wide, skin %s', (_n, skin) => {
  it.each([1100, 1200, 1300, 1600, 1920, 2560])('at %i px wide (14 px mono, port.max_cols 80)', (w) => {
    const k = w / 1600, mono = 14, cols = (px: number): number => (px - 28) / (0.6 * mono);
    const cap = (80 * 0.6 * mono + 28) / k; // the engine's cap in CSS px of the pane font (max_cols x 0.6 x font), plus the pane's padding
    const { root, screen } = tree('operations');
    const L = layoutSkinned(root, skin, screen, false, 'balanced', cap, true)!;
    // side when the window leaves room for a widget column beside 80 columns, else the stacked layout (the text takes the full width)
    // a dense screen in a narrow window keeps the side layout (flagged); every other case has the full 80 columns
    if (L.narrow && L.mode === 'side') return;
    expect(cols(L.port[2] * k), `${L.mode}${L.narrow ? ' (narrow window)' : ''}: pane ${Math.round(L.port[2] * k)} px`).toBeGreaterThanOrEqual(80 - 0.5);
  });
});
