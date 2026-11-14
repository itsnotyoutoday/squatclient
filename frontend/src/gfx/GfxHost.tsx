import { useEffect, useMemo, useRef, useState } from 'react';
import type { EngineAPI } from '../api/types';
import { GfxRenderer } from './renderer';
import { GfxRuntime, type Slot } from './runtime';

/** Where a scene sits inside the workspace. */
function placement(cfg: Slot['scene']['cfg']): React.CSSProperties {
  const [t, r, b, l] = cfg.margin;
  const size = typeof cfg.size === 'number' ? `${cfg.size}px` : cfg.size;
  const base: React.CSSProperties = { position: 'absolute' };
  switch (cfg.dock) {
    case 'top': return { ...base, left: l, right: r, top: t, height: size ?? '30%' };
    case 'bottom': return { ...base, left: l, right: r, bottom: b, height: size ?? '30%' };
    case 'left': return { ...base, left: l, top: t, bottom: b, width: size ?? '30%' };
    case 'right': return { ...base, right: r, top: t, bottom: b, width: size ?? '30%' };
    case 'float': return { ...base, left: l, top: t, width: size ?? 480, height: size ?? 320 };
    default: return { ...base, inset: `${t}px ${r}px ${b}px ${l}px` };
  }
}

function SceneCanvas({ rt, id }: { rt: GfxRuntime; id: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState('');
  const slot = rt.slot(id);
  const cfg = slot.scene.cfg;
  useEffect(() => {
    const canvas = cv.current, box = wrap.current;
    if (!canvas || !box) return;
    const e = rt.mount(id, canvas);
    setErr(e ?? '');
    const size = (): void => rt.resize(id, box.clientWidth, box.clientHeight, window.devicePixelRatio || 1);
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
  if (err) {
    return <div className="gfx-msg" role="alert">Graphics need WebGL2, which this window does not provide ({err}).</div>;
  }
  return (
    <div ref={wrap} className={`gfx-scene${cfg.passthrough ? ' passthrough' : ''}`} style={placement(cfg)} data-scene={id}>
      <canvas ref={cv} />
      {!cfg.passthrough && cfg.dock === 'full' && (
        <button type="button" className="gfx-close" aria-label="Close graphics" onClick={() => rt.apply([{ op: 'scene', scene: id, open: false }])}>
          &times;
        </button>
      )}
    </div>
  );
}

/** The window's graphics layer: one canvas per open scene, fed by the "gfx" events of the engine. */
export function GfxHost({ engine }: { engine: EngineAPI }) {
  const rt = useMemo(() => new GfxRuntime(), []);
  const [, force] = useState(0);
  useEffect(() => {
    rt.onLayout = () => force((n) => n + 1);
    rt.onEvent = (e) => void engine.gfxEvent(e.scene, e.id, e.event, e.x, e.y).catch(() => undefined);
    rt.onMessage = (lvl, text) => (lvl === 'error' ? console.error(text) : console.warn(text));
    const offs = [
      engine.on('gfx', (ops) => rt.apply(ops)),
      engine.on('gmcp', (p) => rt.setGmcp(p.package, p.data)),
      engine.on('msdp', (p) => rt.setMsdp(p.vars)),
    ];
    void engine.gfxSnapshot().then((ops) => { if (ops.length) rt.apply(ops); }).catch(() => undefined);
    return () => { offs.forEach((o) => o()); rt.stop(); };
  }, [rt, engine]);
  const open = [...rt.slots.values()].filter((s) => s.scene.cfg.open);
  if (open.length === 0) return null;
  if (!GfxRenderer.supported()) {
    return <div className="gfx-layer"><div className="gfx-msg" role="alert">Graphics need WebGL2, which this window does not provide.</div></div>;
  }
  return (
    <div className="gfx-layer">
      {open.map((s) => <SceneCanvas key={s.scene.id} rt={rt} id={s.scene.id} />)}
    </div>
  );
}
