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

describe('a ship room does not look like a console', () => {
  const runRoom = (view?: 'off') => {
    const engine = new MockEngine();
    const rt = new GfxRuntime();
    rt.paused = true;
    const ops: GfxOp[] = [];
    const apply = rt.apply.bind(rt);
    rt.apply = (o: GfxOp[]): void => { ops.push(...o); apply(o); };
    const ctl = new CmcpController(engine, () => rt);
    ctl.attach();
    const ui = { ...(JSON.parse(readFileSync('public/cmcp/sensors.json', 'utf8')) as CmcpUI), session: 's1', alert: 'green', status: { alert: 'green', name: 'Resolute' }, commands: [],
      screens: [{ id: 'std.operations', title: 'Ops', available: true, active: false }, { id: 'std.shiproom', title: 'Room', available: true, active: true }],
      stack: [{ key: 'room:shiproom', kind: 'room', id: 'shiproom', name: 'Mess Hall', screen: 'std.shiproom', active: true }] } as unknown as CmcpUI;
    ui.tree = { ...ui.tree!, session: 's1', screen: 'std.shiproom', title: 'Ship room', theme: 'tng', root: roomRoot(), ui: {}, view: { state: view ?? 'balanced', portDefault: 'balanced', fraction: 0.35 } as never };
    engine.pushCmcp(ui);
    return { engine, ctl, ui, rt, ops };
  };
  const created = (ops: GfxOp[], id: string): Record<string, unknown> | undefined => ops.filter((o) => o.op === 'create' && o.id === id).at(-1)?.props as Record<string, unknown> | undefined;

  it('has no console tabs, a ROOM tag, the room\'s name as its title and no CONSOLE word', () => {
    const { ops } = runRoom();
    expect(created(ops, 'nv.room')?.text).toBe('ROOM');
    expect(ops.some((o) => o.op === 'create' && String(o.id).startsWith('nv.nav'))).toBe(false); // no SENSORS / POWER / TACTICAL tabs
    const texts = ops.filter((o) => o.op === 'create' && String(o.id).startsWith('fr.')).map((o) => String((o.props as { text?: string }).text ?? ''));
    expect(texts.some((t) => t.includes('MESS HALL'))).toBe(true);
    expect(texts.some((t) => /CONSOLE/i.test(t))).toBe(false);
  });

  it('SCREEN OFF hides it though the game never pops the context, and it stays hidden through every later update', () => {
    const { engine, rt, ui } = runRoom('off');
    expect(rt.slot('cmcp').scene.cfg.open).toBe(false);
    engine.pushCmcp({ ...ui, rev: ui.rev + 1 });
    engine.pushCmcp({ ...ui, rev: ui.rev + 2, status: { alert: 'red', name: 'Resolute' } as never });
    expect(rt.slot('cmcp').scene.cfg.open).toBe(false);
  });
});
