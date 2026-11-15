import { useEffect, useRef, useState } from 'react';
import { useGfxRuntime } from '../gfx/GfxHost';
import { useSessions } from '../state/stores';
import { usePaneHost, type PaneInfo } from './panes';

// CMCP 2 panes (spec 20.14): the contexts a game wants on a panel, dock or float are drawn IN ADDITION to the main screen. SquatClient shows `dock`
// and `panel` as a column beside the workspace (a panel can be folded), and `float` as a window over it that is dragged by its title bar. The
// game's dock side, size and resizable are only hints; the player's arrangement (width, folded, position) is remembered per context type.

const mem = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(`cmcp-pane:${k}`); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown): void { try { localStorage.setItem(`cmcp-pane:${k}`, JSON.stringify(v)); } catch { /* no storage: the arrangement is not remembered */ } },
};

/** The canvas of one pane's scene: filled to its box, with the pointer reaching the scene's buttons. */
function PaneScene({ session, info }: { session: string; info: PaneInfo }) {
  const rt = useGfxRuntime(session);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = wrap.current;
    if (!rt || !box) return;
    const canvas = document.createElement('canvas');
    box.insertBefore(canvas, box.firstChild);
    if (rt.mount(info.scene, canvas)) { canvas.remove(); return; } // no WebGL2: the main screen says so; the pane stays empty
    const slot = rt.slot(info.scene);
    const size = (): void => rt.resize(info.scene, box.clientWidth, box.clientHeight, window.devicePixelRatio || 1);
    const ro = new ResizeObserver(size);
    ro.observe(box);
    size();
    const pt = (t: 'move' | 'down' | 'up') => (ev: PointerEvent): void => {
      const r = box.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (!inside && !slot.drag) { if (slot.hover) rt.pointer(slot, 'leave', 0, 0); return; }
      const n = rt.pointer(slot, t, ev.clientX, ev.clientY);
      if (n && t === 'down') { ev.preventDefault(); ev.stopPropagation(); }
    };
    const handlers: [string, (e: PointerEvent) => void][] = [['pointermove', pt('move')], ['pointerdown', pt('down')], ['pointerup', pt('up')]];
    for (const [n, f] of handlers) window.addEventListener(n, f as EventListener, true);
    return () => {
      for (const [n, f] of handlers) window.removeEventListener(n, f as EventListener, true);
      ro.disconnect();
      rt.unmount(info.scene);
      canvas.remove();
    };
  }, [rt, info.scene, info.ready]);
  return <div ref={wrap} className="cmcp-pane-scene gfx-scene" data-scene={info.scene} style={{ aspectRatio: `${info.w} / ${info.h}` }} />;
}

function Header({ info, folded, onFold, onClose }: { info: PaneInfo; folded?: boolean; onFold?: () => void; onClose: () => void }) {
  return (
    <div className="cmcp-pane-head">
      {onFold && (
        <button type="button" className="cmcp-pane-btn" aria-expanded={!folded} aria-label={folded ? `Open ${info.title}` : `Fold ${info.title}`} onClick={onFold}>
          {folded ? '▸' : '▾'}
        </button>
      )}
      <span className="cmcp-pane-title">{info.title}</span>
      <button type="button" className="cmcp-pane-btn" aria-label={`Hide ${info.title}`} title="Hide this pane for now" onClick={onClose}>&times;</button>
    </div>
  );
}

function Docked({ session, info, hide }: { session: string; info: PaneInfo; hide: () => void }) {
  const [folded, setFolded] = useState(() => mem.get(`${info.type}:folded`, false));
  return (
    <section className={`cmcp-pane cmcp-${info.surface}`} aria-label={info.title}>
      <Header info={info} folded={folded} onFold={() => { setFolded(!folded); mem.set(`${info.type}:folded`, !folded); }} onClose={hide} />
      {!folded && (info.ready ? <PaneScene session={session} info={info} /> : <p className="hint cmcp-pane-wait">Loading...</p>)}
    </section>
  );
}

function Floating({ session, info, hide }: { session: string; info: PaneInfo; hide: () => void }) {
  const [pos, setPos] = useState(() => mem.get(`${info.type}:pos`, { x: 80, y: 80 }));
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const onDown = (e: React.PointerEvent): void => { drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent): void => { if (drag.current) setPos({ x: Math.max(0, e.clientX - drag.current.dx), y: Math.max(0, e.clientY - drag.current.dy) }); };
  const onUp = (): void => { if (drag.current) { drag.current = null; mem.set(`${info.type}:pos`, pos); } };
  return (
    <section className="cmcp-pane cmcp-float" aria-label={info.title} style={{ left: pos.x, top: pos.y, width: info.w }}>
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} className="cmcp-float-drag"><Header info={info} onClose={hide} /></div>
      {info.ready ? <PaneScene session={session} info={info} /> : <p className="hint cmcp-pane-wait">Loading...</p>}
    </section>
  );
}

/** The panes of the foreground session. `children` is the workspace they sit beside. */
export function PaneHosts({ children }: { children: React.ReactNode }) {
  const fg = useSessions((s) => s.fg);
  const panes = usePaneHost((s) => (fg ? s.by[fg] : undefined)) ?? [];
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => { // a context that left the stack and came back is shown again (hiding lasts for the visit)
    setHidden((h) => { const keep = new Set([...h].filter((k) => panes.some((p) => p.key === k))); return keep.size === h.size ? h : keep; });
  }, [panes]);
  const shown = panes.filter((p) => !hidden.has(p.key));
  const hide = (k: string) => () => setHidden((h) => new Set(h).add(k));
  const side = shown.filter((p) => p.surface !== 'float');
  const floats = shown.filter((p) => p.surface === 'float');
  if (!fg || shown.length === 0) return <>{children}</>;
  const left = side.filter((p) => p.dock === 'left');
  const right = side.filter((p) => p.dock !== 'left');
  const col = (list: PaneInfo[], cls: string) => list.length > 0 && (
    <aside className={`cmcp-dock ${cls}`} aria-label="Game panes" style={{ width: Math.max(...list.map((p) => p.w)) }}>
      {list.map((p) => <Docked key={p.key} session={fg} info={p} hide={hide(p.key)} />)}
    </aside>
  );
  return (
    <div className="with-panes">
      {col(left, 'cmcp-dock-left')}
      <div className="with-panes-main">{children}</div>
      {col(right, 'cmcp-dock-right')}
      {floats.map((p) => <Floating key={p.key} session={fg} info={p} hide={hide(p.key)} />)}
    </div>
  );
}
