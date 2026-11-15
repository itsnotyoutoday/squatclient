import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { GfxRuntime } from '../src/gfx/runtime';
import { MockEngine } from '../src/api/mock';
import { CmcpController } from '../src/cmcp/controller';
import { templateVars } from '../src/cmcp/skinframe';
import type { CmcpNode, CmcpUI } from '../src/cmcp/types';
import type { GfxOp } from '../src/api/types';

const fx = (n: string): CmcpUI => JSON.parse(readFileSync(`public/cmcp/${n}.json`, 'utf8')) as CmcpUI;
const find = (n: CmcpNode, w: string): CmcpNode | null => (n.widget === w ? n : (n.children ?? []).map((c) => find(c, w)).find(Boolean) ?? null);

function setup(theme = 'tng') {
  const engine = new MockEngine();
  const rt = new GfxRuntime();
  rt.paused = true;
  const ops: GfxOp[] = [];
  const apply = rt.apply.bind(rt);
  rt.apply = (o: GfxOp[]): void => { ops.push(...o); apply(o); };
  const ctl = new CmcpController(engine, () => rt);
  ctl.attach();
  const ui = fx('sensors');
  ui.session = 's1';
  ui.tree!.session = 's1';
  ui.tree!.theme = theme;
  const vs = find(ui.tree!.root, 'viewscreen')!;
  vs.props.effects = {
    'fire.phaser': { effect: 'beam', color: '@color.warn', duration_ms: 400, width: 2 }, 'fire.torpedo': { effect: 'torpedo', color: '@color.accent2', duration_ms: 1500 },
    'hit.shield': { effect: 'shield_flash', color: '@color.accent2', duration_ms: 500 }, hit: { effect: 'flash', color: '@color.alert', duration_ms: 300 },
    destroyed: { effect: 'explosion', color: '@color.accent', duration_ms: 2500, size: 40 }, // a pack asking for an absurd size
  };
  vs.props.items = [{ cid: '17', name: 'X', x: 0.3, y: 0.5, size: 0.2, min_px: 8, art: 'marker' }];
  engine.pushCmcp(ui);
  return { engine, rt, ops, ui };
}

describe('viewscreen effects stay inside the viewscreen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('creates every effect inside a group clipped to the viewscreen rectangle, bounded in size, and removes it', () => {
    const { engine, ops } = setup();
    const clip = ops.find((o) => o.op === 'create' && o.id === 'fxclip');
    expect(clip, 'the clip group exists').toBeTruthy();
    const rect = (clip!.props as { clip: number[] }).clip;
    expect(rect[2]).toBeGreaterThan(100);
    ops.length = 0;
    engine.pushCmcpNotes('s1', [
      { kind: 'event', event: { type: 'fire', data: { kind: 'phaser', from: 'self', to: 17 } } },
      { kind: 'event', event: { type: 'fire', data: { kind: 'torpedo', from: 'self', to: 17 } } },
      { kind: 'event', event: { type: 'hit', data: { cid: 'self', shield: true } } },
      { kind: 'event', event: { type: 'hit', data: { cid: 'self' } } },
      { kind: 'event', event: { type: 'destroyed', data: { cid: 17 } } },
      { kind: 'event', event: { type: 'destroyed', data: { cid: 999 } } },
    ]);
    const created = ops.filter((o) => o.op === 'create');
    expect(created.length).toBeGreaterThan(5);
    const roots = created.filter((o) => (o.parent as string | undefined) === 'fxclip');
    expect(roots.length, 'every effect root is a child of the clip group').toBe(created.filter((o) => !String(o.parent ?? '').startsWith('fx') || o.parent === 'fxclip').length);
    for (const o of created) {
      const p = o.props as Record<string, number>;
      if (o.type === 'circle') expect(p.r, 'no huge disc').toBeLessThanOrEqual(rect[3] * 0.12);
      if (o.type === 'rect') { expect(p.w).toBeLessThanOrEqual(rect[2] + 0.5); expect(p.h).toBeLessThanOrEqual(rect[3] + 0.5); }
      if (typeof p.x === 'number' && o.type === 'group') { expect(p.x).toBeGreaterThanOrEqual(rect[0] - 0.5); expect(p.x).toBeLessThanOrEqual(rect[0] + rect[2] + 0.5); expect(p.y).toBeGreaterThanOrEqual(rect[1] - 0.5); expect(p.y).toBeLessThanOrEqual(rect[1] + rect[3] + 0.5); }
    }
    for (const t of ops.filter((o) => o.op === 'tween')) {
      const tr = t.tracks as Record<string, { to: number }>;
      if (tr.scaleX) expect(tr.scaleX.to, 'growth is bounded').toBeLessThanOrEqual(3.01);
    }
    // nothing leaks: every effect root is deleted after its duration
    ops.length = 0;
    vi.advanceTimersByTime(11_000);
    const deleted = new Set(ops.filter((o) => o.op === 'delete').map((o) => o.id));
    for (const o of created.filter((c) => c.parent === 'fxclip')) expect(deleted.has(o.id as string), `${String(o.id)} was never removed`).toBe(true);
  });

  it('caps a burst of events', () => {
    const { engine, ops } = setup();
    ops.length = 0;
    engine.pushCmcpNotes('s1', Array.from({ length: 60 }, () => ({ kind: 'event' as const, event: { type: 'hit', data: { cid: 'self' } } })));
    expect(ops.filter((o) => o.op === 'create' && o.parent === 'fxclip').length).toBeLessThanOrEqual(12);
  });

});

describe('the ship name in the frame', () => {
  it('falls back from the console ship to the ship status, the Welcome ship (not its login-time "No ship") and the class, never "UNKNOWN SHIP"', () => {
    const ui = fx('sensors');
    ui.ship = { id: 's1', epoch: 1 } as CmcpUI['ship'];
    ui.docs = {};
    ui.status = undefined;
    ui.welcome = { ship: { id: 's1', name: 'SS Welcome Name' } };
    expect(templateVars(ui, 'SENSORS').ship).toBe('SS WELCOME NAME');
    ui.welcome = { ship: { id: 'none', name: 'No ship' } }; // the ship the player had at login: none
    ui.status = { name: 'ACS Resolute' } as never;
    expect(templateVars(ui, 'SENSORS').ship).toBe('ACS RESOLUTE');
    ui.status = undefined;
    ui.welcome = {};
    ui.docs = { ...ui.docs, 'Space.Ship.Status': { name: 'SS Status Name' } };
    expect(templateVars(ui, 'SENSORS').ship).toBe('SS STATUS NAME');
    ui.docs = {};
    ui.ship = { id: 'khv-drakhar', epoch: 1, class: 'Bird of Prey' } as CmcpUI['ship'];
    expect(templateVars(ui, 'SENSORS').ship).toBe('BIRD OF PREY');
    ui.ship = undefined;
    expect(templateVars(ui, 'SENSORS').ship).not.toContain('UNKNOWN');
  });
});

describe('the game name in the frame', () => {
  it('shows the game, never the server software ("Evennia")', () => {
    const ui = fx('sensors');
    ui.server = { server: 'Evennia', game: 'CMCP Testgame' } as CmcpUI['server'];
    expect(templateVars(ui, 'X').game).toBe('CMCP TESTGAME');
    ui.server = { server: 'Evennia' } as CmcpUI['server'];
    expect(templateVars(ui, 'X').game).toBe('');
  });
});

describe('the "No ship" sentinel', () => {
  it('is never a ship name in the status strip', () => {
    const ui = fx('sensors');
    ui.ship = { id: 'none', name: 'No ship', epoch: 4 } as CmcpUI['ship'];
    ui.status = undefined;
    ui.docs = {};
    ui.welcome = { ship: { id: 'none', name: 'No ship' } };
    expect(templateVars(ui, 'X').ship).not.toMatch(/NO SHIP/);
    ui.status = { name: 'ACS Resolute' } as never;
    expect(templateVars(ui, 'X').ship).toBe('ACS RESOLUTE');
  });
});
