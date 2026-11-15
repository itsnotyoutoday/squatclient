import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { GfxRuntime } from '../src/gfx/runtime';
import { MockEngine } from '../src/api/mock';
import { CmcpController } from '../src/cmcp/controller';
import { findTextport, place, type Placed } from '../src/cmcp/layout';
import { diffOps, PORT_ID, SCENE } from '../src/cmcp/ops';
import { cell, contextStrip, draw, entries, readonlyBadge, type Ctx, type Prim } from '../src/cmcp/widgets';
import type { CmcpNode, CmcpUI } from '../src/cmcp/types';

// The fixtures are what the Go engine produced for the built-in screens (squatClientDaemon TestCmcpDumpFixtures): real bound trees.
const fx = (name: string): CmcpUI => JSON.parse(readFileSync(`public/cmcp/${name}.json`, 'utf8')) as CmcpUI;
const SCREENS = ['operations', 'power', 'damage', 'sensors', 'tactical', 'helm', 'command', 'communications', 'medical', 'security', 'cargo', 'away', 'engineering', 'transporter'];
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

describe('contexts and read-only', () => {
  it('shows the held contexts as chips, the active one first and lit', () => {
    const ui = fx('damage');
    const stack = [
      { key: 'console', kind: 'console', id: 'operations', name: 'Operations', screen: 'std.operations', priority: 100, active: false },
      { key: 'event:boarding', kind: 'event', id: 'boarding', title: 'Boarders', screen: 'std.damage', priority: 120, active: true },
    ];
    const chips = contextStrip(stack, 1200, ctxFor(ui));
    expect(chips.filter((p) => p.type === 'text').map((p) => p.props.text)).toEqual(['BOARDERS', 'OPERATIONS']);
    expect(chips[0].props.fill).toBe(ui.tree!.tokens['color.accent']);
  });
  it('says why a read-only screen offers nothing', () => {
    const ui = fx('damage');
    expect(readonlyBadge(true, undefined, 1200, ctxFor(ui)).some((p) => p.props.text === 'AI CONTROL - VIEW ONLY')).toBe(true);
    expect(readonlyBadge(false, 'Nveid', 1200, ctxFor(ui)).some((p) => String(p.props.text).startsWith('NVEID HAS THE CONSOLE'))).toBe(true);
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
    const handled = ctl.handleGfxEvent('s1', { scene: SCENE, id: `${gp.path}.g1.hit`, event: 'click', x: 0, y: 0 });
    expect(handled).toBe(true);
    await Promise.resolve();
    expect(engine.cmcpCalls.at(-1)).toMatchObject({ fn: 'cmcpEvent', session: 's1', args: [gp.path, 'select', 1] });
  });
  it('does not claim events of other scenes', () => {
    const { ctl } = setup();
    expect(ctl.handleGfxEvent('s1', { scene: 'lcars', id: 'x', event: 'click', x: 0, y: 0 })).toBe(false);
  });
  it('the X asks the game to close the context (Cobra.Context.Close) and does not hide the screen; the game\'s update does', () => {
    const { engine, ctl, rtFor } = setup();
    const ui = { ...fx('damage'), session: 's1' };
    engine.pushCmcp(ui);
    expect(ctl.handleGfxEvent('s1', { scene: SCENE, id: '#scene', event: 'close', x: 0, y: 0 })).toBe(true);
    expect(engine.cmcpCalls.at(-1)).toMatchObject({ fn: 'cmcpClose', session: 's1', args: ['user'] });
    engine.pushCmcp({ ...ui, rev: ui.rev + 1 }); // the game has not answered: the screen is still there
    expect(rtFor('s1').slot(SCENE).scene.cfg.open).toBe(true);
    // the game popped the context (Cobra.Console null): no tree, the scene goes away
    engine.pushCmcp({ ...ui, rev: ui.rev + 2, tree: null, console: undefined });
    expect(rtFor('s1').slot(SCENE).scene.cfg.open).toBe(false);
  });
  it('a failed close request is reported', async () => {
    const { engine, ctl } = setup();
    const errors: string[] = [];
    ctl.onError = (t) => errors.push(t);
    engine.pushCmcp({ ...fx('damage'), session: 's1' });
    engine.cmcpClose = (): Promise<void> => Promise.reject(new Error('Error: session: closing too fast'));
    ctl.requestClose('s1');
    await new Promise((r) => setTimeout(r, 10));
    expect(errors.some((e) => /closing too fast/.test(e))).toBe(true);
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

describe('the viewscreen draws contact art by view', () => {
  const vs = (items: unknown[]): CmcpNode => ({ path: 'v', widget: 'viewscreen', props: { items, backdrop: { kind: 'stars', seed: 1, density: 0.3 } }, layout: {}, enabled: true });
  it('lists what the engine chose as pictures to prepare, with the amounts', async () => {
    const { viewNeeds } = await import('../src/cmcp/widgets');
    const n = vs([{ cid: '17', art: 'marauder', views: [{ view: 'front', weight: 0.6, zones: { hull: 0.5 } }, { view: 'side', weight: 0.4, zones: {} }] }, { cid: '3', art: 'marker' }]);
    expect(viewNeeds(n).map((x) => `${x.art}/${x.view}`)).toEqual(['marauder/front', 'marauder/side']);
  });
  it('draws a picture per view with its weight and mirror, a plain marker until the picture exists', async () => {
    const { amountKey } = await import('../src/cmcp/widgets');
    const ui = fx('sensors');
    const item = { cid: '17', name: 'X', x: 0.5, y: 0.5, size: 0.2, min_px: 8, art: 'marauder', mirror: true, views: [{ view: 'side', weight: 0.7, zones: { hull: 0.5 }, glows: {} }, { view: 'front', weight: 0.3, zones: {}, glows: {} }] };
    const placed = place(vs([item]), { x: 0, y: 0, w: 800, h: 400 });
    const bare = draw(placed, ctxFor(ui));
    expect(bare.filter((p) => p.type === 'image')).toHaveLength(0);
    expect(bare.some((p) => p.type === 'circle')).toBe(true);
    const images = new Map([[`marauder|side|${amountKey({ zones: { hull: 0.5 }, glows: {} })}`, { name: 'a', w: 80, h: 40 }], [`marauder|front|${amountKey({ zones: {}, glows: {} })}`, { name: 'b', w: 80, h: 60 }]]);
    const full = draw(placed, ctxFor(ui, { viewImages: images }));
    const imgs = full.filter((p) => p.type === 'image');
    expect(imgs.map((p) => [p.props.src, p.props.opacity, p.props.scaleX])).toEqual([['a', 0.7, -1], ['b', 0.3, -1]]);
    expect(full.some((p) => p.type === 'circle')).toBe(false);
  });
});
