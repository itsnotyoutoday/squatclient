import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { EngineAPI } from '../api/types';
import { useSessions, useSettings, useUi } from '../state/stores';
import { GfxRenderer } from './renderer';
import { GfxRuntime } from './runtime';
import { holeClip, planScene, portNodeOf, stripBasis, type Plan, type Rect } from './port';
import type { GfxNode } from './scene';
import { CmcpController } from '../cmcp/controller';
import { CmcpAudio, WebAudioBackend } from '../cmcp/audio';
import { collectPrompts } from '../cmcp/prompts';
import { CmcpOverlays } from '../cmcp/OverlayLayer';
import { getActiveCmcp, usePane } from '../cmcp/pane';

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

/** One session's graphics: its own runtime (scenes, variables) and its own text port. */
export interface SessionGfx { rt: GfxRuntime; store: PortStore }
interface GfxCtx { get(session: string): SessionGfx; peek(session: string): SessionGfx | undefined; ver: number }
const GfxContext = createContext<GfxCtx | null>(null);

/** The output area (the layout's text) subscribes to follow the port: it is moved by direct style writes, every frame. */
export function useGfxPortStore(session: string): PortStore | null {
  return useContext(GfxContext)?.get(session).store ?? null;
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

/** One scene's render surface. It owns its host <div> and a <canvas> it creates itself on every mount: a GL context that was
 * released (background session, a lost context) can never be revived on the same element, so no canvas is ever reused. The
 * pane keys this component by session AND scene, so two sessions never share an instance (and with it, styles, canvas, GL). */
function SceneCanvas({ rt, id, store, session }: { rt: GfxRuntime; id: string; store: PortStore; session: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  const [gen, setGen] = useState(0); // bumped when the GL context is lost: the effect runs again with a fresh canvas
  const slot = rt.slot(id);
  const cfg = slot.scene.cfg;
  const kind = cfg.dock === 'full' && (portNodeOf(cfg) || Array.isArray(cfg.port)) ? 'frame' : 'strip';
  const stripPlan = planScene(cfg, { w: 1, h: 1 });
  useEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const canvas = document.createElement('canvas');
    box.insertBefore(canvas, box.firstChild);
    let alive = true;
    const onLost = (ev: Event): void => { ev.preventDefault(); if (alive) setGen((n) => n + 1); };
    canvas.addEventListener('webglcontextlost', onLost);
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
      alive = false;
      canvas.removeEventListener('webglcontextlost', onLost);
      cancelAnimationFrame(raf);
      for (const [n, f] of handlers) window.removeEventListener(n, f as EventListener, true);
      document.documentElement.style.cursor = '';
      ro.disconnect();
      store.set(null);
      rt.unmount(id); // releases the GL context
      canvas.remove();
      box.style.clipPath = ''; // nothing of this surface's styling outlives it
      box.style.visibility = '';
    };
  }, [rt, id, slot, store, cfg, gen]);
  if (err) {
    return <div className="gfx-msg" role="alert">Graphics need WebGL2, which this window does not provide ({err}).</div>;
  }
  return (
    <div ref={wrap} className="gfx-scene" style={placement(kind === 'frame' ? { mode: 'frame', out: { x: 0, y: 0, w: 0, h: 0 }, input: null } : stripPlan)} data-scene={id}>
      {id === 'cmcp' && <CmcpOverlays session={session} fit={cfg.fit} />}
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

/** Owns one graphics runtime per session: scenes belong to the session that opened them and are drawn only while that
 * session is in the foreground. Feeds each runtime the engine's "gfx", "gmcp" and "msdp" events for its session. */
export function GfxProvider({ engine, children }: { engine: EngineAPI; children: ReactNode }) {
  const [all] = useState(() => new Map<string, SessionGfx>());
  const [ver, force] = useState(0); // scenes opened/closed/moved: consumers of the context must redraw
  const cmcp = useRef<CmcpController | null>(null);
  const mk = useCallback((session: string): SessionGfx => {
    const rt = new GfxRuntime();
    rt.paused = true; // until its pane is on screen
    rt.onLayout = () => force((n) => n + 1);
    rt.onEvent = (e) => {
      if (cmcp.current?.handleGfxEvent(session, e)) return; // the CMCP console is drawn by the front end; its events go to cmcp*
      void engine.gfxEvent(`${session}/${e.scene}`, e.id, e.event, e.x, e.y).catch(() => undefined);
    };
    rt.onMessage = (lvl, text) => {
      (lvl === 'error' ? console.error : console.warn)(text);
      useUi.getState().toast(lvl === 'error' ? 'error' : 'warn', text);
    };
    const g = { rt, store: new PortStore() };
    all.set(session, g);
    return g;
  }, [engine, all]);
  const get = useCallback((session: string): SessionGfx => all.get(session) ?? mk(session), [mk, all]);
  useEffect(() => {
    const c = new CmcpController(engine, (id) => get(id).rt);
    c.onError = (text) => useUi.getState().toast('warn', text);
    c.onNotes = collectPrompts;
    c.startCollapsed = () => useSettings.getState().settings.cmcpStartCollapsed;
    cmcp.current = c;
    const off = c.attach();
    // sound: the Go side resolved what to play; this plays it, for the session in front only
    const audio = new CmcpAudio(new WebAudioBackend());
    const applySettings = (): void => {
      const st = useSettings.getState().settings;
      audio.setSettings({ volume: st.soundVolume, muted: st.soundMuted, categories: st.soundCategoryVolumes ?? {} });
    };
    applySettings();
    audio.setForeground(useSessions.getState().fg ?? '');
    const offAudio = engine.on('cmcp-audio', (m) => audio.handle(m));
    const offSet = useSettings.subscribe(applySettings);
    const offFg = useSessions.subscribe((st, prev) => { if (st.fg !== prev.fg) audio.setForeground(st.fg ?? ''); });
    void engine.listSessions().then((ss) => ss.forEach((x) => void c.sync(x.id))).catch(() => undefined);
    return () => { off(); offAudio(); offSet(); offFg(); audio.stopAll(50); cmcp.current = null; };
  }, [engine, get]);
  const peek = useCallback((session: string) => all.get(session), [all]);
  const drop = useCallback((session: string): void => {
    const g = all.get(session);
    if (!g) return;
    g.rt.stop();
    g.store.set(null);
    all.delete(session);
    force((n) => n + 1);
  }, [all]);
  useEffect(() => {
    const offs = [
      engine.on('gfx', (ops) => {
        const by = new Map<string, typeof ops>();
        for (const o of ops) {
          const id = String(o.session ?? '');
          if (!id) continue;
          if (!by.has(id)) by.set(id, []);
          by.get(id)!.push(o);
        }
        for (const [id, list] of by) get(id).rt.apply(list);
      }),
      engine.on('gmcp', (p) => get(p.session).rt.setGmcp(p.package, p.data)),
      engine.on('msdp', (p) => get(p.session).rt.setMsdp(p.vars)),
      engine.on('session-removed', (p) => drop(p.id)),
    ];
    void engine.gfxSnapshot().then((ops) => {
      const by = new Map<string, typeof ops>();
      for (const o of ops) {
        const id = String(o.session ?? '');
        if (!id) continue;
        if (!by.has(id)) by.set(id, []);
        by.get(id)!.push(o);
      }
      for (const [id, list] of by) get(id).rt.apply(list);
    }).catch(() => undefined);
    return () => { offs.forEach((o) => o()); all.forEach((g) => g.rt.stop()); all.clear(); };
  }, [engine, get, drop, all]);
  // Escape hides the foreground session's graphics when nothing else wants it; Alt+key shortcuts of its objects click them
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const fg = useSessions.getState().fg;
      const g = fg ? peek(fg) : undefined;
      if (!g) return;
      const rt = g.rt;
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
      if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 's' && fg && usePane.getState().by[fg]?.has) { // screen off / on: the text gets the area
        getActiveCmcp()?.toggleOff(fg);
        e.preventDefault();
        return;
      }
      if (e.altKey && !e.ctrlKey && (e.key === ']' || e.key === '[') && fg && usePane.getState().by[fg]?.has) {
        getActiveCmcp()?.cycleScreen(fg, e.key === ']' ? 1 : -1);
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
  }, [peek]);
  const value = useMemo(() => ({ get, peek, ver }), [get, peek, ver]);
  return <GfxContext.Provider value={value}>{children}</GfxContext.Provider>;
}

/** The graphics of one session's open scenes, inside its output area: strips share it with the text output, a frame
 * surrounds it. Only the foreground session has a pane, so only its scenes are drawn and animated. */
export function GfxPane({ sessionId }: { sessionId: string }) {
  const ctx = useContext(GfxContext);
  const g = ctx?.get(sessionId);
  const rt = g?.rt;
  useEffect(() => {
    if (!rt) return;
    rt.paused = false;
    rt.wake();
    return () => { rt.paused = true; };
  }, [rt]);
  const pane = usePane((st) => st.by[sessionId]);
  if (!g) return null;
  const { store } = g;
  const open = [...g.rt.slots.values()].filter((s) => s.scene.cfg.open);
  if (open.length === 0) {
    return pane?.has && pane.off ? (
      <button type="button" className="cmcp-reopen" aria-label="Show the console screen" title="Show the console screen (Alt+S)" onClick={() => getActiveCmcp()?.setOff(sessionId, false)}>
        Console
      </button>
    ) : null;
  }
  if (!GfxRenderer.supported()) {
    return <div className="gfx-msg" role="alert">Graphics need WebGL2, which this window does not provide.</div>;
  }
  return <>{open.map((s) => <SceneCanvas key={`${sessionId}/${s.scene.id}`} rt={g.rt} id={s.scene.id} store={store} session={sessionId} />)}</>;
}
