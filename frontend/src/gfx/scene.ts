/**
 * The retained scene graph: objects with properties, handles (ids), tweens, timelines, data bindings, style
 * states and event flags. It has no GL in it: the renderer reads `build()` (the draw list) and the runtime feeds
 * ops, variables and time. Everything here is unit tested (tests/gfx.*.test.ts).
 */
import { compileExpr, compileTemplate, hasTemplate, type Compiled, type EvalCtx, type Value } from './expr';
import { Tween, lerpValue, type Track, type TweenSpec } from './tween';
import { NODE_TYPES, type GfxOp, type Props, type SceneConfig } from './types';
import { IDENT, type Mat } from './geom';

export const DEFAULT_CONFIG: SceneConfig = {
  open: false, w: 1280, h: 720, bg: '#000000', dock: 'full', margin: [0, 0, 0, 0], fit: 'contain',
  bloom: { strength: 0.8, radius: 1, threshold: 0 }, pixel: false, passthrough: false, stats: false,
  font: "Antonio, 'Arial Narrow', 'Helvetica Neue', sans-serif",
};

export interface Binding { c: Compiled<Value | string>; smooth: number; tmpl: boolean; last?: unknown; key: { n: GfxNode; prop: string } }
export interface StateDef { props: Props; dur: number; ease: string }

export class GfxNode {
  children: GfxNode[] = [];
  parent: GfxNode | null = null;
  props: Props;
  bindings = new Map<string, Binding>();
  states = new Map<string, StateDef>();
  stateBase = new Map<string, unknown>();
  active = new Set<string>();
  events = new Set<string>();
  /** transient state owned by the renderer / simulations */
  sim: Record<string, unknown> = {};
  world: Mat = IDENT;
  inv: Mat | null = null;
  worldOpacity = 1;
  seq = 0;
  constructor(readonly id: string, readonly type: string, props: Props) {
    this.props = props;
  }
  num(k: string, d = 0): number {
    const v = this.props[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
    return d;
  }
  str(k: string, d = ''): string {
    const v = this.props[k];
    return v === undefined || v === null ? d : String(v);
  }
  bool(k: string, d = false): boolean {
    const v = this.props[k];
    return v === undefined ? d : v === true || v === 1 || v === 'true' || v === '1' || v === 'on';
  }
  get interactive(): boolean {
    return this.events.size > 0 || this.states.size > 0 || this.bool('hit') || !!this.props.drag;
  }
}

interface Timeline {
  name: string;
  steps: { at: number; do: GfxOp }[];
  loop: number;
  dur?: number;
  t0: number;
  running: boolean;
  fired: number;
  runs: number;
}

/** What a scene needs from its runtime. */
export interface SceneHost {
  vars: Map<string, Value>;
  emitEvent?: (id: string, event: string, x: number, y: number) => void;
}

let nodeSeq = 0;

export class Scene {
  cfg: SceneConfig = { ...DEFAULT_CONFIG, margin: [...DEFAULT_CONFIG.margin], bloom: { ...DEFAULT_CONFIG.bloom } };
  readonly root = new GfxNode('#root', 'group', {});
  nodes = new Map<string, GfxNode>();
  time = 0;
  dirty = true;
  tweens: Tween[] = [];
  timelines = new Map<string, Timeline>();
  /** Notified when a node is created or deleted, so the renderer can drop its resources. */
  onDelete?: (n: GfxNode) => void;
  private depIndex = new Map<string, Set<{ n: GfxNode; prop: string }>>();
  private volatileB = new Set<{ n: GfxNode; prop: string }>();
  private tweenSeq = 0;
  private ctx: EvalCtx;
  warnings: string[] = [];

  constructor(readonly id: string, readonly host: SceneHost) {
    this.ctx = { get: (name) => this.host.vars.get(name), time: 0 };
    this.nodes.set('#root', this.root);
  }

  // ------------------------------------------------------------------ ops
  apply(op: GfxOp): void {
    this.dirty = true;
    try {
      this.applyOp(op);
    } catch (e) {
      this.warn(`${String(op.op)}: ${(e as Error).message}`);
    }
  }

  private warn(msg: string): void {
    if (this.warnings.length < 50) this.warnings.push(msg);
    if (typeof console !== 'undefined') console.warn(`[gfx ${this.id}] ${msg}`);
  }

  private applyOp(op: GfxOp): void {
    const s = (k: string): string => (typeof op[k] === 'string' ? (op[k] as string) : '');
    switch (op.op) {
      case 'scene': {
        for (const [k, v] of Object.entries(op)) {
          if (k === 'op' || k === 'scene') continue;
          if (k === 'bloom') {
            if (typeof v === 'number') this.cfg.bloom.strength = v;
            else Object.assign(this.cfg.bloom, v);
          } else if (k === 'w' || k === 'h') (this.cfg as unknown as Record<string, unknown>)[k] = Number(v) || 0;
          else (this.cfg as unknown as Record<string, unknown>)[k] = v;
        }
        break;
      }
      case 'clear': this.clear(); break;
      case 'create': this.create(s('id'), s('type'), s('parent'), (op.props as Props) ?? {}); break;
      case 'set': this.set(s('id'), (op.props as Props) ?? {}); break;
      case 'delete': this.remove(s('id')); break;
      case 'tween': this.addTween(op); break;
      case 'stop': this.stop(s('id')); break;
      case 'timeline': this.defineTimeline(op); break;
      case 'play': this.play(s('name')); break;
      case 'bind': this.bind(s('id'), s('prop'), s('expr'), typeof op.smooth === 'number' ? op.smooth : 0); break;
      case 'unbind': this.unbind(s('id'), s('prop')); break;
      case 'on': this.setEvents(s('id'), (op.events as string[]) ?? []); break;
      case 'state': this.defineState(s('id'), s('name'), (op.props as Props) ?? {}, Number(op.dur ?? 0.15), s('ease') || 'outCubic'); break;
      case 'draw': this.drawOp?.(op); break;
      default: break; // shader/font/image/vars are handled by the runtime
    }
  }

  /** Pixel canvas drawing is delegated (see canvas.ts) so that the scene stays free of raster code. */
  drawOp?: (op: GfxOp) => void;

  clear(): void {
    for (const n of [...this.nodes.values()]) if (n !== this.root) this.onDelete?.(n);
    this.nodes = new Map([['#root', this.root]]);
    this.root.children = [];
    this.tweens = [];
    this.timelines.clear();
    this.depIndex.clear();
    this.volatileB.clear();
  }

  get(id: string): GfxNode | undefined {
    return this.nodes.get(id);
  }

  create(id: string, type: string, parent: string, props: Props): GfxNode {
    if (!id) throw new Error('create needs an id');
    if (!NODE_TYPES.has(type)) throw new Error(`unknown object type "${type}"`);
    if (this.nodes.has(id)) this.remove(id);
    const p = parent ? this.nodes.get(parent) : this.root;
    if (!p) throw new Error(`parent "${parent}" does not exist`);
    const n = new GfxNode(id, type, {});
    n.seq = ++nodeSeq;
    this.nodes.set(id, n);
    n.parent = p;
    p.children.push(n);
    this.set(id, props);
    return n;
  }

  remove(id: string): void {
    const n = this.nodes.get(id);
    if (!n || n === this.root) return;
    for (const c of [...n.children]) this.remove(c.id);
    n.parent?.children.splice(n.parent.children.indexOf(n), 1);
    this.nodes.delete(id);
    for (const b of n.bindings.keys()) this.dropBinding(n, b);
    this.tweens = this.tweens.filter((t) => (t.target as { node?: GfxNode }).node !== n);
    this.onDelete?.(n);
  }

  /** Sets properties: "=expr" binds, text templates bind, plain values store. */
  set(id: string, props: Props): void {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`no object "${id}"`);
    this.dirty = true;
    for (const [k, v] of Object.entries(props)) {
      if (k === 'parent') { this.reparent(n, String(v)); continue; }
      if (typeof v === 'string' && v.startsWith('=')) { this.bind(id, k, v.slice(1)); continue; }
      if (k === 'text' && typeof v === 'string' && hasTemplate(v)) { this.bindTemplate(n, k, v); continue; }
      this.dropBinding(n, k);
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && (k === 'shadow' || k === 'u')) {
        n.props[k] = { ...(n.props[k] as object | undefined), ...(v as object) };
      } else n.props[k] = v;
      if (n.stateBase.has(k)) n.stateBase.set(k, v);
    }
    if (n.states.size > 0) this.applyStates(n);
  }

  private reparent(n: GfxNode, parent: string): void {
    const p = parent ? this.nodes.get(parent) : this.root;
    if (!p) throw new Error(`parent "${parent}" does not exist`);
    for (let a: GfxNode | null = p; a; a = a.parent) if (a === n) throw new Error('an object cannot be its own ancestor');
    n.parent?.children.splice(n.parent.children.indexOf(n), 1);
    n.parent = p;
    p.children.push(n);
  }

  // ------------------------------------------------------------------ bindings
  bind(id: string, prop: string, expr: string, smooth = 0): void {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`no object "${id}"`);
    const src = expr.trim();
    const tmpl = prop === 'text' && hasTemplate(src);
    this.attach(n, prop, tmpl ? compileTemplate(src) : compileExpr(src), smooth, tmpl);
  }

  private bindTemplate(n: GfxNode, prop: string, tmpl: string): void {
    this.attach(n, prop, compileTemplate(tmpl), 0, true);
  }

  private attach(n: GfxNode, prop: string, c: Compiled<Value | string>, smooth: number, tmpl: boolean): void {
    this.dropBinding(n, prop);
    const key = { n, prop };
    n.bindings.set(prop, { c, smooth, tmpl, key });
    for (const d of c.deps) {
      let set = this.depIndex.get(d);
      if (!set) this.depIndex.set(d, (set = new Set()));
      set.add(key);
    }
    if (c.volatile) this.volatileB.add(key);
    this.evalBinding(n, prop, true);
  }

  unbind(id: string, prop: string): void {
    const n = this.nodes.get(id);
    if (n) this.dropBinding(n, prop);
  }

  private dropBinding(n: GfxNode, prop: string): void {
    const b = n.bindings.get(prop);
    if (!b) return;
    n.bindings.delete(prop);
    for (const d of b.c.deps) this.depIndex.get(d)?.delete(b.key);
    this.volatileB.delete(b.key);
  }

  private evalBinding(n: GfxNode, prop: string, first = false): void {
    const b = n.bindings.get(prop);
    if (!b) return;
    this.ctx.time = this.time;
    let v: unknown = b.c.run(this.ctx);
    if (typeof v === 'string' && !b.tmpl && v !== '' && !Number.isNaN(Number(v)) && prop !== 'text') v = Number(v);
    if (v === undefined) return;
    if (b.last === v) return;
    b.last = v;
    this.dirty = true;
    if (b.smooth > 0 && !first && typeof v === 'number') {
      const cur = n.props[prop];
      if (typeof cur === 'number' && !prop.includes('.')) {
        this.tweenProp(n, prop, cur, v, b.smooth);
        return;
      }
    }
    this.setPath(n, prop, v);
  }

  /** "u.uPower" addresses a member of an object-valued property. */
  private setPath(n: GfxNode, prop: string, v: unknown): void {
    const i = prop.indexOf('.');
    if (i < 0) { n.props[prop] = v; return; }
    const head = prop.slice(0, i);
    const o = (n.props[head] as Record<string, unknown> | undefined) ?? {};
    n.props[head] = { ...o, [prop.slice(i + 1)]: v };
  }

  private tweenProp(n: GfxNode, prop: string, from: unknown, to: unknown, dur: number): void {
    const id = `#bind:${n.id}:${prop}`;
    this.tweens = this.tweens.filter((t) => t.id !== id);
    this.tweens.push(new Tween(id, { tracks: [{ prop, from, to }], dur, delay: 0, ease: 'outCubic', loop: 0, yoyo: false }, this.targetOf(n), this.time));
  }

  /** Variables changed: re-evaluate the bindings that read them. */
  varsChanged(names: Iterable<string>): void {
    const todo = new Set<{ n: GfxNode; prop: string }>();
    for (const nm of names) this.depIndex.get(nm)?.forEach((k) => todo.add(k));
    for (const k of todo) this.evalBinding(k.n, k.prop);
  }

  // ------------------------------------------------------------------ tweens
  private targetOf(n: GfxNode): Tween['target'] & { node: GfxNode } {
    return {
      node: n,
      get: (p) => n.props[p],
      set: (p, v) => { n.props[p] = v; this.dirty = true; },
      alive: () => this.nodes.get(n.id) === n,
    };
  }

  private addTween(op: GfxOp, at = this.time): void {
    const target = String(op.target ?? op.id ?? '');
    const n = this.nodes.get(target);
    if (!n) throw new Error(`no object "${target}"`);
    const tr = (op.tracks ?? {}) as Record<string, { from?: unknown; to: unknown }>;
    const tracks: Track[] = Object.entries(tr).map(([prop, t]) => ({ prop, from: t.from, to: t.to }));
    if (tracks.length === 0) throw new Error('a tween needs at least one track');
    const id = typeof op.id === 'string' && op.id ? op.id : `#t${++this.tweenSeq}`;
    // a new tween on the same properties replaces the old one (retargeting a button mid-animation)
    this.tweens = this.tweens.filter((t) => !(t.id === id || ((t.target as { node?: GfxNode }).node === n && t.spec.tracks.every((x) => tracks.some((y) => y.prop === x.prop)))));
    const spec: TweenSpec = {
      id, tracks, dur: Number(op.dur ?? 0.4), delay: Number(op.delay ?? 0), ease: String(op.ease ?? 'outCubic'),
      loop: Number(op.loop ?? 0), yoyo: op.yoyo === true, after: typeof op.after === 'string' ? op.after : undefined,
    };
    this.tweens.push(new Tween(id, spec, this.targetOf(n), at));
  }

  stop(id: string): void {
    this.tweens = this.tweens.filter((t) => t.id !== id && (t.target as { node?: GfxNode }).node?.id !== id);
    this.timelines.delete(id);
  }

  // ------------------------------------------------------------------ timelines
  private defineTimeline(op: GfxOp): void {
    const name = String(op.name ?? '');
    if (!name) throw new Error('a timeline needs a name');
    const steps = ((op.steps as { at: number; do: GfxOp }[]) ?? []).map((s) => ({ at: Number(s.at), do: s.do }));
    const prev = this.timelines.get(name);
    this.timelines.set(name, {
      name, steps, loop: Number(op.loop ?? 0), dur: typeof op.dur === 'number' ? op.dur : undefined,
      t0: prev?.t0 ?? this.time, running: prev?.running ?? false, fired: prev?.fired ?? 0, runs: prev?.runs ?? 0,
    });
    if (op.autoplay === true) this.play(name);
  }

  play(name: string): void {
    const t = this.timelines.get(name);
    if (!t) throw new Error(`no timeline "${name}"`);
    t.t0 = this.time; t.running = true; t.fired = 0; t.runs = 0;
  }

  private stepTimelines(): void {
    for (const t of this.timelines.values()) {
      if (!t.running) continue;
      const el = this.time - t.t0;
      const sorted = t.steps;
      while (t.fired < sorted.length && sorted[t.fired].at <= el) {
        const st = sorted[t.fired++];
        const o = { ...st.do };
        try {
          if (o.op === 'tween') this.addTween(o, t.t0 + st.at);
          else if (o.op === 'set') this.set(String(o.id), (o.props as Props) ?? {});
        } catch (e) { this.warn(`timeline ${t.name}: ${(e as Error).message}`); }
      }
      const total = t.dur ?? Math.max(0, ...sorted.map((s) => s.at + (s.do.op === 'tween' ? Number(s.do.dur ?? 0.4) + Number(s.do.delay ?? 0) : 0)));
      if (el >= total && t.fired >= sorted.length) {
        if (t.loop < 0 || t.runs < t.loop) { t.runs++; t.t0 = this.time; t.fired = 0; } else t.running = false;
      }
    }
  }

  // ------------------------------------------------------------------ interaction states
  private setEvents(id: string, events: string[]): void {
    if (id === '#scene') return; // scene-level handlers (close) live in the host; the renderer reports the event itself
    const n = this.nodes.get(id);
    if (!n) throw new Error(`no object "${id}"`);
    n.events = new Set(events);
  }

  private defineState(id: string, name: string, props: Props, dur: number, ease: string): void {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`no object "${id}"`);
    n.states.set(name, { props, dur, ease });
    for (const k of Object.keys(props)) if (!n.stateBase.has(k)) n.stateBase.set(k, n.props[k]);
    this.applyStates(n, true);
  }

  /** Switches a style state on or off for a node ("hover", "down", "active", custom). */
  setState(n: GfxNode, name: string, on: boolean): void {
    if (on === n.active.has(name)) return;
    if (on) n.active.add(name); else n.active.delete(name);
    this.applyStates(n);
  }

  private applyStates(n: GfxNode, instant = false): void {
    const want = new Map<string, unknown>(n.stateBase);
    let dur = 0.15, ease = 'outCubic';
    for (const nm of ['active', 'hover', 'down', ...n.active]) {
      if (!n.active.has(nm)) continue;
      const st = n.states.get(nm);
      if (!st) continue;
      dur = st.dur; ease = st.ease;
      for (const [k, v] of Object.entries(st.props)) want.set(k, v);
    }
    for (const [k, v] of want) {
      if (n.props[k] === v) continue;
      if (instant || dur <= 0) { n.props[k] = v; continue; }
      const id = `#state:${n.id}:${k}`;
      this.tweens = this.tweens.filter((t) => t.id !== id);
      this.tweens.push(new Tween(id, { tracks: [{ prop: k, to: v }], dur, delay: 0, ease, loop: 0, yoyo: false }, this.targetOf(n), this.time));
    }
    this.dirty = true;
  }

  // ------------------------------------------------------------------ clock
  /** Advances the scene clock. Returns true when anything changed (a redraw is needed). */
  update(dt: number): boolean {
    this.time += dt;
    this.ctx.time = this.time;
    // waiting tweens start when their predecessor is done
    for (const t of this.tweens) {
      if (t.waiting && t.spec.after && !this.tweens.some((o) => o.id === t.spec.after && !o.done)) t.release(this.time);
    }
    this.stepTimelines();
    let moved = false;
    for (const t of this.tweens) if (t.step(this.time)) moved = true;
    if (this.tweens.some((t) => t.done)) this.tweens = this.tweens.filter((t) => !t.done);
    for (const k of this.volatileB) this.evalBinding(k.n, k.prop);
    if (moved || this.volatileB.size > 0) this.dirty = true;
    const d = this.dirty;
    return d;
  }

  /** True while something keeps changing without further ops (tweens, volatile bindings, timelines, simulations). */
  get animating(): boolean {
    return this.tweens.length > 0 || this.volatileB.size > 0 || [...this.timelines.values()].some((t) => t.running);
  }

  /** Depth-first list of visible nodes in paint order (siblings by z, then creation). */
  walk(fn: (n: GfxNode, depth: number) => boolean | void): void {
    const rec = (n: GfxNode, depth: number): void => {
      const kids = n.children.length > 1 && n.children.some((c) => c.props.z !== undefined)
        ? [...n.children].sort((a, b) => a.num('z') - b.num('z'))
        : n.children;
      for (const c of kids) {
        if (c.props.visible === false || c.props.visible === 0 || c.props.visible === 'false') continue;
        if (fn(c, depth) === false) continue;
        rec(c, depth + 1);
      }
    };
    rec(this.root, 0);
  }
}

export { lerpValue };
