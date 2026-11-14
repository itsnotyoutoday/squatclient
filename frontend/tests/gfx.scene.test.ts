import { describe, expect, it } from 'vitest';
import { Scene } from '../src/gfx/scene';
import type { Value } from '../src/gfx/expr';

function mk(): { s: Scene; vars: Map<string, Value> } {
  const vars = new Map<string, Value>();
  return { s: new Scene('t', { vars }), vars };
}
const create = (s: Scene, id: string, type: string, props: Record<string, unknown> = {}, parent = '') =>
  s.apply({ op: 'create', id, type, props, parent });

describe('scene graph ops', () => {
  it('creates, nests, updates, reparents and deletes subtrees', () => {
    const { s } = mk();
    create(s, 'g', 'group');
    create(s, 'r', 'rect', { w: 10, h: 5, fill: '#fff' }, 'g');
    s.apply({ op: 'set', id: 'r', props: { w: 20, shadow: { blur: 4 } } });
    s.apply({ op: 'set', id: 'r', props: { shadow: { dx: 2 } } });
    expect(s.get('r')!.props).toMatchObject({ w: 20, h: 5, shadow: { blur: 4, dx: 2 } });
    expect(s.get('g')!.children.map((c) => c.id)).toEqual(['r']);
    create(s, 'h', 'group');
    s.apply({ op: 'set', id: 'r', props: { parent: 'h' } });
    expect(s.get('g')!.children).toHaveLength(0);
    expect(s.get('h')!.children[0].id).toBe('r');
    s.apply({ op: 'delete', id: 'h' });
    expect(s.get('r')).toBeUndefined();
  });
  it('creating an existing id replaces it; bad ops warn instead of throwing', () => {
    const { s } = mk();
    create(s, 'a', 'rect', { w: 1 });
    create(s, 'a', 'rect', { w: 2 });
    expect(s.get('a')!.props.w).toBe(2);
    create(s, 'x', 'nonsense');
    s.apply({ op: 'set', id: 'ghost', props: {} });
    expect(s.warnings.length).toBe(2);
    expect(s.get('x')).toBeUndefined();
  });
  it('refuses to make a node its own ancestor', () => {
    const { s } = mk();
    create(s, 'a', 'group'); create(s, 'b', 'group', {}, 'a');
    s.apply({ op: 'set', id: 'a', props: { parent: 'b' } });
    expect(s.warnings.join()).toMatch(/ancestor/);
  });
  it('paints siblings by z then creation order and skips hidden ones', () => {
    const { s } = mk();
    create(s, 'a', 'rect'); create(s, 'b', 'rect', { z: -1 }); create(s, 'c', 'rect', { visible: false }); create(s, 'd', 'rect');
    const order: string[] = [];
    s.walk((n) => { order.push(n.id); });
    expect(order).toEqual(['b', 'a', 'd']);
  });
  it('applies scene config', () => {
    const { s } = mk();
    s.apply({ op: 'scene', open: true, w: 800, h: 600, bg: '#123', bloom: { strength: 2 } });
    expect(s.cfg).toMatchObject({ open: true, w: 800, h: 600, bg: '#123' });
    expect(s.cfg.bloom.strength).toBe(2);
    expect(s.cfg.bloom.radius).toBe(1);
  });
});

describe('tweens', () => {
  it('interpolates numbers and colors with easing and ends exactly on the target', () => {
    const { s } = mk();
    create(s, 'r', 'rect', { x: 0, fill: '#000000' });
    s.apply({ op: 'tween', target: 'r', tracks: { x: { to: 100 }, fill: { to: '#ffffff' } }, dur: 1, ease: 'linear' });
    s.update(0.5);
    expect(s.get('r')!.props.x).toBeCloseTo(50);
    expect(s.get('r')!.props.fill).toBe('#808080');
    s.update(0.6);
    expect(s.get('r')!.props.x).toBe(100);
    expect(s.animating).toBe(false);
  });
  it('honours from, delay, loop, yoyo and after', () => {
    const { s } = mk();
    create(s, 'r', 'rect', { x: 5 });
    s.apply({ op: 'tween', id: 'a', target: 'r', tracks: { x: { from: 0, to: 10 } }, dur: 1, ease: 'linear', delay: 1 });
    s.update(0.5);
    expect(s.get('r')!.props.x).toBe(5); // still waiting
    s.update(1.0); // t = 1.5 -> halfway through
    expect(s.get('r')!.props.x).toBeCloseTo(5);
    s.update(1.0); // done
    expect(s.get('r')!.props.x).toBe(10);

    const t = mk().s;
    create(t, 'r', 'rect', { x: 0 });
    t.apply({ op: 'tween', id: 'p', target: 'r', tracks: { x: { to: 10 } }, dur: 1, ease: 'linear', loop: -1, yoyo: true });
    t.update(0.5); expect(t.get('r')!.props.x).toBeCloseTo(5);
    t.update(1.0); expect(t.get('r')!.props.x).toBeCloseTo(5); // coming back
    t.update(0.25); expect(t.get('r')!.props.x).toBeCloseTo(2.5);
    expect(t.animating).toBe(true);

    const c = mk().s;
    create(c, 'r', 'rect', { x: 0, y: 0 });
    c.apply({ op: 'tween', id: 'one', target: 'r', tracks: { x: { to: 10 } }, dur: 1, ease: 'linear' });
    c.apply({ op: 'tween', id: 'two', target: 'r', tracks: { y: { to: 10 } }, dur: 1, ease: 'linear', after: 'one' });
    c.update(0.5);
    expect(c.get('r')!.props.y).toBe(0);
    c.update(0.6); // 'one' ends in this step; 'two' is released on the next one
    c.update(0.5); // released now
    c.update(0.5);
    expect(c.get('r')!.props.y).toBeCloseTo(5, 0);
  });
  it('a new tween on the same property replaces the running one', () => {
    const { s } = mk();
    create(s, 'r', 'rect', { x: 0 });
    s.apply({ op: 'tween', target: 'r', tracks: { x: { to: 100 } }, dur: 1, ease: 'linear' });
    s.update(0.5);
    s.apply({ op: 'tween', target: 'r', tracks: { x: { to: 0 } }, dur: 1, ease: 'linear' });
    expect(s.tweens).toHaveLength(1);
    s.update(0.5);
    expect(s.get('r')!.props.x).toBeCloseTo(25);
  });
  it('stop removes tweens by node or tween id', () => {
    const { s } = mk();
    create(s, 'r', 'rect', { x: 0 });
    s.apply({ op: 'tween', id: 'k', target: 'r', tracks: { x: { to: 1 } }, dur: 5 });
    s.apply({ op: 'stop', id: 'r' });
    expect(s.tweens).toHaveLength(0);
  });
});

describe('timelines', () => {
  it('fires steps at their times, then loops', () => {
    const { s } = mk();
    create(s, 'r', 'rect', { x: 0 });
    s.apply({
      op: 'timeline', name: 'tl', loop: 1,
      steps: [{ at: 0.5, do: { op: 'set', id: 'r', props: { x: 1 } } }, { at: 1, do: { op: 'tween', target: 'r', tracks: { x: { to: 9 } }, dur: 0.5, ease: 'linear' } }],
    });
    s.apply({ op: 'play', name: 'tl' });
    s.update(0.4); expect(s.get('r')!.props.x).toBe(0);
    s.update(0.2); expect(s.get('r')!.props.x).toBe(1);
    s.update(0.5); s.update(0.5);
    expect(s.get('r')!.props.x).toBe(9);
    expect(s.timelines.get('tl')!.running).toBe(true); // second run
    s.update(0.6); s.update(0.6); s.update(0.6); s.update(0.6);
    expect(s.timelines.get('tl')!.running).toBe(false);
  });
});

describe('data binding', () => {
  it('re-evaluates only when a read variable changes', () => {
    const { s, vars } = mk();
    create(s, 'bar', 'rect', { w: '=lc_hull * 2' });
    create(s, 't', 'text', { text: 'HULL {lc_hull|%3d}% {lc_alert|upper}' });
    expect(s.get('bar')!.props.w).toBe(0); // unknown variable: 0
    vars.set('lc_hull', 40); vars.set('lc_alert', 'red');
    s.varsChanged(['lc_hull', 'lc_alert']);
    expect(s.get('bar')!.props.w).toBe(80);
    expect(s.get('t')!.props.text).toBe('HULL  40% RED');
    vars.set('lc_hull', '55'); // TF variables arrive as text
    s.varsChanged(['other']);
    expect(s.get('bar')!.props.w).toBe(80); // not read: untouched
    s.varsChanged(['lc_hull']);
    expect(s.get('bar')!.props.w).toBe(110);
  });
  it('time() makes a binding volatile: it re-evaluates every update', () => {
    const { s } = mk();
    create(s, 'r', 'rect', { x: '=time() * 10' });
    s.update(0.5);
    expect(s.get('r')!.props.x).toBeCloseTo(5);
    s.update(0.5);
    expect(s.get('r')!.props.x).toBeCloseTo(10);
    expect(s.animating).toBe(true);
  });
  it('plain set and unbind detach a binding; bad expressions warn', () => {
    const { s, vars } = mk();
    create(s, 'r', 'rect', { x: '=a' });
    s.apply({ op: 'set', id: 'r', props: { x: 7 } });
    vars.set('a', 99); s.varsChanged(['a']);
    expect(s.get('r')!.props.x).toBe(7);
    s.apply({ op: 'bind', id: 'r', prop: 'y', expr: 'a + 1' });
    s.apply({ op: 'unbind', id: 'r', prop: 'y' });
    vars.set('a', 1); s.varsChanged(['a']);
    expect(s.get('r')!.props.y).toBe(100);
    s.apply({ op: 'bind', id: 'r', prop: 'y', expr: '1 +' });
    expect(s.warnings.length).toBe(1);
  });
  it('smooth bindings tween between samples', () => {
    const { s, vars } = mk();
    vars.set('v', 0);
    create(s, 'r', 'rect', {});
    s.apply({ op: 'bind', id: 'r', prop: 'w', expr: 'v', smooth: 1 });
    vars.set('v', 100); s.varsChanged(['v']);
    expect(s.get('r')!.props.w).toBe(0);
    s.update(0.5);
    const mid = s.get('r')!.props.w as number;
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(100);
    s.update(1);
    expect(s.get('r')!.props.w).toBe(100);
  });
  it('removing an object frees its bindings', () => {
    const { s, vars } = mk();
    create(s, 'r', 'rect', { w: '=a' });
    s.apply({ op: 'delete', id: 'r' });
    vars.set('a', 3);
    expect(() => s.varsChanged(['a'])).not.toThrow();
  });
});

describe('interaction states', () => {
  it('hover/down tween toward the state style and back to the base', () => {
    const { s } = mk();
    create(s, 'b', 'button', { fill: '#ff9900', scaleX: 1 });
    s.apply({ op: 'on', id: 'b', events: ['click'] });
    s.apply({ op: 'state', id: 'b', name: 'hover', props: { fill: '#ffffff', scaleX: 1.1 }, dur: 0.2, ease: 'linear' });
    const b = s.get('b')!;
    expect(b.interactive).toBe(true);
    s.setState(b, 'hover', true);
    s.update(0.1);
    expect(b.props.scaleX).toBeCloseTo(1.05);
    s.update(0.2);
    expect(b.props.fill).toBe('#ffffff');
    s.setState(b, 'hover', false);
    s.update(0.3);
    expect(b.props.fill).toBe('#ff9900');
    expect(b.props.scaleX).toBe(1);
  });
  it('a script changing a base property while hovered updates the base, not the hover look', () => {
    const { s } = mk();
    create(s, 'b', 'button', { fill: '#111111' });
    s.apply({ op: 'state', id: 'b', name: 'hover', props: { fill: '#ffffff' }, dur: 0 });
    const b = s.get('b')!;
    s.setState(b, 'hover', true);
    s.apply({ op: 'set', id: 'b', props: { fill: '#222222' } });
    expect(b.props.fill).toBe('#ffffff');
    s.setState(b, 'hover', false);
    s.update(0.5);
    expect(b.props.fill).toBe('#222222');
  });
});
