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
    expect(full.create('alertedge')).toBeTruthy(); // the core draws the alert edge in full mode too, never in off
    expect(off.create('alertedge')).toBeUndefined();
    // the fill roles stay in edge mode (the off button uses the normal set), and swap in full mode
    expect(edge.create('offbtn')?.fill).toBe(off.create('offbtn')?.fill);
    expect(full.create('offbtn')?.fill).not.toBe(off.create('offbtn')?.fill);
    // the state is readable in the alert pill whatever the mode
    for (const r of [full, edge, off]) expect(r.create('alertbtn')?.text).toBe('ALERT RED');
  });
  it('the theme default: romulan and ferengi edge (roles r and x only), tng full', () => {
    expect(run('romulan', 'theme', 'red').create('alertedge')).toBeTruthy();
    expect(run('ferengi', 'theme', 'red').create('alertedge')).toBeTruthy();
    expect(run('tng', 'theme', 'red').create('alertedge')).toBeTruthy();
    expect(run('tng', 'theme', 'green').create('alertedge')).toBeUndefined();
  });
});

describe('the red-alert pulse (samples come from the engine, which asks the core)', () => {
  const setupP = (alert: string, reduce = false) => {
    const engine = new MockEngine();
    const rt = new GfxRuntime();
    rt.paused = true;
    const ops: GfxOp[] = [];
    const apply = rt.apply.bind(rt);
    rt.apply = (o: GfxOp[]): void => { ops.push(...o); apply(o); };
    const ctl = new CmcpController(engine, () => rt);
    ctl.reduceMotion = reduce;
    ctl.attach();
    const ui = { ...fx('sensors'), session: 's1', alert, status: { alert, hull: { cur: 80, max: 100 }, core_pct: 60, name: 'SS Test' }, commands: ['alert.set'] } as CmcpUI;
    ui.tree!.session = 's1';
    ui.tree!.theme = 'klingon';
    ui.tree!.alertMode = 'full';
    engine.pushCmcp(ui);
    const fin = (id: string): Record<string, unknown> | undefined => {
      let cur: Record<string, unknown> | undefined;
      for (const o of ops) {
        if (o.op === 'create' && o.id === id) cur = { ...(o.props as Record<string, unknown>) };
        else if (o.op === 'set' && o.id === id && cur) Object.assign(cur, o.props);
        else if (o.op === 'tween' && o.target === id && cur) for (const [k, v] of Object.entries(o.tracks as Record<string, { to: unknown }>)) cur[k] = v.to;
      }
      return cur;
    };
    return { engine, fin, ops, ctl };
  };
  it('re-colours the alert pill, the edge and the roles r and x from each sample, and restores the plain colours when steady', () => {
    const { engine, fin } = setupP('red');
    const plain = fin('alertbtn')?.fill;
    engine.pushCmcpPulse({ session: 's1', active: true, level: 0.7, phase: 'dim', alert: 'red', roles: { r: '#a13738', x: '#9a792c' }, edge: '#b61717' });
    expect(fin('alertbtn')?.fill).toBe('#a13738');
    expect(fin('alertedge')?.stroke).toBe('#b61717');
    engine.pushCmcpPulse({ session: 's1', active: true, level: 1, phase: 'on', alert: 'red', roles: { r: '#ff2a2a', x: '#ffd24a' }, edge: '#ff2020' });
    expect(fin('alertbtn')?.fill).toBe('#ff2a2a');
    engine.pushCmcpPulse({ session: 's1', active: false, level: 1, phase: 'on' });
    expect(fin('alertbtn')?.fill).toBe(plain);
  });
  it('ignores samples on a green alert and renders nothing different when steady', () => {
    const { engine, fin } = setupP('green');
    const before = fin('alertbtn')?.fill;
    engine.pushCmcpPulse({ session: 's1', active: true, level: 0.5, phase: 'dim', roles: { r: '#123456' } });
    expect(fin('alertbtn')?.fill).toBe(before);
  });
  it('tells the engine about reduced motion (a steady alert)', () => {
    const { engine } = setupP('red', true);
    expect(engine.cmcpCalls.some((c) => c.fn === 'cmcpReducedMotion')).toBe(true);
  });
});
