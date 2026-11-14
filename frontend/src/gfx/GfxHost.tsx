import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { EngineAPI } from '../api/types';
import { useUi } from '../state/stores';
import { GfxRenderer } from './renderer';
import { GfxRuntime } from './runtime';
import { holeClip, planScene, stripBasis, type Plan, type Rect } from './port';

/** Box of a scene in the output area. The host decides (planScene): a frame around the text port, or a strip that always
 * leaves the text its share; scenes cannot overlay the text or use margins. */
function placement(plan: Plan): React.CSSProperties {
  if (plan.mode === 'strip') return { flex: `0 0 ${stripBasis(plan.size)}`, minHeight: 0, position: 'relative', order: plan.dock === 'bottom' ? 2 : 0 };
  if (plan.mode === 'hidden') return { position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none' }; // too small for a usable text port: the text wins; kept to measure
  return { position: 'absolute', inset: 0 };
}

function SceneCanvas({ rt, id, setPorts }: { rt: GfxRuntime; id: string; setPorts(id: string, r: Ports | null): void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState('');
  const [box, setBox] = useState({ w: 0, h: 0 });
  const slot = rt.slot(id);
  const cfg = slot.scene.cfg;
  useEffect(() => {
    const canvas = cv.current, box = wrap.current;
    if (!canvas || !box) return;
    const e = rt.mount(id, canvas);
    setErr(e ?? '');
    if (e) { // WebGL missing or failing: say so and take the graphics away, the text and input are untouched
      rt.onMessage?.('error', `Graphics need WebGL2 (${e}); they were closed.`);
      rt.closeScene(id);
    }
    const size = (): void => {
      rt.resize(id, box.clientWidth, box.clientHeight, window.devicePixelRatio || 1);
      setBox((b) => (b.w === box.clientWidth && b.h === box.clientHeight ? b : { w: box.clientWidth, h: box.clientHeight }));
    };
    const ro = new ResizeObserver(size);
    ro.observe(box);
    size();
    const pt = (t: 'move' | 'down' | 'up' | 'leave' | 'wheel') => (ev: PointerEvent | WheelEvent): void => {
      const n = rt.pointer(slot, t, ev.clientX, ev.clientY);
      canvas.style.cursor = n ? 'pointer' : 'default';
      if (t === 'down' && n?.props.drag) canvas.setPointerCapture((ev as PointerEvent).pointerId);
    };
    const handlers: [string, (e: PointerEvent | WheelEvent) => void][] = [
      ['pointermove', pt('move')], ['pointerdown', pt('down')], ['pointerup', pt('up')], ['pointerleave', pt('leave')],
    ];
    // transparent overlay scenes let the window under them take the pointer unless an interactive object is hit
    const target: EventTarget = cfg.passthrough ? window : canvas;
    for (const [n, f] of handlers) target.addEventListener(n, f as EventListener);
    return () => {
      for (const [n, f] of handlers) target.removeEventListener(n, f as EventListener);
      ro.disconnect();
      rt.unmount(id);
    };
  }, [rt, id, slot, cfg.passthrough]);
  const plan = planScene(cfg, cfg.dock === 'full' ? box : { w: 1, h: 1 }); // cfg is mutated in place: recompute every render
  const out = plan.mode === 'frame' ? plan.out : null;
  const inp = plan.mode === 'frame' ? plan.input : null;
  const portKey = JSON.stringify([out, inp]);
  useEffect(() => {
    setPorts(id, out || inp ? { out, input: inp } : null);
    return () => setPorts(id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, portKey]);
  if (err) {
    return <div className="gfx-msg" role="alert">Graphics need WebGL2, which this window does not provide ({err}).</div>;
  }
  return (
    <div ref={wrap} className={`gfx-scene${cfg.passthrough ? ' passthrough' : ''}`} style={{ ...placement(plan), clipPath: out || inp ? holeClip(box, [out, inp].filter((r): r is Rect => !!r)) : undefined }} data-scene={id} tabIndex={-1} onPointerDown={(e) => e.currentTarget.focus({ preventScroll: true })}>
      <canvas ref={cv} />
      {!cfg.passthrough && (
        <button type="button" className="gfx-close" aria-label="Close graphics" onClick={() => rt.closeScene(id)}>
          &times;
        </button>
      )}
    </div>
  );
}

interface Ports { out: Rect | null; input: Rect | null }
interface GfxCtx { rt: GfxRuntime; ver: number; ports: Ports; origin: { x: number; y: number }; setPorts(id: string, r: Ports | null): void; setOrigin(o: { x: number; y: number }): void }
const GfxContext = createContext<GfxCtx | null>(null);

/** Where the game output must sit (CSS px in the output area) while a scene reserves a text port, else null. */
export function useGfxPort(): Rect | null {
  return useContext(GfxContext)?.ports.out ?? null;
}

/** Where the real input line must sit (CSS px relative to the layout root), or null. */
export function useGfxInput(): Rect | null {
  const c = useContext(GfxContext);
  const r = c?.ports.input;
  return c && r ? { x: r.x + c.origin.x, y: r.y + c.origin.y, w: r.w, h: r.h } : null;
}

/** The output area reports where it sits inside the layout root, so the input can be placed in the same frame. */
export function useGfxOrigin(): (o: { x: number; y: number }) => void {
  return useContext(GfxContext)?.setOrigin ?? (() => undefined);
}

/** Owns the graphics runtime for the window: feeds it the engine's "gfx", "gmcp" and "msdp" events. The scenes are
 * drawn by <GfxPane />, which the layout puts inside the output area. */
export function GfxProvider({ engine, children }: { engine: EngineAPI; children: ReactNode }) {
  const rt = useMemo(() => new GfxRuntime(), []);
  const [ver, force] = useState(0); // scenes opened/closed/moved: consumers of the context must redraw
  const [all, setAll] = useState<Record<string, Ports>>({});
  const [origin, setOriginState] = useState({ x: 0, y: 0 });
  const setPorts = useMemo(() => (id: string, r: Ports | null): void => setAll((p) => {
    if (JSON.stringify(p[id] ?? null) === JSON.stringify(r)) return p;
    const n = { ...p };
    if (r) n[id] = r; else delete n[id];
    return n;
  }), []);
  const setOrigin = useMemo(() => (o: { x: number; y: number }): void => setOriginState((p) => (p.x === o.x && p.y === o.y ? p : o)), []);
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
  // Escape hides the graphics when nothing else wants it: not from the input line, not over a dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const a = document.activeElement as HTMLElement | null;
      const typing = !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
      if (typing || document.querySelector('[role="dialog"]')) return;
      const open = [...rt.slots.values()].filter((s) => s.scene.cfg.open && !s.scene.cfg.passthrough);
      if (open.length === 0) return;
      open.forEach((s) => rt.closeScene(s.scene.id));
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rt]);
  const value = useMemo(
    () => ({ rt, ver, ports: Object.values(all)[0] ?? { out: null, input: null }, origin, setPorts, setOrigin }),
    [rt, ver, all, origin, setPorts, setOrigin],
  );
  return <GfxContext.Provider value={value}>{children}</GfxContext.Provider>;
}

/** The graphics of the open scenes, inside the output area: top/bottom scenes share it with the text output. */
export function GfxPane() {
  const ctx = useContext(GfxContext);
  if (!ctx) return null;
  const { rt, setPorts } = ctx;
  const open = [...rt.slots.values()].filter((s) => s.scene.cfg.open);
  if (open.length === 0) return null;
  if (!GfxRenderer.supported()) {
    return <div className="gfx-msg" role="alert">Graphics need WebGL2, which this window does not provide.</div>;
  }
  return <>{open.map((s) => <SceneCanvas key={s.scene.id} rt={rt} id={s.scene.id} setPorts={setPorts} />)}</>;
}
