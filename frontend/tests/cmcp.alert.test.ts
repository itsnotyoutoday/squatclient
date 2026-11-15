import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GfxRuntime } from '../src/gfx/runtime';
import { MockEngine } from '../src/api/mock';
import { CmcpController } from '../src/cmcp/controller';
import { SCENE } from '../src/cmcp/ops';
import type { CmcpUI } from '../src/cmcp/types';
import type { GfxOp } from '../src/api/types';
import { SKINS } from '../src/cmcp/skins';

const SKIN_RED_FRAME = {
  romulan: { normal: SKINS.romulan.pal.normal[SKINS.romulan.port.frame.role], red: SKINS.romulan.pal.red[SKINS.romulan.port.frame.role] },
};

const fx = (n: string): CmcpUI => JSON.parse(readFileSync(`public/cmcp/${n}.json`, 'utf8')) as CmcpUI;

function setup(over: Partial<CmcpUI>) {
  const engine = new MockEngine();
  const rt = new GfxRuntime();
  rt.paused = true;
  const ctl = new CmcpController(engine, () => rt);
  const errors: string[] = [];
  ctl.onError = (t) => errors.push(t);
  ctl.attach();
  const ui = { ...fx('sensors'), session: 's1', status: { alert: 'green', hull: { cur: 80, max: 100 }, core_pct: 60, name: 'SS Test' }, ...over } as CmcpUI;
  ui.tree!.session = 's1';
  ui.tree!.theme = 'tng';
  engine.pushCmcp(ui);
  return { engine, ctl, rt, errors, ui };
}

describe('the alert pill', () => {
  it('cycles green -> yellow -> red -> green with alert.set when this console may set it', () => {
    const { engine, ctl } = setup({ commands: ['alert.set', 'scan.srs'], readonly: false });
    for (const [cur, next] of [['green', 'yellow'], ['yellow', 'red'], ['red', 'green']] as const) {
      engine.pushCmcp({ ...fx('sensors'), session: 's1', rev: Math.random(), commands: ['alert.set'], status: { alert: cur } } as CmcpUI);
      ctl.handleGfxEvent('s1', { scene: SCENE, id: 'alertbtn', event: 'click', x: 0, y: 0 });
      expect(engine.cmcpCalls.at(-1)).toMatchObject({ fn: 'cmcpCommand', args: ['alert.set', { level: next }] });
    }
  });
  it('is dim with a "man <console>" hint when the console may not set it, and when read-only', () => {
    const { engine, ctl, errors } = setup({ commands: ['scan.srs'] });
    ctl.handleGfxEvent('s1', { scene: SCENE, id: 'alertbtn', event: 'click', x: 0, y: 0 });
    expect(engine.cmcpCalls.filter((c) => c.fn === 'cmcpCommand')).toHaveLength(0);
    expect(errors.at(-1)).toMatch(/Not available from this console/);
    const r = setup({ commands: ['alert.set'], readonly: true });
    r.ctl.handleGfxEvent('s1', { scene: SCENE, id: 'alertbtn', event: 'click', x: 0, y: 0 });
    expect(r.errors.at(-1)).toMatch(/read-only/);
    expect(r.engine.cmcpCalls.filter((c) => c.fn === 'cmcpCommand')).toHaveLength(0);
  });
  it('the frame shows the status from the pushed model (no docs): hull, core and the ship name', async () => {
    const { templateVars } = await import('../src/cmcp/skinframe');
    const ui = { ...fx('sensors'), docs: undefined, status: { alert: 'red', hull: { cur: 50, max: 100 }, core_pct: 61, name: 'SS Real' } } as unknown as CmcpUI;
    ui.ship = undefined;
    const v = templateVars(ui, 'SENSORS');
    expect(v).toMatchObject({ hull: '50', core: '61', alert: 'RED', ship: 'SS REAL' });
  });
});

describe('alert_recolour', () => {
  const run = (theme: string, mode: 'theme' | 'full' | 'edge' | 'off', alert: string) => {
    const engine = new MockEngine();
    const rt = new GfxRuntime();
    rt.paused = true;
    const ops: GfxOp[] = [];
    const apply = rt.apply.bind(rt);
    rt.apply = (o: GfxOp[]): void => { ops.push(...o); apply(o); };
    const ctl = new CmcpController(engine, () => rt);
    ctl.alertRecolour = () => mode;
    ctl.attach();
    const ui = { ...fx('sensors'), session: 's1', alert, status: { alert, hull: { cur: 80, max: 100 }, core_pct: 60, name: 'SS Test' }, commands: ['alert.set'] } as CmcpUI;
    ui.tree!.session = 's1';
    ui.tree!.theme = theme;
    engine.pushCmcp(ui);
    const create = (id: string) => ops.find((o) => o.op === 'create' && o.id === id)?.props as Record<string, unknown> | undefined;
    return { create, ops };
  };
  const redP = SKIN_RED_FRAME;
  it('full recolours the whole console, edge only the frame edge and the pill, off nothing', () => {
    const full = run('romulan', 'full', 'red'), edge = run('romulan', 'edge', 'red'), off = run('romulan', 'off', 'red'), calm = run('romulan', 'edge', 'green');
    expect(full.create('portframe')?.stroke).toBe(redP.romulan.red);
    expect(edge.create('portframe')?.stroke).toBe(redP.romulan.red);
    expect(off.create('portframe')?.stroke).toBe(redP.romulan.normal);
    expect(calm.create('portframe')?.stroke).toBe(redP.romulan.normal);
    expect(edge.create('alertedge')).toBeTruthy();
    expect(full.create('alertedge')).toBeUndefined();
    expect(off.create('alertedge')).toBeUndefined();
    // the fill roles stay in edge mode (the off button uses the normal set), and swap in full mode
    expect(edge.create('offbtn')?.fill).toBe(off.create('offbtn')?.fill);
    expect(full.create('offbtn')?.fill).not.toBe(off.create('offbtn')?.fill);
    // the state is readable in the alert pill whatever the mode
    for (const r of [full, edge, off]) expect(r.create('alertbtn')?.text).toBe('ALERT RED');
  });
  it('the theme default: romulan and ferengi edge, tng full', () => {
    expect(run('romulan', 'theme', 'red').create('alertedge')).toBeTruthy();
    expect(run('ferengi', 'theme', 'red').create('alertedge')).toBeTruthy();
    expect(run('tng', 'theme', 'red').create('alertedge')).toBeUndefined();
  });
});
