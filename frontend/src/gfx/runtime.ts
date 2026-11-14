/**
 * The graphics runtime: receives scene operations and variables, owns the scenes, drives the frame loop (animation
 * runs here at display rate, no script ticks), maps pointer events to objects and reports them to the host.
 */
import { buildScene, pick, type BuildResult } from './build';
import { PixelCanvas } from './canvas';
import type { Value } from './expr';
import { GfxRenderer } from './renderer';
import { DEFAULT_CONFIG, GfxNode, Scene } from './scene';
import type { GfxEventOut, GfxOp, PointerEventName } from './types';
import { apply, invert } from './geom';

/** Flattens a JSON value into dotted keys: prefix:Char.Vitals.hp, arrays by index. */
export function flatten(prefix: string, v: unknown, out: Record<string, Value>): void {
  if (v === null || v === undefined) return;
  if (typeof v === 'number' || typeof v === 'string') { out[prefix] = v; return; }
  if (typeof v === 'boolean') { out[prefix] = v ? 1 : 0; return; }
  if (Array.isArray(v)) {
    out[prefix + '.length'] = v.length;
    v.forEach((x, i) => flatten(`${prefix}.${i}`, x, out));
    return;
  }
  if (typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(`${prefix}.${k}`, x, out);
}

export interface Slot {
  scene: Scene;
  canvases: Map<string, PixelCanvas>;
  canvas?: HTMLCanvasElement;
  renderer?: GfxRenderer;
  built?: BuildResult;
  hover: GfxNode | null;
  pressed: GfxNode | null;
  drag?: { node: GfxNode; home: [number, number]; r: number; scale: number; vx: string; vy: string; lastMove: number; lastEmit: number; settled: boolean };
  lastFrame: number;
  frameTimes: number[];
  fps: number;
  logical: { w: number; h: number };
  error?: string;
  alpha: boolean;
}

export class GfxRuntime {
  readonly slots = new Map<string, Slot>();
  readonly vars = new Map<string, Value>();
  onEvent?: (e: GfxEventOut) => void;
  /** a scene opened, closed or changed its placement: the host re-renders its canvases */
  onLayout?: () => void;
  onMessage?: (level: 'warn' | 'error', text: string) => void;
  private shaders = new Map<string, { glsl: string; uniforms: Record<string, string> }>();
  private fonts = new Set<string>();
  private images = new Map<string, HTMLImageElement>();
  private raf = 0;
  private running = false;
  private last = 0;

  // ------------------------------------------------------------------ ops
  slot(id: string): Slot {
    let s = this.slots.get(id);
    if (!s) {
      const scene = new Scene(id, { vars: this.vars });
      s = { scene, canvases: new Map(), hover: null, pressed: null, lastFrame: 0, frameTimes: [], fps: 0, logical: { w: 0, h: 0 }, alpha: false };
      const slot = s;
      scene.onDelete = (n): void => {
        slot.renderer?.forget(n);
        slot.canvases.delete(n.id);
        if (slot.hover === n) slot.hover = null;
        if (slot.pressed === n) slot.pressed = null;
      };
      scene.drawOp = (op): void => {
        const pc = slot.canvases.get(String(op.id));
        if (pc) pc.apply(op);
      };
      this.slots.set(id, s);
    }
    return s;
  }

  /** Applies a batch of operations. Unknown ones are ignored with a warning in the scene's log. */
  apply(ops: GfxOp[]): void {
    for (const op of ops) this.applyOne(op);
    this.start();
  }

  private applyOne(op: GfxOp): void {
    switch (op.op) {
      case 'vars': this.setVars((op.vars as Record<string, unknown>) ?? {}); return;
      case 'shader': this.defineShader(String(op.name), String(op.glsl ?? ''), (op.uniforms as Record<string, string>) ?? {}); return;
      case 'font': this.defineFont(String(op.name), String(op.src), op.weight as string | undefined, op.style as string | undefined); return;
      case 'image': this.defineImage(String(op.name), String(op.src)); return;
      default: break;
    }
    const id = String(op.scene ?? 'main');
    const slot = this.slot(id);
    const wasOpen = slot.scene.cfg.open;
    const place = JSON.stringify([slot.scene.cfg.dock, slot.scene.cfg.size, slot.scene.cfg.margin, slot.scene.cfg.w, slot.scene.cfg.h, slot.scene.cfg.bg === 'none']);
    if (op.op === 'create' && op.type === 'pixelcanvas') {
      const p = (op.props ?? {}) as Record<string, unknown>;
      slot.canvases.set(String(op.id), new PixelCanvas(Number(p.w) || 1, Number(p.h) || 1, typeof p.bg === 'string' ? p.bg : undefined));
    }
    if (op.op === 'clear') slot.canvases.clear();
    slot.scene.apply(op);
    if (op.op === 'scene') {
      const c = slot.scene.cfg;
      if (op.pixel === true && op.w === undefined) { c.w = 0; c.h = 0; }
      const placed = JSON.stringify([c.dock, c.size, c.margin, c.w, c.h, c.bg === 'none']);
      if (wasOpen !== c.open || place !== placed) this.onLayout?.();
    }
    for (const w of slot.scene.warnings.splice(0)) this.onMessage?.('warn', `gfx ${id}: ${w}`);
  }

  setVars(vars: Record<string, unknown>): void {
    const changed: string[] = [];
    for (const [k, raw] of Object.entries(vars)) {
      const v = (typeof raw === 'number' || typeof raw === 'string' ? raw : typeof raw === 'boolean' ? (raw ? 1 : 0) : raw === null || raw === undefined ? '' : String(raw)) as Value;
      if (this.vars.get(k) === v) continue;
      this.vars.set(k, v);
      changed.push(k);
    }
    if (changed.length) for (const s of this.slots.values()) s.scene.varsChanged(changed);
  }

  /** GMCP package data becomes gmcp:Package.field variables. */
  setGmcp(pkg: string, data: unknown): void {
    const out: Record<string, Value> = {};
    flatten(`gmcp:${pkg}`, data, out);
    this.setVars(out);
  }

  setMsdp(vars: Record<string, unknown>): void {
    const out: Record<string, Value> = {};
    for (const [k, v] of Object.entries(vars)) flatten(`msdp:${k}`, v, out);
    this.setVars(out);
  }

  defineShader(name: string, glsl: string, uniforms: Record<string, string>): void {
    this.shaders.set(name, { glsl, uniforms });
    for (const s of this.slots.values()) s.renderer?.defineShader(name, { glsl, uniforms });
    this.markAll();
  }

  defineFont(name: string, src: string, weight?: string, style?: string): void {
    if (typeof FontFace === 'undefined') return;
    const key = `${name}|${weight ?? ''}|${style ?? ''}|${src.length}`;
    if (this.fonts.has(key)) return;
    this.fonts.add(key);
    const ff = new FontFace(name, `url(${src})`, { weight: weight ?? '100 900', style: style ?? 'normal' });
    ff.load().then((f) => {
      document.fonts.add(f);
      for (const s of this.slots.values()) s.renderer?.invalidateText();
      this.markAll();
    }).catch((e: unknown) => this.onMessage?.('warn', `gfx font ${name}: ${String(e)}`));
  }

  defineImage(name: string, src: string): void {
    if (typeof Image === 'undefined') return;
    const img = new Image();
    img.onload = (): void => {
      this.images.set(name, img);
      for (const s of this.slots.values()) s.renderer?.images.set(name, img);
      this.markAll();
    };
    img.onerror = (): void => this.onMessage?.('warn', `gfx image ${name}: cannot load`);
    img.src = src;
  }

  private markAll(): void {
    for (const s of this.slots.values()) s.scene.dirty = true;
    this.start();
  }

  // ------------------------------------------------------------------ mounting
  /** Opens a renderer on a canvas for the scene. Returns an error message when WebGL2 is missing. */
  mount(id: string, canvas: HTMLCanvasElement): string | null {
    const slot = this.slot(id);
    if (slot.canvas === canvas && slot.renderer && !slot.renderer.lost) return null;
    slot.renderer?.dispose();
    slot.canvas = canvas;
    slot.alpha = slot.scene.cfg.bg === 'none' || slot.scene.cfg.bg === 'transparent';
    try {
      const r = new GfxRenderer(canvas, { alpha: slot.alpha });
      r.onShaderError = (n, log): void => this.onMessage?.('error', `gfx shader ${n}: ${log}`);
      for (const [n, d] of this.shaders) r.defineShader(n, d);
      for (const [n, i] of this.images) r.images.set(n, i);
      slot.renderer = r;
      slot.error = undefined;
      canvas.addEventListener('webglcontextrestored', () => { slot.renderer = undefined; slot.scene.dirty = true; });
    } catch (e) {
      slot.renderer = undefined;
      slot.error = (e as Error).message;
      return slot.error;
    }
    slot.scene.dirty = true;
    this.start();
    return null;
  }

  unmount(id: string): void {
    const s = this.slots.get(id);
    if (!s) return;
    s.renderer?.dispose();
    s.renderer = undefined;
    s.canvas = undefined;
  }

  /** Resizes the scene's canvas (css px) with a device pixel ratio. */
  resize(id: string, cssW: number, cssH: number, dpr: number): void {
    const s = this.slots.get(id);
    if (!s?.renderer) return;
    let k = Math.min(dpr, 2);
    const px = cssW * cssH * k * k;
    if (px > 8e6) k *= Math.sqrt(8e6 / px);
    s.logical = { w: cssW, h: cssH };
    s.renderer.resize(Math.round(cssW * k), Math.round(cssH * k));
    s.scene.dirty = true;
    this.start();
  }

  // ------------------------------------------------------------------ frame loop
  start(): void {
    if (this.running || typeof requestAnimationFrame === 'undefined') return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (now: number): void => {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    let alive = false;
    for (const slot of this.slots.values()) {
      if (!slot.scene.cfg.open) continue;
      if (this.tick(slot, dt, now)) alive = true;
    }
    if (alive || this.slots.size === 0) this.raf = requestAnimationFrame(this.frame);
    else this.running = false;
  };

  /** True when this scene keeps needing frames. */
  tick(slot: Slot, dt: number, now: number): boolean {
    const sc = slot.scene;
    if (slot.drag && !slot.drag.settled && now - slot.drag.lastMove > 300) this.dragEmit(slot, 'settle');
    const changed = sc.update(dt);
    const r = slot.renderer;
    const timeDependent = slot.built?.items.some((i) => i.k === 'stars' || i.k === 'particles' || i.k === 'custom') ?? true;
    if (!r || r.lost) return false;
    if (!changed && !timeDependent && !sc.animating) return false;
    const logical = sc.cfg.w > 0 && sc.cfg.h > 0 ? { w: sc.cfg.w, h: sc.cfg.h } : slot.logical;
    if (logical.w <= 0 || logical.h <= 0) return true;
    const t0 = performance.now();
    slot.built = buildScene(sc, {
      defaultFont: sc.cfg.font, getVar: (n) => this.vars.get(n) as number | string | undefined, canvases: slot.canvases, hasShader: (n) => r.hasShader(n),
    });
    try {
      r.render(sc, slot.built, sc.time, logical);
    } catch (e) {
      slot.error = (e as Error).message;
      this.onMessage?.('error', `gfx ${sc.id}: ${slot.error}`);
      slot.renderer = undefined;
      return false;
    }
    sc.dirty = false;
    const ft = performance.now() - t0;
    slot.frameTimes.push(ft);
    if (slot.frameTimes.length > 60) slot.frameTimes.shift();
    if (slot.lastFrame) slot.fps = slot.fps * 0.9 + (1000 / Math.max(1, now - slot.lastFrame)) * 0.1;
    slot.lastFrame = now;
    return true;
  }

  /** Mean CPU time (ms) per frame over the last 60 frames, and the smoothed frame rate. */
  stats(id: string): { fps: number; cpuMs: number; items: number } {
    const s = this.slots.get(id);
    if (!s) return { fps: 0, cpuMs: 0, items: 0 };
    const ft = s.frameTimes;
    return { fps: s.fps, cpuMs: ft.length ? ft.reduce((a, b) => a + b, 0) / ft.length : 0, items: s.built?.items.length ?? 0 };
  }

  // ------------------------------------------------------------------ pointer
  /** Logical scene coordinates of a client position on the scene's canvas. */
  toScene(slot: Slot, clientX: number, clientY: number): [number, number] | null {
    const c = slot.canvas, r = slot.renderer;
    if (!c || !r) return null;
    const rect = c.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const m = r.mapping;
    const dx = (clientX - rect.left) * (c.width / rect.width), dy = (clientY - rect.top) * (c.height / rect.height);
    return [(dx - m.ox) / m.sx, (dy - m.oy) / m.sy];
  }

  /** Handles a pointer event for a scene. Returns the object it hit (interactive objects only) or null. */
  pointer(slot: Slot, type: 'move' | 'down' | 'up' | 'leave' | 'wheel', clientX: number, clientY: number): GfxNode | null {
    const p = type === 'leave' ? null : this.toScene(slot, clientX, clientY);
    if (slot.drag) {
      if (type === 'move' && p) this.dragMove(slot, p[0], p[1]);
      if (type === 'up') this.dragEnd(slot);
      return slot.drag?.node ?? null;
    }
    const hit = p && slot.built ? pick(slot.built.hit, p[0], p[1]) : null;
    const id = slot.scene.id;
    const emit = (n: GfxNode, event: PointerEventName): void => {
      if (n.events.has(event)) this.onEvent?.({ scene: id, id: n.id, event, x: p?.[0] ?? 0, y: p?.[1] ?? 0 });
    };
    if (hit !== slot.hover) {
      if (slot.hover) { slot.scene.setState(slot.hover, 'hover', false); slot.scene.setState(slot.hover, 'down', false); emit(slot.hover, 'leave'); }
      slot.hover = hit;
      if (hit) { slot.scene.setState(hit, 'hover', true); emit(hit, 'enter'); }
      this.start();
    }
    if (hit) {
      if (type === 'move') emit(hit, 'move');
      if (type === 'wheel') emit(hit, 'wheel');
      if (type === 'down' && hit.props.drag && p) { this.dragStart(slot, hit); return hit; }
      if (type === 'down') { slot.pressed = hit; slot.scene.setState(hit, 'down', true); emit(hit, 'down'); this.start(); }
      if (type === 'up') {
        slot.scene.setState(hit, 'down', false);
        emit(hit, 'up');
        if (slot.pressed === hit) emit(hit, 'click');
        slot.pressed = null;
        this.start();
      }
    } else if (type === 'up' && slot.pressed) {
      slot.scene.setState(slot.pressed, 'down', false);
      slot.pressed = null;
    }
    return hit;
  }

  // ------------------------------------------------------------------ dragging (joysticks, sliders)
  // A node with drag = {r, home, vx, vy, scale} follows the pointer inside a circle of radius r around where it
  // started; its offset (scaled, -scale..scale) is written to the variables vx and vy at display rate, so bound
  // readouts update without any script. Events: "drag" (throttled), "settle" (pointer still for 300 ms, or released).
  private dragStart(slot: Slot, n: GfxNode): void {
    const d = n.props.drag as { r?: number; home?: boolean; vx?: string; vy?: string; scale?: number };
    slot.scene.stop(n.id);
    slot.pressed = null;
    const home: [number, number] = [n.num('x'), n.num('y')];
    n.sim.home = home;
    slot.drag = { node: n, home, r: Math.max(1, d.r ?? 40), scale: d.scale ?? 100, vx: d.vx ?? '', vy: d.vy ?? '', lastMove: performance.now(), lastEmit: 0, settled: true };
    slot.scene.setState(n, 'down', true);
    this.start();
  }

  private dragMove(slot: Slot, sx: number, sy: number): void {
    const d = slot.drag!;
    const par = d.node.parent;
    const inv = par && par.id !== '#root' ? invert(par.world) : null;
    const [px, py] = inv ? apply(inv, sx, sy) : [sx, sy];
    let dx = px - d.home[0], dy = py - d.home[1];
    const len = Math.hypot(dx, dy);
    if (len > d.r) { dx = (dx / len) * d.r; dy = (dy / len) * d.r; }
    d.node.props.x = d.home[0] + dx;
    d.node.props.y = d.home[1] + dy;
    d.node.sim.off = [Math.round((dx / d.r) * d.scale), Math.round((dy / d.r) * d.scale)];
    const vars: Record<string, number> = {};
    if (d.vx) vars[d.vx] = (d.node.sim.off as number[])[0];
    if (d.vy) vars[d.vy] = (d.node.sim.off as number[])[1];
    this.setVars(vars);
    slot.scene.dirty = true;
    const now = performance.now();
    d.lastMove = now;
    d.settled = false;
    if (now - d.lastEmit > 100) this.dragEmit(slot, 'drag');
    this.start();
  }

  private dragEmit(slot: Slot, event: 'drag' | 'settle'): void {
    const d = slot.drag;
    if (!d) return;
    const off = (d.node.sim.off as number[] | undefined) ?? [0, 0];
    if (event === 'settle') d.settled = true;
    else d.lastEmit = performance.now();
    if (d.node.events.has(event)) this.onEvent?.({ scene: slot.scene.id, id: d.node.id, event, x: off[0], y: off[1] });
  }

  private dragEnd(slot: Slot): void {
    const d = slot.drag!;
    if (!d.settled) this.dragEmit(slot, 'settle');
    slot.drag = undefined;
    slot.scene.setState(d.node, 'down', false);
    const spec = d.node.props.drag as { home?: boolean };
    if (spec.home !== false) { // spring back to where it started
      slot.scene.apply({ op: 'tween', target: d.node.id, tracks: { x: { to: d.home[0] }, y: { to: d.home[1] } }, dur: 0.35, ease: 'outBack' });
      const vars: Record<string, number> = {};
      if (d.vx) vars[d.vx] = 0;
      if (d.vy) vars[d.vy] = 0;
      this.setVars(vars);
      d.node.sim.off = [0, 0];
    }
    this.start();
  }

  /** Sets the scene up for tests and the dev page: stays out of the frame loop until ticked by hand. */
  advance(id: string, seconds: number, step = 1 / 60): void {
    const slot = this.slot(id);
    for (let t = 0; t < seconds; t += step) this.tick(slot, step, performance.now());
  }

  /** World -> screen position of an object (tests, tooltips). */
  screenPos(n: GfxNode, lx = 0, ly = 0): [number, number] {
    return apply(n.world, lx, ly);
  }
}

export { DEFAULT_CONFIG };
