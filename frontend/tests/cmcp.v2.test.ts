import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GfxRuntime } from '../src/gfx/runtime';
import { MockEngine } from '../src/api/mock';
import { CmcpController } from '../src/cmcp/controller';
import type { CmcpNode, CmcpUI } from '../src/cmcp/types';
import type { GfxOp } from '../src/api/types';

// CMCP 2: the ship console frame (nav column, hull and core strip, alert pill) belongs to the ship scope; a context of another scope
// (the concourse) is drawn plain: its title, its widgets and the game's text.
const root = (): CmcpNode => ({
  path: '0',
  widget: 'label',
  props: { text: '' },
  layout: { dir: 'col', gap: 6 },
  enabled: true,
  children: [
    { path: '0.0', widget: 'label', props: { text: 'SPACEDOCK CONCOURSE' }, layout: {}, enabled: true },
    {
      path: '0.1',
      id: 'text',
      widget: 'textport',
      props: {},
      layout: { size: 160, hasSize: true },
      enabled: true,
    },
  ],
});

const run = (scope: string, type: string) => {
  const engine = new MockEngine();
  const rt = new GfxRuntime();
  rt.paused = true;
  const ops: GfxOp[] = [];
  const apply = rt.apply.bind(rt);
  rt.apply = (o: GfxOp[]): void => {
    ops.push(...o);
    apply(o);
  };
  const ctl = new CmcpController(engine, () => rt);
  ctl.attach();
  const base = JSON.parse(readFileSync('public/cmcp/sensors.json', 'utf8')) as CmcpUI;
  const ui = {
    ...base,
    session: 's1',
    v2: true,
    proto: 2,
    ship: undefined,
    console: undefined,
    status: undefined,
    alert: undefined,
    scopes: {
      world: { owner: { id: 'testgame', epoch: 1 } },
      ship: { owner: scope === 'ship' ? { id: 'acs-resolute', epoch: 2 } : null },
    },
    ctx: {
      type,
      scope,
      key: 'k',
      layout: 'fspace-concourse/concourse',
      surface: 'screen',
      ambient: scope === 'ship',
    },
  } as CmcpUI;
  ui.tree = {
    ...ui.tree!,
    session: 's1',
    screen: 'fspace-concourse/concourse',
    title: 'Spacedock Concourse',
    theme: 'tng',
    root: root(),
    ui: {},
  };
  engine.pushCmcp(ui);
  const ids = new Set(ops.filter((o) => o.op === 'create').map((o) => o.id));
  return { ids };
};

describe('CMCP 2 screens', () => {
  it('draws a world-scope context as a page, not in the scene (no frame, no nav column, no alert pill)', () => {
    const { ids } = run('world', 'world.place');
    expect(ids.size).toBe(0); // nothing is drawn in the scene: the window shows the page
  });

  it('keeps the ship frame for a ship-scope context', () => {
    const { ids } = run('ship', 'ship.console');
    expect(ids.has('alertbtn')).toBe(true);
  });
});

describe('CMCP 2 nav column', () => {
  it("shows the skin's own named tabs, as in v1: the layouts the context allows are matched to them by screen name", async () => {
    const { navShapesV2 } = await import('../src/cmcp/skinframe');
    const { SKINS } = await import('../src/cmcp/skins');
    const skin = SKINS.tng;
    const prims = navShapesV2(skin, skin.pal.normal, [
      { id: 'fspace-federation/operations', title: 'fspace-federation/operations', available: true, active: true },
      { id: 'fspace-federation/tactical', title: '', available: true, active: false },
      { id: 'fspace-federation/damage', title: '', available: true, active: false },
      { id: 'fspace-federation/engineering', title: '', available: true, active: false },
      { id: 'fspace-federation/security', title: '', available: true, active: false }, // the skin has no tab for it and it is not shown
      { id: 'fspace-federation/off', title: '', available: false, active: false },
    ], 'nv.');
    const buttons = prims.filter((p) => p.type === 'button');
    expect(buttons.map((b) => (b.props as { text: string }).text)).toEqual(['POWER', 'TACTICAL', 'DAMAGE', 'OPS']); // the skin's order and names, never the layout ids
    expect(buttons.at(-1)?.target?.screen).toBe('fspace-federation/operations');
    expect(prims.some((p) => p.id === 'nv.marker')).toBe(true);
  });

  it('a screen the skin has no tab for still gets one while it is shown', async () => {
    const { navShapesV2 } = await import('../src/cmcp/skinframe');
    const { SKINS } = await import('../src/cmcp/skins');
    const prims = navShapesV2(SKINS.tng, SKINS.tng.pal.normal, [{ id: 'fspace-federation/command', title: 'Command Console', available: true, active: true }], 'nv.');
    expect(prims.filter((p) => p.type === 'button').map((b) => (b.props as { text: string }).text)).toEqual(['COMMAND CONSOLE']);
  });
});
