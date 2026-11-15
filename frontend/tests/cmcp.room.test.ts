import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GfxRuntime } from '../src/gfx/runtime';
import { MockEngine } from '../src/api/mock';
import { CmcpController } from '../src/cmcp/controller';
import { SKINS } from '../src/cmcp/skins';
import { K, layoutSkinned } from '../src/cmcp/skinlayout';
import type { CmcpNode, CmcpUI } from '../src/cmcp/types';
import type { GfxOp } from '../src/api/types';

/** the engine's room screen: aboard a ship without a console (a room, the dock, away) a title and the text port in the ship's frame */
const roomRoot = (): CmcpNode => ({ path: '0', widget: 'label', props: { text: '' }, layout: { dir: 'col', gap: 6 }, enabled: true, children: [
  { path: '0.0', widget: 'label', props: { text: 'ABOARD RESOLUTE' }, layout: {}, enabled: true },
  { path: '0.1', id: 'text', widget: 'textport', props: {}, layout: { size: 160, hasSize: true }, enabled: true },
] });

describe('the room screen (aboard, no console)', () => {
  it.each(Object.keys(SKINS))('lays out in %s with the text port clear of the frame, side and stacked', (name) => {
    for (const side of [false, true]) {
      const L = layoutSkinned(roomRoot(), SKINS[name], 'room', false, 'balanced', Infinity, side)!;
      expect(L).toBeTruthy();
      expect(L.port[2]).toBeGreaterThan(300);
      expect(L.mode).toBe(side ? 'side' : 'stack');
      expect(K).toBeGreaterThan(0);
    }
  });

  const run = (alert: string) => {
    const engine = new MockEngine();
    const rt = new GfxRuntime();
    rt.paused = true;
    const ops: GfxOp[] = [];
    const apply = rt.apply.bind(rt);
    rt.apply = (o: GfxOp[]): void => { ops.push(...o); apply(o); };
    const ctl = new CmcpController(engine, () => rt);
    ctl.attach();
    const ui = { ...(JSON.parse(readFileSync('public/cmcp/sensors.json', 'utf8')) as CmcpUI), session: 's1', alert, status: { alert, hull: { cur: 90, max: 100 }, name: 'Resolute' }, commands: [], screens: [] } as CmcpUI;
    ui.tree = { ...ui.tree!, session: 's1', screen: 'std.room', title: 'ABOARD RESOLUTE', theme: 'tng', root: roomRoot(), ui: {} };
    engine.pushCmcp(ui);
    const fin = (id: string): Record<string, unknown> | undefined => {
      let cur: Record<string, unknown> | undefined;
      for (const o of ops) {
        if (o.op === 'create' && o.id === id) cur = { ...(o.props as Record<string, unknown>), parent: o.parent };
        else if (o.op === 'set' && o.id === id && cur) Object.assign(cur, o.props);
        else if (o.op === 'tween' && o.target === id && cur) for (const [k, v] of Object.entries(o.tracks as Record<string, { to: unknown }>)) cur[k] = v.to;
      }
      return cur;
    };
    return { engine, fin, ops };
  };

  it('draws the ship frame, the text port and the alert pill, and the frame shakes on a hit but the text port does not', () => {
    const { engine, fin } = run('yellow');
    expect(fin('cmcp.port')).toBeTruthy();
    expect(fin('portframe')?.parent).toBe('shk');
    expect(fin('alertbtn')).toBeTruthy();
    engine.pushCmcpPulse({ session: 's1', active: false, level: 1, phase: 'on', shake: { active: true, x: 4.8, y: -2 }, ambient: { edge: '#ffcc33', roles: ['r', 'x'], hueBg: '#201a05' } });
    expect(fin('shk')).toMatchObject({ x: 4.8, y: -2 });
    expect(fin('cmcp.port')?.parent).toBeUndefined();
    expect(fin('alertedge')?.stroke).toBe('#ffcc33');
  });
});
