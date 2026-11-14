import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { EngineAPI } from '../api/types';
import { useUi } from '../state/stores';
import { GfxRenderer } from './renderer';
import { GfxRuntime } from './runtime';
import { holeClip, planScene, portNodeOf, stripBasis, type Plan, type Rect } from './port';
import type { GfxNode } from './scene';

/** The rectangle where the real game text sits while a scene has a text port (CSS px in the output area). Mutable on
 * purpose: an animated port (the console's LOG toggle) changes every frame and must not go through React renders. */
export class PortStore {
  rect: Rect | null = null;
  private subs = new Set<(r: Rect | null) => void>();
  set(r: Rect | null): void {
    const a = this.rect;
    if (a === r || (a && r && a.x === r.x && a.y === r.y && a.w === r.w && a.h === r.h)) return;
    this.rect = r;
    this.subs.forEach((f) => f(r));
  }
  subscribe(f: (r: Rect | null) => void): () => void {
    this.subs.add(f);
    return () => this.subs.delete(f);
  }
}

interface GfxCtx { rt: GfxRuntime; ver: number; store: PortStore }
const GfxContext = createContext<GfxCtx | null>(null);

/** The output area (the layout's text) subscribes to follow the port: it is moved by direct style writes, every frame. */
export function useGfxPortStore(): PortStore | null {
  return useContext(GfxContext)?.store ?? null;
}

/** The scene's text-port rectangle in scene units: the animated node named by `portNode`, else the static `port`. */
function portArray(slotNode: GfxNode | undefined, cfgPort: unknown): unknown {
  if (!slotNode) return cfgPort;
  return [slotNode.num('x'), slotNode.num('y'), slotNode.num('w'), slotNode.num('h')];
}

/** Box of a scene in the output area. A strip shares it with the text; a frame fills it, with the text showing through. */
function placement(plan: Plan): React.CSSProperties {
  if (plan.mode === 'strip') return { flex: `0 0 ${stripBasis(plan.size)}`, minHeight: 0, position: 'relative', order: plan.dock === 'bottom' ? 2 : 0 };
  return { position: 'absolute', inset: 0 };
}

function SceneCanvas({ rt, id, store }: { rt: GfxRuntime; id: string; store: PortStore }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState('');
  const slot = rt.slot(id);
  const cfg = slot.scene.cfg;
  const kind = cfg.dock === 'full' && (portNodeOf(cfg) || Array.isArray(cfg.port)) ? 'frame' : 'strip';
  const stripPlan = planScene(cfg, { w: 1, h: 1 });
  useEffect(() => {
    const canvas = cv.current, box = wrap.current;
    if (!canvas || !box) return;
    const e = rt.mount(id, canvas);
    setErr(e ?? '');
    if (e) { // WebGL missing or failing: say so and take the graphics away, the text and input are untouched
      rt.onMessage?.('error', `Graphics need WebGL2 (${e}); they were closed.`);
      rt.closeScene(id);
    }
    const size = (): void => rt.resize(id, box.clientWidth, box.clientHeight, window.devicePixelRatio || 1);
    const ro = new ResizeObserver(size);
    ro.observe(box);
    size();
    // every frame: follow the (possibly animated) text port, cut the hole, and tell the text where to sit
    let raf = 0;
    const follow = (): void => {
      raf = requestAnimationFrame(follow);
      if (cfg.dock !== 'full' || !(portNodeOf(cfg) || Array.isArray(cfg.port))) { store.set(null); return; }
      const arr = portArray(portNodeOf(cfg) ? slot.scene.get(portNodeOf(cfg)!) : undefined, cfg.port);
      const b = { w: box.clientWidth, h: box.clientHeight };
      const plan = planScene({ ...cfg, port: arr as [number, number, number, number] }, b);
      if (plan.mode === 'frame') {
        box.style.visibility = 'visible';
        box.style.clipPath = holeClip(b, plan.out);
        store.set(plan.out);
      } else {
        box.style.visibility = 'hidden'; // too small for the scene plus a usable text port: the text wins
        box.style.clipPath = '';
        store.set(null);
      }
    };
    follow();
    // pointer: the canvas never takes events (so the text pane keeps wheel, selection, links); the scene gets only what
    // falls outside the text port and hits one of its interactive objects
    const pt = (t: 'move' | 'down' | 'up') => (ev: PointerEvent): void => {
      if (cfg.dock === 'full' && store.rect && !slot.drag) {
        const r = box.getBoundingClientRect();
        const x = ev.clientX - r.left, y = ev.clientY - r.top, p = store.rect;
        if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) { rt.pointer(slot, 'leave', 0, 0); return; }
      }
      const r = box.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (!inside && !slot.drag) { if (slot.hover) rt.pointer(slot, 'leave', 0, 0); return; }
      const n = rt.pointer(slot, t, ev.clientX, ev.clientY);
      document.documentElement.style.cursor = n ? 'pointer' : '';
      if (n && t === 'down') { ev.preventDefault(); ev.stopPropagation(); }
    };
    const handlers: [string, (e: PointerEvent) => void][] = [['pointermove', pt('move')], ['pointerdown', pt('down')], ['pointerup', pt('up')]];
    for (const [n, f] of handlers) window.addEventListener(n, f as EventListener, true);
    return () => {
      cancelAnimationFrame(raf);
      for (const [n, f] of handlers) window.removeEventListener(n, f as EventListener, true);
      document.documentElement.style.cursor = '';
      ro.disconnect();
      store.set(null);
      rt.unmount(id);
    };
  }, [rt, id, slot, store, cfg]);
  if (err) {
    return <div className="gfx-msg" role="alert">Graphics need WebGL2, which this window does not provide ({err}).</div>;
  }
  return (
    <div ref={wrap} className="gfx-scene" style={placement(kind === 'frame' ? { mode: 'frame', out: { x: 0, y: 0, w: 0, h: 0 }, input: null } : stripPlan)} data-scene={id}>
      <canvas ref={cv} />
      <button type="button" className="gfx-close" aria-label="Close graphics" onClick={() => rt.closeScene(id)}>
        &times;
      </button>
    </div>
  );
}

function parseKey(spec: string): { key: string; alt: boolean; ctrl: boolean; shift: boolean } {
  const parts = spec.toLowerCase().split('+');
  return { key: parts[parts.length - 1], alt: parts.includes('alt'), ctrl: parts.includes('ctrl'), shift: parts.includes('shift') };
}

/** Owns the graphics runtime for the window: feeds it the engine's "gfx", "gmcp" and "msdp" events. The scenes are
 * drawn by <GfxPane />, which the layout puts inside the output area. */
export function GfxProvider({ engine, children }: { engine: EngineAPI; children: ReactNode }) {
  const rt = useMemo(() => new GfxRuntime(), []);
  const store = useMemo(() => new PortStore(), []);
  const [ver, force] = useState(0); // scenes opened/closed/moved: consumers of the context must redraw
  useEffect(() => {
    rt.onLayout = () => force((n) => n + 1);
    rt.onEvent = (e) => void engine.gfxEvent(e.scene, e.id, e.event, e.x, e.y).catch(() => undefined);
    rt.onMessage = (lvl, text) => {
      (lvl === 'error' ? console.error : console.warn)(text);
      useUi.getState().toast(lvl === 'error' ? 'error' : 'warn', text);
    };
    const offs = [
      engine.on('gfx', (ops) => rt.apply(ops)),
      engine.on('gmcp', (p) => rt.setGmcp(p.package, p.data)),
      engine.on('msdp', (p) => rt.setMsdp(p.vars)),
    ];
    void engine.gfxSnapshot().then((ops) => { if (ops.length) rt.apply(ops); }).catch(() => undefined);
    return () => { offs.forEach((o) => o()); rt.stop(); };
  }, [rt, engine]);
  // Escape hides the graphics when nothing else wants it; Alt+key shortcuts of objects (key="alt+l") click them
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const a = document.activeElement as HTMLElement | null;
      const typing = !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (typing || document.querySelector('[role="dialog"]')) return;
        const open = [...rt.slots.values()].filter((s) => s.scene.cfg.open);
        if (open.length === 0) return;
        open.forEach((s) => rt.closeScene(s.scene.id));
        e.preventDefault();
        return;
      }
      if (!e.altKey && !e.ctrlKey) return;
      for (const s of rt.slots.values()) {
        if (!s.scene.cfg.open) continue;
        for (const n of s.scene.nodes.values()) {
          const spec = n.props.key;
          if (typeof spec !== 'string' || !n.events.has('click')) continue;
          const k = parseKey(spec);
          if (e.key.toLowerCase() === k.key && e.altKey === k.alt && e.ctrlKey === k.ctrl && e.shiftKey === k.shift) {
            rt.onEvent?.({ scene: s.scene.id, id: n.id, event: 'click', x: 0, y: 0 });
            e.preventDefault();
            return;
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rt]);
  const value = useMemo(() => ({ rt, ver, store }), [rt, ver, store]);
  return <GfxContext.Provider value={value}>{children}</GfxContext.Provider>;
}

/** The graphics of the open scenes, inside the output area: strips share it with the text output, a frame surrounds it. */
export function GfxPane() {
  const ctx = useContext(GfxContext);
  if (!ctx) return null;
  const { rt, store } = ctx;
  const open = [...rt.slots.values()].filter((s) => s.scene.cfg.open);
  if (open.length === 0) return null;
  if (!GfxRenderer.supported()) {
    return <div className="gfx-msg" role="alert">Graphics need WebGL2, which this window does not provide.</div>;
  }
  return <>{open.map((s) => <SceneCanvas key={s.scene.id} rt={rt} id={s.scene.id} store={store} />)}</>;
}
