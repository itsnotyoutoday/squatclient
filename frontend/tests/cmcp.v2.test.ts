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
  it('draws a world-scope context in the scene, like every other screen', () => {
    const { ids } = run('world', 'world.place');
    expect(ids.has('cmcp.port')).toBe(true);
  });

  it('keeps the ship frame for a ship-scope context', () => {
    const { ids } = run('ship', 'ship.console');
    expect(ids.has('alertbtn')).toBe(true);
  });
});

describe('CMCP 2 nav column', () => {
  it("is the v1 column: the skin's own tabs, order and colours, each pointing at the layout that shows that screen", async () => {
    const { navShapes, layoutResolver, navSlotOf } = await import('../src/cmcp/skinframe');
    const { SKINS } = await import('../src/cmcp/skins');
    const skin = SKINS.tng;
    const ids = ['fspace-federation/operations', 'fspace-federation/tactical', 'fspace-federation/damage', 'fspace-federation/navigation'];
    const cur = navSlotOf(skin.nav.items, 'fspace-federation/operations');
    const prims = navShapes(skin, skin.pal.normal, cur, 'nv.', (id) => ({ available: ids.includes(id) }), layoutResolver(ids));
    const buttons = prims.filter((p) => p.type === 'button');
    // the skin's own labels and order (SENSORS/POWER/TACTICAL/DAMAGE/OPS), never a layout id; POWER has no layout here so its slot closes up
    expect(buttons.map((b) => (b.props as { text: string }).text)).toEqual(['SENSORS', 'TACTICAL', 'DAMAGE', 'OPS']);
    // the SENSORS tab points at the navigation layout (the skin knows that screen as "helm")
    expect(buttons[0].target?.screen).toBe('fspace-federation/navigation');
    expect(buttons.at(-1)?.target?.screen).toBe('fspace-federation/operations');
    expect(prims.some((p) => p.id === 'nv.marker')).toBe(true);
  });

  it('a v1 session is unchanged: the tabs point at the built-in std.* screens', async () => {
    const { navShapes } = await import('../src/cmcp/skinframe');
    const { SKINS } = await import('../src/cmcp/skins');
    const prims = navShapes(SKINS.tng, SKINS.tng.pal.normal, 4, 'nv.');
    const buttons = prims.filter((p) => p.type === 'button');
    expect(buttons.map((b) => (b.props as { text: string }).text)).toEqual(['SENSORS', 'POWER', 'TACTICAL', 'DAMAGE', 'OPS']);
    expect(buttons.map((b) => b.target?.screen)).toEqual(['std.sensors', 'std.power', 'std.tactical', 'std.damage', 'std.operations']);
  });
});

describe('a game refusing a command', () => {
  it('says what the refusal means when the game gives no explanation of its own', async () => {
    const { refusal } = await import('../src/cmcp/controller');
    expect(refusal('conflict')).toContain('would not do that');
    expect(refusal('console_taken')).toContain('someone else holds');
    expect(refusal('something_new')).toBe('something_new'); // an unknown code is shown as it came
    expect(refusal(undefined)).toBe('it did not work');
  });
});
