import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { GfxRuntime } from '../src/gfx/runtime';
import { MockEngine } from '../src/api/mock';
import { CmcpController } from '../src/cmcp/controller';
import { findTextport, place, type Placed } from '../src/cmcp/layout';
import { diffOps, PORT_ID, SCENE } from '../src/cmcp/ops';
import { cell, draw, entries, type Ctx, type Prim } from '../src/cmcp/widgets';
import type { CmcpNode, CmcpUI } from '../src/cmcp/types';

// The fixtures are what the Go engine produced for the built-in screens (squatClientDaemon TestCmcpDumpFixtures): real bound trees.
const fx = (name: string): CmcpUI => JSON.parse(readFileSync(`public/cmcp/${name}.json`, 'utf8')) as CmcpUI;
const SCREENS = ['operations', 'power', 'damage', 'sensors', 'tactical', 'helm'];
const ctxFor = (ui: CmcpUI, over: Partial<Ctx> = {}): Ctx => ({ tree: ui.tree!, local: new Map(), history: new Map(), images: new Map(), readonly: false, reduceMotion: true, ...over });
const flat = (p: Placed, out: Placed[] = []): Placed[] => { out.push(p); p.children.forEach((c) => flat(c, out)); return out; };

describe('layout', () => {
  it('places every screen inside the area and keeps exactly one text port', () => {
    for (const s of SCREENS) {
      const ui = fx(s);
      const root = place(ui.tree!.root, { x: 0, y: 0, w: 1200, h: 675 });
      const all = flat(root);
      expect(all.filter((p) => p.node.widget === 'textport')).toHaveLength(1);
      for (const p of all) {
        expect(p.rect.x).toBeGreaterThanOrEqual(-0.5);
        expect(p.rect.y).toBeGreaterThanOrEqual(-0.5);
        expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(1200.5);
        expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(675.5);
      }
      const tp = findTextport(root)!;
      expect(tp.rect.w).toBeGreaterThan(200);
    }
  });
  it('shares the space by weight after the fixed sizes', () => {
    const n = (w: number, size?: number): CmcpNode => ({ path: String(Math.random()), widget: 'label', props: {}, enabled: true, layout: { weight: w, size, hasSize: size !== undefined } });
    const root: CmcpNode = { path: 'r', widget: 'label', props: {}, enabled: true, layout: { dir: 'row', gap: 10 }, children: [n(1), n(2), n(0, 100)] };
    const p = place(root, { x: 0, y: 0, w: 400, h: 50 });
    expect(p.children.map((c) => Math.round(c.rect.w))).toEqual([93, 187, 100]);
    expect(Math.round(p.children[2].rect.x)).toBe(300);
  });
});

describe('widgets draw the data the engine evaluated', () => {
  it('draws the damage screen from the real tree: team rows, damage bars, schematic placeholder, no overlap with the text port', () => {
    const ui = fx('damage');
    const root = place(ui.tree!.root, { x: 0, y: 0, w: 1200, h: 675 });
    const prims = draw(root, ctxFor(ui));
    const texts = prims.filter((p) => p.type === 'text').map((p) => String(p.props.text));
    expect(texts).toContain('DAMAGE CONTROL  -  hull 806.16 / 875.00');
    expect(texts.some((t) => t.startsWith('TEAM 1'))).toBe(true);
    expect(texts).toContain('PORT NACELLE');
    const tp = findTextport(root)!.rect;
    // nothing but the frame of the port itself may be drawn over the real text
    for (const p of prims) {
      if (p.id.endsWith('.frame')) continue;
      const x = Number(p.props.x), y = Number(p.props.y), w = Number(p.props.w ?? 0), h = Number(p.props.h ?? 0);
      if (!Number.isFinite(x) || !Number.isFinite(y) || p.type === 'line' || p.type === 'polyline' || p.type === 'polygon') continue;
      const overlap = x < tp.x + tp.w && x + w > tp.x && y < tp.y + tp.h && y + h > tp.y;
      expect(overlap, `${p.id} (${p.type}) covers the text port`).toBe(false);
    }
  });
  it('turns the team pick into $ui.team and the assign button into the pack event', () => {
    const ui = fx('damage');
    const root = place(ui.tree!.root, { x: 0, y: 0, w: 1200, h: 675 });
    const local = new Map<string, unknown>();
    const taNode = flat(root).find((p) => p.node.widget === 'team-assigner')!.node;
    let prims = draw(root, ctxFor(ui, { local }));
    const pick = prims.find((p) => p.id.endsWith('.t3.hit'))!;
    expect(pick.target?.setUi).toEqual({ key: 'team', value: 3 });
    expect(prims.filter((p) => p.target?.event === 'assign')).toHaveLength(0); // no team picked yet: system buttons are inert
    local.set(`${taNode.path}.team`, '3');
    prims = draw(root, ctxFor(ui, { local }));
    const assign = prims.find((p) => p.target?.event === 'assign' && (p.target.value as { system: string }).system === 'Port_Nacelle')!;
    expect(assign.target).toMatchObject({ path: taNode.path, event: 'assign', value: { team: 3, system: 'Port_Nacelle' } });
  });
  it('offers no commands while the screen is read-only (AI takeover, taken console)', () => {
    const ui = fx('damage');
    const root = place(ui.tree!.root, { x: 0, y: 0, w: 1200, h: 675 });
    const local = new Map<string, unknown>([[`${flat(root).find((p) => p.node.widget === 'team-assigner')!.node.path}.team`, '3']]);
    const prims = draw(root, ctxFor(ui, { local, readonly: true }));
    expect(prims.filter((p) => p.target?.event === 'assign')).toHaveLength(0);
  });
  it('draws every built-in screen without throwing and gives every interactive primitive a target', () => {
    for (const s of SCREENS) {
      const ui = fx(s);
      const prims = draw(place(ui.tree!.root, { x: 0, y: 0, w: 1200, h: 675 }), ctxFor(ui));
      expect(prims.length).toBeGreaterThan(5);
      for (const p of prims) if (p.events?.length) expect(p.target, `${s}: ${p.id}`).toBeDefined();
      expect(new Set(prims.map((p) => p.id)).size).toBe(prims.length); // ids are unique
    }
  });
  it('formats cells and orders keyed rows numerically', () => {
    expect(cell({ az: 333.4, mark: -22 })).toBe('333/-22');
    expect(cell(null)).toBe('-');
    expect(cell(1.23456)).toBe('1.23');
    expect(entries({ '10': 1, '2': 2, a: 3 }).map(([k]) => k)).toEqual(['2', '10', 'a']);
  });
});

describe('scene operations', () => {
  const p = (id: string, props: Record<string, unknown>, extra: Partial<Prim> = {}): Prim => ({ id, type: 'rect', props, ...extra });
  it('creates, updates only what changed, and deletes what vanished', () => {
    const a = diffOps(new Map(), [p('a', { x: 1, w: 5 }), p('b', { x: 2 }, { events: ['click'] })]);
    expect(a.ops.filter((o) => o.op === 'create')).toHaveLength(2);
    expect(a.ops.find((o) => o.op === 'on')).toMatchObject({ id: 'b', events: ['click'] });
    const b = diffOps(a.map, [p('a', { x: 1, w: 9 })]);
    expect(b.ops).toEqual([
      { op: 'set', scene: SCENE, id: 'a', props: { w: 9 } },
      { op: 'delete', scene: SCENE, id: 'b' },
    ]);
    const c = diffOps(b.map, [p('a', { x: 1, w: 9 })]);
    expect(c.ops).toEqual([]);
  });
});

describe('the controller', () => {
  function setup() {
    const engine = new MockEngine();
    const rts = new Map<string, GfxRuntime>();
    const rtFor = (id: string): GfxRuntime => { let r = rts.get(id); if (!r) { r = new GfxRuntime(); r.paused = true; rts.set(id, r); } return r; };
    const ctl = new CmcpController(engine, rtFor);
    ctl.attach();
    return { engine, ctl, rtFor };
  }
  it('opens a scene with the text port node when the engine publishes a screen, and closes it when the console goes', () => {
    const { engine, rtFor } = setup();
    const ui = { ...fx('damage'), session: 's1' };
    engine.pushCmcp(ui);
    const slot = rtFor('s1').slot(SCENE);
    expect(slot.scene.cfg.open).toBe(true);
    expect(slot.scene.cfg.dock).toBe('full');
    expect(slot.scene.cfg.portNode).toBe(PORT_ID);
    expect(slot.scene.get(PORT_ID)).toBeDefined();
    engine.pushCmcp({ ...ui, rev: ui.rev + 1, tree: null, console: null, state: 'ready' });
    expect(rtFor('s1').slot(SCENE).scene.cfg.open).toBe(false);
  });
  it('keeps the sessions apart', () => {
    const { engine, rtFor } = setup();
    engine.pushCmcp({ ...fx('damage'), session: 'a' });
    expect(rtFor('b').slots.size).toBe(0);
    engine.pushCmcp({ ...fx('power'), session: 'b' });
    expect(rtFor('a').slot(SCENE).scene.cfg.open).toBe(true);
    expect(rtFor('b').slot(SCENE).scene.cfg.open).toBe(true);
  });
  it('sends a widget event back to the engine: a click on a group row is the pack event "select"', async () => {
    const { engine, ctl } = setup();
    const ui = { ...fx('power'), session: 's1' };
    engine.pushCmcp(ui);
    const gp = flat(place(ui.tree!.root, { x: 0, y: 0, w: 1200, h: 675 })).find((p) => p.node.widget === 'group-picker')!.node;
    const handled = ctl.handleGfxEvent('s1', { scene: SCENE, id: `${gp.path}.g6.hit`, event: 'click', x: 0, y: 0 });
    expect(handled).toBe(true);
    await Promise.resolve();
    expect(engine.cmcpCalls.at(-1)).toMatchObject({ fn: 'cmcpEvent', session: 's1', args: [gp.path, 'select', 6] });
  });
  it('does not claim events of other scenes', () => {
    const { ctl } = setup();
    expect(ctl.handleGfxEvent('s1', { scene: 'lcars', id: 'x', event: 'click', x: 0, y: 0 })).toBe(false);
  });
  it('a dismissed screen stays away until the engine changes it', () => {
    const { engine, ctl, rtFor } = setup();
    const ui = { ...fx('damage'), session: 's1' };
    engine.pushCmcp(ui);
    ctl.handleGfxEvent('s1', { scene: SCENE, id: '#scene', event: 'close', x: 0, y: 0 });
    engine.pushCmcp({ ...ui, rev: ui.rev + 1 });
    expect(rtFor('s1').slot(SCENE).scene.cfg.open).toBe(false);
    engine.pushCmcp({ ...fx('power'), session: 's1', rev: ui.rev + 2 });
    expect(rtFor('s1').slot(SCENE).scene.cfg.open).toBe(true);
  });
  it('reports a failed command with the game hint', () => {
    const { engine, ctl } = setup();
    const errors: string[] = [];
    ctl.onError = (t) => errors.push(t);
    engine.pushCmcpNotes('s1', [{ kind: 'reply', reply: { id: 1, cmd: 'dmg.assign', ok: false, err: 'not_available', hint: 'use the operations console' } }]);
    expect(errors).toEqual(['dmg.assign: use the operations console']);
  });
});

vi.stubGlobal('matchMedia', undefined);
