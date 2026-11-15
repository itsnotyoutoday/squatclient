import { describe, expect, it, vi } from 'vitest';
import { GfxRuntime, flatten, type Slot } from '../src/gfx/runtime';
import { buildScene, hitLocal, parseContacts, pick, paintOf } from '../src/gfx/build';
import type { GfxEventOut } from '../src/gfx/types';

const env = (rt: GfxRuntime, slot: Slot) => ({ defaultFont: 'x', getVar: (n: string) => rt.vars.get(n) as number | string | undefined, canvases: slot.canvases, hasShader: () => true });

/** A runtime whose scene "t" is 100x100 logical on a 100x100 fake canvas, with no GL. */
function setup() {
  const rt = new GfxRuntime();
  rt.apply([{ op: 'scene', scene: 't', open: true, w: 100, h: 100 }]);
  const slot = rt.slot('t');
  slot.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), width: 100, height: 100 } as unknown as HTMLCanvasElement;
  slot.renderer = { mapping: { sx: 1, sy: 1, ox: 0, oy: 0 }, lost: false, forget: () => undefined } as unknown as Slot['renderer'];
  const events: GfxEventOut[] = [];
  rt.onEvent = (e) => events.push(e);
  const rebuild = (): void => { slot.built = buildScene(slot.scene, env(rt, slot)); };
  return { rt, slot, events, rebuild };
}

describe('variables, gmcp and msdp', () => {
  it('flattens json into dotted names with array indexes', () => {
    const out: Record<string, string | number | undefined> = {};
    flatten('gmcp:Char.Vitals', { hp: 30, maxhp: 50, tags: ['a', 'b'], ok: true }, out);
    expect(out).toMatchObject({ 'gmcp:Char.Vitals.hp': 30, 'gmcp:Char.Vitals.tags.1': 'b', 'gmcp:Char.Vitals.tags.length': 2, 'gmcp:Char.Vitals.ok': 1 });
  });
  it('drives bindings from gmcp and msdp', () => {
    const { rt, slot } = setup();
    rt.apply([{ op: 'create', scene: 't', id: 'bar', type: 'rect', props: { w: '=gmcp:Char.Vitals.hp * 2' } },
      { op: 'create', scene: 't', id: 'tx', type: 'text', props: { text: 'HP {msdp:HEALTH}' } }]);
    rt.setGmcp('Char.Vitals', { hp: 21 });
    rt.setMsdp({ HEALTH: 77 });
    expect(slot.scene.get('bar')!.props.w).toBe(42);
    expect(slot.scene.get('tx')!.props.text).toBe('HP 77');
  });
  it('applies vars ops, ignoring unchanged values', () => {
    const { rt, slot } = setup();
    rt.apply([{ op: 'create', scene: 't', id: 'r', type: 'rect', props: { x: '=a' } }, { op: 'vars', vars: { a: 5 } }]);
    expect(slot.scene.get('r')!.props.x).toBe(5);
    const spy = vi.spyOn(slot.scene, 'varsChanged');
    rt.setVars({ a: 5 });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('pixel canvases through the runtime', () => {
  it('creates, draws and deletes canvases with their nodes', () => {
    const { rt, slot } = setup();
    rt.apply([{ op: 'create', scene: 't', id: 'c', type: 'pixelcanvas', props: { w: 10, h: 4 } },
      { op: 'draw', scene: 't', id: 'c', cmd: 'fill', args: [0, 0, 3, 2], color: '#ff0000' }]);
    expect(slot.canvases.get('c')!.px(1, 1)).toEqual([255, 0, 0, 255]);
    rt.apply([{ op: 'delete', scene: 't', id: 'c' }]);
    expect(slot.canvases.has('c')).toBe(false);
  });
});

describe('draw list and hit testing', () => {
  it('lists shapes in paint order with world matrices and finds the topmost interactive object', () => {
    const { rt, slot, rebuild } = setup();
    rt.apply([
      { op: 'create', scene: 't', id: 'g', type: 'group', props: { x: 10, y: 10 } },
      { op: 'create', scene: 't', id: 'a', type: 'rect', parent: 'g', props: { w: 50, h: 50, fill: '#f00' } },
      { op: 'create', scene: 't', id: 'b', type: 'circle', parent: 'g', props: { x: 25, y: 25, r: 10, fill: '#0f0' } },
      { op: 'on', scene: 't', id: 'a', events: ['click'] }, { op: 'on', scene: 't', id: 'b', events: ['click'] },
    ]);
    rebuild();
    expect(slot.built!.items.map((i) => i.k)).toEqual(['shape', 'shape']);
    expect(pick(slot.built!.hit, 35, 35)!.id).toBe('b');   // circle is on top
    expect(pick(slot.built!.hit, 15, 15)!.id).toBe('a');
    expect(pick(slot.built!.hit, 90, 90)).toBeNull();
  });
  it('hit tests rounded rects, arcs and elbows by their real outline', () => {
    const { rt, slot } = setup();
    rt.apply([
      { op: 'create', scene: 't', id: 'rr', type: 'rect', props: { w: 40, h: 40, r: 20 } },
      { op: 'create', scene: 't', id: 'ar', type: 'arc', props: { r0: 10, r1: 20, a0: 0, a1: 90 } },
      { op: 'create', scene: 't', id: 'el', type: 'elbow', props: { w: 100, h: 100, bar: 20, side: 30, corner: 'tl' } },
    ]);
    const n = (id: string) => slot.scene.get(id)!;
    expect(hitLocal(n('rr'), 1, 1)).toBe(false);   // the cut corner
    expect(hitLocal(n('rr'), 20, 20)).toBe(true);
    expect(hitLocal(n('ar'), 10, -10)).toBe(true);  // up-right, inside the ring
    expect(hitLocal(n('ar'), -10, -10)).toBe(false);
    expect(hitLocal(n('el'), 90, 10)).toBe(true);   // the bar
    expect(hitLocal(n('el'), 60, 60)).toBe(false);  // the hole
  });
  it('parses radar contacts from gtf strings and tables', () => {
    const c = parseContacts('1:22:35:F;2:335:62:H;bad;3:100:55:N');
    expect(c).toHaveLength(3);
    expect(c[1].t).toBe(2);
    expect(c[0].r).toBeCloseTo(0.35 * 0.92);
    expect(parseContacts([{ bearing: 90, range: 50, type: 'U' }])[0].a).toBeCloseTo(Math.PI / 2);
  });
  it('turns gradients into paints in box coordinates', () => {
    const p = paintOf({ type: 'linear', angle: 90, stops: [[0, '#f00'], [1, '#00f']] }, [0, 0, 100, 20]);
    expect(p.kind).toBe(1);
    expect(p.g[0]).toBeCloseTo(0); expect(p.g[2]).toBeCloseTo(100); expect(p.g[1]).toBeCloseTo(10);
    expect(paintOf('#ff0000', [0, 0, 1, 1]).kind).toBe(0);
    expect(paintOf('none', [0, 0, 1, 1]).c[0][3]).toBe(0);
  });
});

describe('pointer events', () => {
  it('reports enter, down, up and click on interactive objects and drives hover/down states', () => {
    const { rt, slot, events, rebuild } = setup();
    rt.apply([{ op: 'create', scene: 't', id: 'b', type: 'button', props: { x: 10, y: 10, w: 40, h: 20, fill: '#111111' } },
      { op: 'on', scene: 't', id: 'b', events: ['click', 'enter', 'leave', 'down', 'up'] },
      { op: 'state', scene: 't', id: 'b', name: 'hover', props: { fill: '#ffffff' }, dur: 0 }]);
    rebuild();
    rt.pointer(slot, 'move', 20, 20);
    expect(slot.scene.get('b')!.props.fill).toBe('#ffffff');
    rt.pointer(slot, 'down', 20, 20);
    rt.pointer(slot, 'up', 20, 20);
    rt.pointer(slot, 'move', 90, 90);
    expect(events.map((e) => e.event)).toEqual(['enter', 'down', 'up', 'click', 'leave']);
    expect(events[3]).toMatchObject({ scene: 't', id: 'b', x: 20, y: 20 });
    slot.scene.update(0.5);
    expect(slot.scene.get('b')!.props.fill).toBe('#111111');
  });
  it('a press that ends elsewhere is not a click', () => {
    const { rt, slot, events, rebuild } = setup();
    rt.apply([{ op: 'create', scene: 't', id: 'b', type: 'rect', props: { x: 10, y: 10, w: 20, h: 20 } }, { op: 'on', scene: 't', id: 'b', events: ['click', 'down'] }]);
    rebuild();
    rt.pointer(slot, 'down', 15, 15);
    rt.pointer(slot, 'up', 80, 80);
    expect(events.map((e) => e.event)).toEqual(['down']);
  });
  it('a draggable knob follows the pointer inside its radius, writes scaled variables, and springs back', () => {
    const { rt, slot, events, rebuild } = setup();
    rt.apply([
      { op: 'create', scene: 't', id: 'k', type: 'circle', props: { x: 50, y: 50, r: 8, drag: { r: 20, home: true, vx: 'jx', vy: 'jy', scale: 100 } } },
      { op: 'create', scene: 't', id: 'tx', type: 'text', props: { text: 'X {jx|%+d}' } },
      { op: 'on', scene: 't', id: 'k', events: ['drag', 'settle'] },
    ]);
    rebuild();
    rt.pointer(slot, 'down', 50, 50);
    rt.pointer(slot, 'move', 100, 50); // far right: clamped to the radius
    expect(slot.scene.get('k')!.props.x).toBeCloseTo(70);
    expect(rt.vars.get('jx')).toBe(100);
    expect(rt.vars.get('jy')).toBe(0);
    expect(slot.scene.get('tx')!.props.text).toBe('X +100');
    rt.pointer(slot, 'move', 60, 50);
    expect(rt.vars.get('jx')).toBe(50);
    rt.pointer(slot, 'up', 60, 50);
    expect(events.filter((e) => e.event === 'settle')).toEqual([{ scene: 't', id: 'k', event: 'settle', x: 50, y: 0 }]);
    expect(rt.vars.get('jx')).toBe(0);
    slot.scene.update(1);
    expect(slot.scene.get('k')!.props.x).toBe(50);
  });
  it('reports settle when the pointer rests, before it is released', () => {
    const { rt, slot, events, rebuild } = setup();
    rt.apply([{ op: 'create', scene: 't', id: 'k', type: 'circle', props: { x: 50, y: 50, r: 8, drag: { r: 20 } } }, { op: 'on', scene: 't', id: 'k', events: ['settle'] }]);
    rebuild();
    rt.pointer(slot, 'down', 50, 50);
    rt.pointer(slot, 'move', 60, 50);
    slot.renderer = { ...slot.renderer, lost: true } as unknown as Slot['renderer']; // tick() returns early after the settle check
    rt.tick(slot, 0.016, performance.now() + 400);
    expect(events.map((e) => e.event)).toEqual(['settle']);
    rt.pointer(slot, 'up', 60, 50);
    expect(events).toHaveLength(1); // no second settle on release
  });
});

describe('calm', () => {
  it('eases toward the scene setting and slows the scene clock', () => {
    const rt = new GfxRuntime();
    rt.reducedMotion = false;
    rt.apply([{ op: 'scene', scene: 'c', open: true, w: 100, h: 100, calm: 0.6 }]);
    const slot = rt.slot('c');
    slot.renderer = { mapping: { sx: 1, sy: 1, ox: 0, oy: 0 }, lost: false, forget: () => undefined, hasShader: () => true, render: () => ({}) } as unknown as Slot['renderer'];
    slot.canvas = {} as HTMLCanvasElement;
    rt.tick(slot, 0.1, 0);
    expect(slot.calmNow).toBeGreaterThan(0);
    expect(slot.calmNow).toBeLessThan(0.6);
    for (let i = 0; i < 60; i++) rt.tick(slot, 0.1, i);
    expect(slot.calmNow).toBeCloseTo(0.6, 2);
    const t0 = slot.scene.time;
    rt.tick(slot, 1, 100);
    expect(slot.scene.time - t0).toBeCloseTo(1 - 0.6 * 0.6, 2); // a calm scene runs 36% slower at calm 0.6
  });
  it('prefers-reduced-motion puts a floor under calm', () => {
    const rt = new GfxRuntime();
    rt.reducedMotion = true;
    rt.apply([{ op: 'scene', scene: 'c', open: true, w: 100, h: 100, calm: 0 }]);
    const slot = rt.slot('c');
    slot.renderer = { mapping: { sx: 1, sy: 1, ox: 0, oy: 0 }, lost: false, forget: () => undefined, hasShader: () => true, render: () => ({}) } as unknown as Slot['renderer'];
    for (let i = 0; i < 60; i++) rt.tick(slot, 0.1, i);
    expect(slot.calmNow).toBeCloseTo(0.6, 2);
  });
});
