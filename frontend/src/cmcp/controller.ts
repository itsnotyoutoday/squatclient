import type { EngineAPI, GfxOp } from '../api/types';
import type { GfxEventOut } from '../gfx/types';
import type { GfxRuntime } from '../gfx/runtime';
import { findTextport, place, type Placed } from './layout';
import { skinFor } from './skins';
import { layoutSkinned } from './skinlayout';
import type { Pal, Skin } from './skins/types';
import { col, frameShapes, navShapes, templateVars } from './skinframe';
export type AlertRecolour = 'full' | 'edge' | 'off';
import { skinFromTheme } from './skins/pack';
import { setActiveCmcp, usePane, useScreenHelp, useThemeInUse } from './pane';
import { useSettings } from '../state/stores';
import { diffOps, PORT_ID, SCENE, sceneOp, type Ease } from './ops';
import { drawSprite, type SpriteView } from './sprite';
import type { CmcpNode, CmcpNote, CmcpPulse, CmcpTree, CmcpUI } from './types';
import { useOverlays } from './overlays';
import { amountKey, contextStrip, draw, readonlyBadge, recordHistory, viewNeeds, type Ctx, type Prim, type Target } from './widgets';

const BASE_W = 1200;

/** The fonts the themes use (public/fonts), loaded on demand. */
const FONT_FILES: Record<string, { file: string; weight?: string }[]> = {
  Antonio: [{ file: 'Antonio-VF.ttf' }], Cinzel: [{ file: 'Cinzel-VF.ttf' }], Orbitron: [{ file: 'Orbitron-VF.ttf' }], Teko: [{ file: 'Teko-VF.ttf' }],
  Rajdhani: [{ file: 'Rajdhani-Medium.ttf', weight: '500' }, { file: 'Rajdhani-Bold.ttf', weight: '700' }],
};

interface SessionState {
  id: string;
  ui: CmcpUI | null;
  tree: CmcpTree | null;
  prev: Map<string, Prim>;
  targets: Map<string, Target>;
  local: Map<string, unknown>;
  history: Map<string, number[]>;
  images: Ctx['images'];
  spriteDocs: Map<string, SpriteView & { default_view?: string; views?: Record<string, SpriteView> }>;
  spriteWanted: Set<string>;
  spriteDrawn: Map<string, string>;
  spriteN: number;
  viewImages: Map<string, { name: string; w: number; h: number }>;
  viewDocs: Map<string, { views: Record<string, SpriteView> }>;
  viewWanted: Set<string>;
  fxN: number;
  vsRect: { x: number; y: number; w: number; h: number } | null;
  vsItems: Record<string, { x: number; y: number }>;
  aspect: number;
  open: boolean;
  dismissed: string;
  key: string;
  fonts: Set<string>;
  lastRev: number;
  /** LOG expanded: remembered per session and across consoles */
  log: boolean;
  /** the player switched the screen off (data keeps streaming) */
  off: boolean;
  offSeen: boolean;
  lastPal: string;
  layoutMode: string;
  /** effect objects alive (removed after their duration; cleared on reset) */
  fx: Set<string>;
  /** the keyboard-focused screen menu: open + highlighted row (an index into the console's screen menu) */
  menu: { open: boolean; idx: number };
  lastW?: number;
  skinned: boolean;
  noticeId?: string;
  pulse?: CmcpPulse;
  viewState: 'compact' | 'balanced' | 'large' | 'expanded' | 'off' | 'default';
}

/** Draws the Go engine's bound CMCP screen trees into each session's graphics runtime and sends widget events back.
 * It evaluates nothing: bindings, fallbacks, enabled flags and actions all come from the shared core through the engine. */
export class CmcpController {
  private sess = new Map<string, SessionState>();
  reduceMotion = false;
  onNotes?: (session: string, notes: CmcpNote[]) => void;
  onError?: (text: string) => void;

  constructor(private engine: EngineAPI, private rtFor: (session: string) => GfxRuntime) {
    if (typeof matchMedia !== 'undefined') this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  attach(): () => void {
    setActiveCmcp(this);
    void this.engine.cmcpReducedMotion(this.reduceMotion).catch(() => undefined);
    const offs = [
      this.engine.on('cmcp', (ui) => this.onUi(ui)),
      this.engine.on('cmcp-pulse', (p) => { const s = this.sess.get(p.session); if (s) { s.pulse = p; if (s.tree && s.open) this.render(s); } }),
      this.engine.on('cmcp-notes', (p) => { this.onNotes?.(p.session, p.notes); this.noteErrors(p.notes); this.effects(p.session, p.notes); }),
      this.engine.on('session-removed', (p) => this.sess.delete(p.id)),
    ];
    return () => { offs.forEach((o) => o()); setActiveCmcp(null); };
  }

  /** The text view's state comes from the shared core through the engine (LOG and screen-off are its state machine); these ask it to toggle. */
  private viewEvent(session: string, ev: 'log_toggle' | 'screen_toggle'): void {
    const s = this.sess.get(session);
    if (!s) return;
    void this.engine.cmcpViewEvent(session, ev).then((st) => {
      s.viewState = st as SessionState['viewState']; // do not wait for the next model event
      this.applyView(s);
    }).catch((e: unknown) => this.onError?.(String(e)));
  }
  toggleOff(session: string): void { this.viewEvent(session, 'screen_toggle'); }
  /** brings the screen back when it is off (the pane's Console button) */
  setOff(session: string, off: boolean): void { const s = this.sess.get(session); if (s && (s.viewState === 'off') !== off) this.viewEvent(session, 'screen_toggle'); }
  /** LOG: the text grows to about 80% of the height and the other panels fold into a summary strip, and back (animated). */
  toggleLog(session: string): void { this.viewEvent(session, 'log_toggle'); }
  /** Alt+] / Alt+[ : the next or previous screen of the console */
  cycleScreen(session: string, dir: number): void { void this.engine.cmcpCycleScreen(session, dir).catch((err: unknown) => this.onError?.(String(err).replace(/^Error: /, ''))); }
  /** The menu: only the screens this console can show, then a "more..." entry that opens the list of every screen (never a non-screen entry). */
  private menuList(s: SessionState): { id: string; title: string; available: boolean; active: boolean; hintCmd?: string; reason?: string }[] {
    const own = (s.ui?.screens ?? []).filter((o) => o.available && o.state !== 'locked');
    return [...own, { id: '#more', title: 'More screens...', available: true, active: false }];
  }
  /** every screen with the console that provides it (the popover behind "more...") */
  allScreens(s: SessionState): { id: string; title: string; available: boolean; console: string }[] {
    return (s.ui?.screens ?? []).map((o) => ({ id: o.id, title: o.title || o.id, available: o.available, console: o.available ? 'this console' : (o.hint ?? '').replace(/^man\s+/, '').replace(/\s+to use$/, '') || (o.hintCmd ?? '').replace(/^man\s+/, '') || (o.reason ?? '') }));
  }

  /** Called with a short message the first time the menu opens (once per install). */
  onHint?: (text: string) => void;
  /** the player's alert_recolour setting (theme | full | edge | off) */
  alertRecolour: () => AlertRecolour | 'theme' = () => 'theme';

  menuOpen(session: string): boolean { return this.sess.get(session)?.menu.open ?? false; }

  /** Alt+M: moves keyboard focus into the screen menu (and back out if it is already there). The caller blurs/restores the input. */
  toggleMenu(session: string): boolean {
    const s = this.sess.get(session);
    if (!s?.tree || !s.skinned) return false;
    s.menu.open = !s.menu.open;
    if (s.menu.open) {
      const i = this.menuList(s).findIndex((o) => o.active);
      s.menu.idx = Math.max(0, i);
      try {
        if (!localStorage.getItem('cmcp-menu-hint')) { localStorage.setItem('cmcp-menu-hint', '1'); this.onHint?.('Screen menu: Up/Down to choose, Enter to open, Esc to leave. Alt+M opens it again; Alt+1..5 and Alt+[ / Alt+] switch directly.'); }
      } catch { /* no storage: no hint memory */ }
    }
    this.render(s);
    return s.menu.open;
  }

  /** A key while the menu has focus. Returns true when handled (the caller stops the event). */
  menuKey(session: string, key: string): boolean {
    const s = this.sess.get(session);
    if (!s?.menu.open) return false;
    const menu = this.menuList(s);
    const n = Math.max(1, menu.length);
    if (key === 'ArrowDown') s.menu.idx = (s.menu.idx + 1) % n;
    else if (key === 'ArrowUp') s.menu.idx = (s.menu.idx + n - 1) % n;
    else if (key === 'Home') s.menu.idx = 0;
    else if (key === 'End') s.menu.idx = n - 1;
    else if (key === 'Escape') s.menu.open = false;
    else if (key === 'Enter') {
      const o = menu[s.menu.idx];
      if (o?.id === '#more') { s.menu.open = false; useScreenHelp.getState().show(this.allScreens(s)); }
      else if (o) { s.menu.open = false; void this.engine.cmcpShowScreen(session, o.id).catch((e: unknown) => this.onError?.(String(e).replace(/^Error: /, ''))); }
    } else return false;
    this.render(s);
    return true;
  }

  /** green -> yellow -> red -> green through the verb alert.set; a console that may not set it gets the hint instead */
  cycleAlert(session: string): void {
    const s = this.sess.get(session);
    if (!s?.ui) return;
    const spec = s.ui.catalogue?.['alert.set'];
    if (!(s.ui.commands ?? []).includes('alert.set') || s.ui.readonly) {
      const mans = (spec?.consoles ?? []).filter((c) => !c.includes(':')).slice(0, 3).join(' or ');
      this.onError?.(s.ui.readonly ? 'The alert cannot be changed while the screen is read-only.' : `Not available from this console${mans ? `: man ${mans}` : ''}.`);
      return;
    }
    const cur = String(((s.ui.status ?? s.ui.docs?.['Space.Ship.Status'] ?? {}) as Record<string, unknown>).alert ?? s.ui.alert ?? 'green');
    const next = cur === 'green' ? 'yellow' : cur === 'yellow' ? 'red' : 'green';
    void this.engine.cmcpCommand(session, 'alert.set', { level: next }).catch((e: unknown) => this.onError?.(String(e).replace(/^Error: /, '')));
  }
  logState(session: string): boolean { return this.sess.get(session)?.viewState === 'expanded'; }

  private applyView(s: SessionState): void {
    s.log = s.viewState === 'expanded';
    const off = s.viewState === 'off';
    usePane.getState().set(s.id, !!s.tree, off);
    if (off) this.close(s, true);
    else if (s.tree) { if (s.off) { s.key = ''; s.dismissed = ''; } s.off = false; this.render(s); }
    s.off = off;
  }

  /** For a window that mounts late: fetch the model of a session once. */
  async sync(session: string): Promise<void> {
    const ui = await this.engine.cmcpState(session).catch(() => null);
    if (ui) this.onUi(ui);
  }

  state(session: string): SessionState {
    let s = this.sess.get(session);
    if (!s) {
      s = { id: session, ui: null, tree: null, prev: new Map(), targets: new Map(), local: new Map(), history: new Map(), images: new Map(), spriteDocs: new Map(), spriteWanted: new Set(), spriteDrawn: new Map(), spriteN: 0, viewImages: new Map(), viewDocs: new Map(), viewWanted: new Set(), fxN: 0, vsRect: null, vsItems: {}, aspect: 9 / 16, open: false, dismissed: '', key: '', fonts: new Set(), lastRev: -1, log: false, off: false, offSeen: false, lastPal: '', layoutMode: 'stack', fx: new Set(), menu: { open: false, idx: 0 }, skinned: false, viewState: 'default' };
      this.sess.set(session, s);
      const rt = this.rtFor(session);
      const prev = rt.onResize;
      rt.onResize = (id, w, h) => {
        prev?.(id, w, h);
        if (id !== SCENE || w <= 0 || h <= 0) return;
        const a = h / w;
        if (Math.abs(a - s!.aspect) > 0.01 || Math.abs(w - (s!.lastW ?? 0)) > 24) { s!.aspect = a; s!.lastW = w; this.render(s!); }
      };
    }
    return s;
  }

  /** the setting 'start collapsed' (set by the provider from the settings store) */
  startCollapsed: () => boolean = () => false;

  private noteErrors(notes: CmcpNote[]): void {
    for (const n of notes) {
      if (n.kind === 'reply' && n.reply && !n.reply.ok) this.onError?.(`${n.reply.cmd}: ${n.reply.hint || n.reply.err || 'failed'}`);
      if (n.kind === 'timeout' && n.reply) this.onError?.(`${n.reply.cmd}: the game did not answer`);
    }
  }

  onUi(ui: CmcpUI): void {
    const s = this.state(ui.session);
    if (ui.rev === s.lastRev && s.tree && ui.tree && JSON.stringify(ui.tree.ui) === JSON.stringify(s.tree.ui) && ui.tree.packKey === s.tree.packKey && ui.tree.screen === s.tree.screen) {
      // the model did not change; the tree might have (data) so fall through
    }
    s.lastRev = ui.rev;
    s.ui = ui;
    const t = ui.tree;
    if (!t) { this.close(s); s.tree = null; usePane.getState().set(s.id, false, s.off); return; }
    s.viewState = t.view?.state ?? 'default';
    s.log = s.viewState === 'expanded';
    usePane.getState().set(s.id, true, s.viewState === 'off');
    if (s.viewState === 'off') { s.tree = t; s.off = true; this.close(s, true); return; }
    s.off = false;
    const key = `${t.screen}|${t.packKey}|${t.generation}`;
    if (key !== s.key) { // another screen, pack, theme or ship: start from a clean scene
      this.reset(s);
      s.key = key;
      s.local.clear();
      s.history.clear();
      s.dismissed = s.dismissed === key ? s.dismissed : '';
    }
    s.tree = t;
    recordHistory(t.root, s.history);
    this.fonts(s, t);
    this.sprites(s, t);
    this.viewArt(s, t);
    this.render(s);
  }

  private fonts(s: SessionState, t: CmcpTree): void {
    const rt = this.rtFor(s.id);
    for (const k of ['font.body', 'font.title']) {
      const name = String(t.tokens[k] ?? '');
      if (!name || s.fonts.has(name) || !FONT_FILES[name]) continue;
      s.fonts.add(name);
      for (const f of FONT_FILES[name]) rt.apply([{ op: 'font', name, src: `/fonts/${f.file}`, weight: f.weight }]);
    }
  }

  private walkNodes(n: CmcpNode, f: (n: CmcpNode) => void): void { f(n); for (const c of n.children ?? []) this.walkNodes(c, f); }

  /** Pictures of sprites: fetch the resolved sprite once per pack and theme, redraw when the engine's tint amounts change. */
  private sprites(s: SessionState, t: CmcpTree): void {
    this.walkNodes(t.root, (n) => {
      const sid = typeof n.props.sprite === 'string' ? n.props.sprite : '';
      const key = typeof n.props.sprite_key === 'string' ? n.props.sprite_key : '';
      if (n.widget !== 'schematic' || !sid || !key) return;
      const dk = `${key}|${t.theme}`;
      const doc = s.spriteDocs.get(dk);
      if (!doc) {
        if (s.spriteWanted.has(dk)) return;
        s.spriteWanted.add(dk);
        void this.engine.cmcpSprite(s.id, sid).then((txt) => {
          const d = JSON.parse(txt) as { default_view?: string; views: Record<string, SpriteView> };
          s.spriteDocs.set(dk, d as never);
          this.sprites(s, t);
          this.render(s);
        }).catch((e: unknown) => this.onError?.(`sprite ${sid}: ${String(e)}`));
        return;
      }
      const am = JSON.stringify(n.props.sprite_amounts ?? {});
      if (s.spriteDrawn.get(key) === am + dk) return;
      s.spriteDrawn.set(key, am + dk);
      const views = (doc as unknown as { views: Record<string, SpriteView>; default_view?: string }).views;
      const v = views[(doc as { default_view?: string }).default_view ?? ''] ?? Object.values(views)[0];
      if (!v) return;
      const amounts = (n.props.sprite_amounts ?? {}) as { zones?: Record<string, number>; glows?: Record<string, number> };
      const d = drawSprite(v, 720, amounts);
      if (!d) return;
      const name = `cmcp:${key}:${++s.spriteN}`;
      s.images.set(key, { name, w: d.w, h: d.h, zones: d.zones });
      this.rtFor(s.id).apply([{ op: 'image', name, src: d.canvas.toDataURL('image/png') }]);
      this.render(s);
    });
  }

  /** Pictures for the contacts on the viewscreen: one image per (art, view, tint amounts), drawn from the sprite the engine resolved. */
  private viewArt(s: SessionState, t: CmcpTree): void {
    for (const nd of viewNeeds(t.root)) {
      const dk = `${t.packKey}|${nd.art}`;
      const doc = s.viewDocs.get(dk);
      if (!doc) {
        if (s.viewWanted.has(dk)) continue;
        s.viewWanted.add(dk);
        void this.engine.cmcpSprite(s.id, nd.art).then((txt) => {
          s.viewDocs.set(dk, JSON.parse(txt) as { views: Record<string, SpriteView> });
          this.viewArt(s, t);
          this.render(s);
        }).catch(() => undefined);
        continue;
      }
      const key = `${nd.art}|${nd.view}|${amountKey(nd.amounts)}`;
      if (s.viewImages.has(key) || s.viewImages.size > 96) continue;
      const v = doc.views[nd.view];
      if (!v) continue;
      const d = drawSprite(v, 200, nd.amounts);
      if (!d) continue;
      const name = `cmcp:v:${++s.spriteN}`;
      s.viewImages.set(key, { name, w: d.w, h: d.h });
      this.rtFor(s.id).apply([{ op: 'image', name, src: d.canvas.toDataURL('image/png') }]);
    }
  }

  private reset(s: SessionState): void {
    s.fx.clear();
    if (s.open) this.rtFor(s.id).apply([{ op: 'clear', scene: SCENE }]);
    s.prev = new Map();
    s.targets = new Map();
  }

  private close(s: SessionState, keepKey = false): void {
    useOverlays.getState().clear(s.id);
    if (!s.open) return;
    this.rtFor(s.id).apply([{ op: 'clear', scene: SCENE }, { op: 'scene', scene: SCENE, open: false }]);
    s.open = false;
    s.prev = new Map();
    s.targets = new Map();
    if (!keepKey) s.key = '';
  }

  /** downloaded theme packs turned into skins, by `id@version` (undefined = the pack could not be turned into a skin: the built-in one is used) */
  private packSkins = new Map<string, Skin | undefined>();
  private packAsked = new Set<string>();
  /** what the last loaded packs could not express (the Settings dialog can show it) */
  packNotes: Record<string, string[]> = {};

  /** The skin of the tree's theme: a downloaded pack (loaded through the engine, once) drives rendering; the built-in table is the fallback
   * until it arrives and whenever there is no usable pack. */
  private skinOf(s: SessionState, t: CmcpTree): Skin | undefined {
    const builtin = skinFor(t.theme);
    if (t.themeSource !== 'pack') return builtin;
    const key = `${s.id}|${t.theme}@${t.themeVersion ?? ''}`;
    if (this.packSkins.has(key)) return this.packSkins.get(key) ?? builtin;
    if (!this.packAsked.has(key)) {
      this.packAsked.add(key);
      void this.engine.cmcpThemeDoc(s.id, t.theme).then((doc) => {
        const r = skinFromTheme(doc, builtin);
        this.packSkins.set(key, r.skin);
        this.packNotes[t.theme] = r.notes;
        this.render(s);
      }).catch(() => { this.packSkins.set(key, undefined); });
    }
    return builtin;
  }

  /** Builds the primitives for the current tree and applies the difference. */
  render(s: SessionState): void {
    const t = s.tree;
    if (!t || s.dismissed === s.key || s.off) return;
    useThemeInUse.getState().set(t.theme, t.themeSource ?? '', t.themeVersion ?? '');
    const skin = this.skinOf(s, t);
    if (skin) { this.renderSkinned(s, t, skin); return; }
    const W = BASE_W, H = Math.round(BASE_W * s.aspect);
    const stack = s.ui?.stack ?? [];
    const strip = stack.length > 1 ? 26 : 0; // the context strip: only when more than one context is held
    const root = place(t.root, { x: 0, y: strip, w: W, h: H - strip });
    const tp = findTextport(root);
    if (!tp) return; // a screen without a text port is invalid (spec 6.2); never draw it
    const ctx: Ctx = { tree: t, local: s.local, history: s.history, images: s.images, readonly: s.ui?.readonly ?? false, reduceMotion: this.reduceMotion, overlays: [], viewImages: s.viewImages };
    const prims: Prim[] = draw(root, ctx);
    this.noteViewscreen(s, root);
    useOverlays.getState().set(s.id, W, H, ctx.overlays ?? []);
    if (strip) prims.push(...contextStrip(stack, W, ctx));
    if (ctx.readonly) prims.push(...readonlyBadge(s.ui?.ai ?? false, s.ui?.console?.manned_by, W, ctx));
    // the port node: the rectangle where the real text shows (never drawn over)
    prims.unshift({ id: PORT_ID, type: 'rect', props: { x: tp.rect.x, y: tp.rect.y, w: tp.rect.w, h: tp.rect.h, fill: '#00000000' } });
    s.skinned = false;
    if (s.vsRect) prims.push({ id: 'fxclip', type: 'group', props: { x: 0, y: 0, clip: [s.vsRect.x, s.vsRect.y, s.vsRect.w, s.vsRect.h], z: 9000 } });
    const { ops, map } = diffOps(s.prev, prims);
    const rt = this.rtFor(s.id);
    const bg = typeof t.tokens['color.bg'] === 'string' ? (t.tokens['color.bg'] as string) : '#000000';
    const head: GfxOp[] = [sceneOp(W, H, bg, 0.25)];
    if (!s.open) head.push({ op: 'on', scene: SCENE, id: '#scene', events: ['close'] });
    s.open = true;
    s.prev = map;
    s.targets = new Map(prims.filter((p) => p.target).map((p) => [p.id, p.target!]));
    rt.apply([...head, ...ops]);
  }

  private noteViewscreen(s: SessionState, root: Placed): void {
    s.vsRect = null; s.vsItems = {};
    const find = (p: Placed): Placed | null => { if (p.node.widget === 'viewscreen') return p; for (const k of p.children) { const f = find(k); if (f) return f; } return null; };
    const vs = find(root);
    if (!vs) return;
    s.vsRect = vs.rect;
    for (const it of (vs.node.props.items as { cid?: string; x?: number; y?: number }[] | undefined) ?? []) if (it.cid !== undefined) s.vsItems[String(it.cid)] = { x: vs.rect.x + (it.x ?? 0.5) * vs.rect.w, y: vs.rect.y + (it.y ?? 0.5) * vs.rect.h };
  }

  /** Effects the renderer owns (beam, torpedo, explosion, shield_flash, flash) for Cobra.Event, chosen by the pack's scene (spec 7.8). Skipped under reduced motion. */
  effects(session: string, notes: CmcpNote[]): void {
    const s = this.sess.get(session);
    if (!s || !s.tree || !s.vsRect || this.reduceMotion || !s.open) return;
    const find = (n: CmcpNode): CmcpNode | null => { if (n.widget === 'viewscreen') return n; for (const k of n.children ?? []) { const f = find(k); if (f) return f; } return null; };
    const vsn = find(s.tree.root);
    const table = (vsn?.props.effects ?? {}) as Record<string, { effect: string; color?: string; duration_ms?: number; width?: number; size?: number }>;
    const tok = (c: string | undefined, d: string): string => { const v = c?.startsWith('@') ? s.tree!.tokens[c.slice(1)] : c; return typeof v === 'string' ? v : d; };
    for (const n of notes) {
      if (n.kind !== 'event' || !n.event) continue;
      const d = n.event.data ?? {};
      const key = n.event.type === 'fire' ? `fire.${String(d.kind ?? '')}` : n.event.type === 'hit' ? (d.shield ? 'hit.shield' : 'hit') : n.event.type;
      const spec = table[key];
      if (!spec) continue;
      const R = s.vsRect;
      if (s.fx.size >= 12) continue; // a burst of events must not pile up objects
      const dur = Math.min(10, (spec.duration_ms ?? 500) / 1000);
      const id = `fx${++s.fxN}`;
      const parent = 'fxclip'; // every effect lives in a group clipped to the viewscreen: never over the nav, the port or the controls
      const to = s.vsItems[String(d.to ?? d.cid ?? '')] ?? { x: R.x + R.w / 2, y: R.y + R.h / 2 };
      const col = tok(spec.color, '#ffffff');
      const ops: GfxOp[] = [];
      const maxR = Math.max(4, R.h * 0.12); // an explosion never exceeds this radius
      const add = (oid: string, type: string, props: Record<string, unknown>, tracks: Record<string, { from?: number; to: number }>): void => {
        ops.push({ op: 'create', scene: SCENE, id: oid, type, parent, props: { z: 9000, ...props } });
        ops.push({ op: 'tween', scene: SCENE, target: oid, tracks, dur, ease: 'outQuad' });
      };
      /** a shape that moves or grows about its own centre: a group at the position holds it at (0,0) */
      const grouped = (type: string, props: Record<string, unknown>, at: { x: number; y: number }, tracks: Record<string, { from?: number; to: number }>): void => {
        ops.push({ op: 'create', scene: SCENE, id, type: 'group', parent, props: { x: at.x, y: at.y, z: 9000 } });
        ops.push({ op: 'create', scene: SCENE, id: `${id}.s`, type, parent: id, props: { x: 0, y: 0, ...props } });
        ops.push({ op: 'tween', scene: SCENE, target: id, tracks, dur, ease: 'outQuad' });
      };
      const from = { x: R.x + R.w / 2, y: R.y + R.h };
      switch (spec.effect) {
        case 'beam': add(id, 'line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke: col, strokeWidth: (spec.width ?? 2) * 2, glow: 0.8, opacity: 1 }, { opacity: { from: 1, to: 0 } }); break;
        case 'torpedo': grouped('circle', { r: 6, fill: col, glow: 0.9 }, from, { x: { from: from.x, to: to.x }, y: { from: from.y, to: to.y } }); break;
        case 'explosion': grouped('circle', { r: Math.min(maxR / 3, 8 * (spec.size ?? 1)), fill: col, glow: 1 }, to, { scaleX: { from: 0.4, to: 3 }, scaleY: { from: 0.4, to: 3 }, opacity: { from: 1, to: 0 } }); break;
        case 'shield_flash': add(id, 'rect', { x: R.x, y: R.y, w: R.w, h: R.h, fill: '#00000000', stroke: col, strokeWidth: 10, opacity: 0.9 }, { opacity: { from: 0.9, to: 0 } }); break;
        case 'flash': add(id, 'rect', { x: R.x, y: R.y, w: R.w, h: R.h, fill: col, opacity: 0.35 }, { opacity: { from: 0.35, to: 0 } }); break;
        default: continue;
      }
      s.fx.add(id);
      this.rtFor(session).apply(ops);
      setTimeout(() => { s.fx.delete(id); if (s.open) this.rtFor(session).apply([{ op: 'delete', scene: SCENE, id }]); }, dur * 1000 + 150);
    }
  }

  /** Draws a screen in a theme's skin: the theme's frame, nav column and status strip, the game text in its own big framed port (LOG
   * toggles it), the screen's widgets laid out in the band around the port. All geometry is the skin's (1600 x 900 scene units);
   * the widgets are laid out in the 1200-unit base and drawn inside a group scaled by 4/3. */
  private renderSkinned(s: SessionState, t: CmcpTree, skin: Skin): void {
    const W = 1600, H = 900, K = 0.75;
    const alert = (s.ui?.alert ?? String(((s.ui?.status ?? s.ui?.docs?.['Space.Ship.Status'] ?? {}) as Record<string, unknown>).alert ?? '')) === 'red';
    // alert_recolour: full = every role swaps to the red set; edge = only the edge roles (port frame, alert pill, screen edge) do; off = nothing
    // recolours (the pill and the strip still say ALERT RED). The theme default: green-identity themes (romulan, ferengi) use edge.
    const want = this.alertRecolour();
    const mode: AlertRecolour = t.alertMode ?? (want === 'theme' ? (skin.alertRecolour ?? (skin.name === 'romulan' || skin.name === 'ferengi' ? 'edge' : 'full')) : want);
    // the engine (the core) says what pulses: while a red alert pulses its samples re-colour the roles r and x, the alert pill and the edge
    const pu = s.pulse?.active && alert ? s.pulse : undefined;
    const withPulse = (p: Pal): Pal => (pu?.roles ? ({ ...p, ...(pu.roles.r ? { r: pu.roles.r } : {}), ...(pu.roles.x ? { x: pu.roles.x } : {}) } as Pal) : p);
    const red = withPulse(skin.pal.red);
    const pal = withPulse(alert && mode === 'full' ? skin.pal.red : alert && mode === 'edge' ? ({ ...skin.pal.normal, r: skin.pal.red.r, x: skin.pal.red.x } as Pal) : skin.pal.normal);
    const edgePal = alert && mode !== 'off' ? red : pal;
    const screenName = t.screen.split(/[./]/).pop() ?? '';
    const cur = skin.nav.items.findIndex((i) => i.screens.includes(screenName));
    const label = cur >= 0 ? skin.nav.items[cur].label : (t.title || screenName);
    const vars: Record<string, string> = { ...templateVars(s.ui!, label), screen: screenName };
    // port.max_cols (default 80): the side layout's text is at most 80 monospace columns wide; the box size and font give the scene units
    const lg = this.rtFor(s.id).slot(SCENE).logical;
    const k = lg && lg.w > 0 ? Math.min(lg.w / 1600, lg.h / 900) : 0;
    const fontPx = useSettings.getState().settings.fontSize || 14;
    const maxPortW = k > 0 ? ((skin.maxCols ?? 80) * 0.6 * fontPx + 28) / k : Infinity;
    const L = layoutSkinned(t.root, skin, screenName, s.log, t.view?.portDefault ?? 'balanced', maxPortW);
    if (!L) return;
    const { root, port } = L;
    s.layoutMode = L.mode;
    const tokens: Record<string, string | number> = { ...t.tokens, 'color.bg': pal.bg, 'color.panel': skin.widgets.bar.track, 'color.text': pal[skin.widgets.text], 'color.dim': pal.t, 'color.accent': pal.p, 'color.accent2': pal.q, 'color.warn': pal.x, 'color.alert': pal.r, 'font.body': skin.font.family, 'font.title': skin.font.family, radius: skin.sharp ? 0 : 6 };
    const ctx: Ctx = { tree: { ...t, tokens }, local: s.local, history: s.history, images: s.images, readonly: s.ui?.readonly ?? false, reduceMotion: this.reduceMotion, overlays: [], viewImages: s.viewImages, skin, pal };
    const content = draw(root, ctx);
    this.noteViewscreen(s, root);
    useOverlays.getState().set(s.id, W, H, []); // typed entry overlays follow the 1200-unit layout; not placed in skinned mode yet
    const prims: Prim[] = [];
    prims.push({ id: PORT_ID, type: 'rect', props: { x: port[0], y: port[1], w: port[2], h: port[3], fill: '#00000000' } });
    prims.push(...frameShapes(skin.frame, pal, vars, 'fr.'));
    prims.push({ id: 'cw', type: 'group', props: { x: 0, y: 0, scaleX: L.scale / K, scaleY: L.scale / K, opacity: s.log ? 0 : 1, visible: true } });
    for (const p of content) prims.push({ ...p, parent: p.parent ?? 'cw' });
    if (s.vsRect) prims.push({ id: 'fxclip', type: 'group', parent: 'cw', props: { x: 0, y: 0, clip: [s.vsRect.x, s.vsRect.y, s.vsRect.w, s.vsRect.h], z: 9000 } });
    s.skinned = true;
    prims.push({ id: 'portframe', type: 'rect', props: { x: port[0] - (skin.port.frame.inset ?? 8), y: port[1] - (skin.port.frame.inset ?? 8), w: port[2] + 2 * (skin.port.frame.inset ?? 8), h: port[3] + 2 * (skin.port.frame.inset ?? 8), r: skin.port.frame.r, stroke: col(skin.port.frame.role, edgePal), strokeWidth: skin.port.frame.width, fill: '#00000000', glow: skin.port.frame.glow } });
    if (s.log) prims.push({ id: 'logsum', type: 'text', props: { x: port[0] + 4, y: port[1] - 22, text: `${label}   ${vars.ship}   HULL ${vars.hull}%   CORE ${vars.core}%   ALERT ${vars.alert}`, size: 22, fill: col('x', pal), baseline: 'middle', weight: '700', font: skin.font.family } });
    const menu = s.ui?.screens ?? [];
    prims.push(...navShapes(skin, pal, cur, 'nv.', (id) => { const o = menu.find((x) => x.id === id); return { available: o ? o.available : true, hint: o?.hintCmd }; }));
    const lb = skin.log.button;
    prims.push({ id: 'logbtn', type: 'button', events: ['click'], target: { path: '', event: '', special: 'log' }, props: { x: lb.x, y: lb.y, w: lb.w, h: lb.h, r: lb.r ?? lb.h / 2, fill: col(lb.role, pal), text: s.log ? skin.log.shrink : skin.log.expand, color: col(lb.color, pal), size: lb.size * (skin.font.tscale ?? 1), weight: skin.font.weight, align: lb.align ?? 'center', padX: lb.padX ?? 16, font: skin.font.family, key: 'alt+l', glow: 0.04 } });
    // the alert pill: click cycles green / yellow / red and sends alert.set (the typed form `alert red` is echoed by the engine); dim when this
    // console may not set it or the screen is read-only
    const ab = skin.alert ?? { ...skin.off.button, y: skin.off.button.y + 56, role: 'x' as const };
    const can = (s.ui?.commands ?? []).includes('alert.set') && !(s.ui?.readonly ?? false);
    prims.push({ id: 'alertbtn', type: 'button', events: ['click'], target: { path: '', event: '', special: 'alert' }, props: { x: ab.x, y: ab.y, w: ab.w, h: ab.h, r: ab.r ?? ab.h / 2, fill: col(alert ? 'r' : ab.role, edgePal), text: `ALERT ${vars.alert}`, color: col(ab.color ?? '#000000', pal), size: ab.size * (skin.font.tscale ?? 1), weight: skin.font.weight, align: ab.align ?? 'center', font: skin.font.family, key: 'alt+a', glow: can ? 0.1 : 0, opacity: can ? 1 : 0.5 } });
    if (s.menu.open) { // the focused screen menu over the nav column: every screen, the highlighted one ringed and inverted, locked ones dim
      const items = this.menuList(s);
      const nb = skin.nav.button, rowH = 30, x = nb.x, y = nb.y, w = Math.max(nb.w, 190);
      prims.push({ id: 'menubg', type: 'rect', props: { x: x - 6, y: y - 8, w: w + 12, h: Math.min(items.length, 15) * rowH + 16, fill: col('bg', pal), stroke: col('x', pal), strokeWidth: 2, r: skin.sharp ? 0 : 10, opacity: 0.96 } });
      items.slice(0, 15).forEach((o, i) => {
        const foc = i === s.menu.idx;
        if (foc) prims.push({ id: `menuring${i}`, type: 'rect', props: { x, y: y + i * rowH, w, h: rowH - 2, fill: col('x', pal), stroke: col('s', pal), strokeWidth: 3, r: skin.sharp ? 0 : 8 } });
        prims.push({ id: `menutxt${i}`, type: 'text', props: { x: x + 10, y: y + i * rowH + rowH / 2 - 1, text: `${o.active ? '> ' : ''}${(o.title || o.id).toUpperCase()}`, size: 20, fill: foc ? col('bg', pal) : col(o.id === '#more' ? 'x' : 'k', pal), baseline: 'middle', weight: '700', font: skin.font.family } });
      });
    }
    const ob = skin.off.button;
    prims.push({ id: 'offbtn', type: 'button', events: ['click'], target: { path: '', event: '', special: 'off' }, props: { x: ob.x, y: ob.y, w: ob.w, h: ob.h, r: ob.r ?? ob.h / 2, fill: col(ob.role, pal), text: skin.off.label, color: col(ob.color, pal), size: ob.size * (skin.font.tscale ?? 1), weight: skin.font.weight, align: ob.align ?? 'center', font: skin.font.family, key: 'alt+s', glow: 0.04 } });
    prims.forEach((p, i) => { p.props = { ...p.props, z: i }; });
    // the notice line: one pill at the top edge of the scene, styled by the skin, clear of the text port, the input bar and the nav column
    const nt = s.ui?.notice;
    if (nt && nt.text) {
      const nw = Math.min(900, Math.max(320, nt.text.length * 15 + 48)), nx = 800 - nw / 2, bad = nt.state === 'failed' || nt.kind === 'error' || nt.kind === 'warning';
      prims.push({ id: 'notice.bg', type: 'rect', props: { x: nx, y: 4, w: nw, h: 34, r: skin.sharp ? 0 : 17, fill: col('bg', pal), stroke: col(bad ? 'r' : skin.port.frame.role, edgePal), strokeWidth: 2, glow: 0.1, z: 9400 } });
      prims.push({ id: 'notice.tx', type: 'text', props: { x: 800, y: 21, text: nt.text, size: 22 * (skin.font.tscale ?? 1), fill: col(bad ? 'r' : 'k', edgePal), align: 'center', baseline: 'middle', weight: '700', font: skin.font.family, z: 9401 } });
    }
    const noticeNew = nt?.id !== s.noticeId;
    s.noticeId = nt?.id;
    if (alert && mode !== 'off') prims.push({ id: 'alertedge', type: 'rect', props: { x: 4, y: 4, w: 1592, h: 892, r: skin.alertEdge?.r ?? 0, stroke: pu?.edge ?? skin.alertEdge?.color ?? skin.pal.red.r, strokeWidth: skin.alertEdge?.width ?? 8, fill: '#00000000', z: 9500 } });
    const palKey = alert ? (mode === 'full' ? 'red' : mode === 'edge' ? 'edge' : 'normal') : 'normal';
    const pulsing = !!pu;
    const palChanged = s.lastPal !== '' && s.lastPal !== palKey;
    s.lastPal = palKey;
    const slow = this.reduceMotion ? 0 : 1;
    const ease: Ease = (id, prop) => {
      if (!slow) return 0;
      const calm = t.view?.calm ? 2.5 : 1; // calm mode: 2.5 times slower
      if ((id === PORT_ID || id === 'portframe' || id === 'cw' || id === 'logsum') && /^(x|y|w|h|opacity)$/.test(prop)) return 0.35 * calm; // the animated LOG toggle (the Lua themes' portNode tween)
      if (pulsing && /^(fill|stroke|color)$/.test(prop)) return 0.06; // a pulse sample: a short smoothing glide
      if (palChanged && /^(fill|stroke|color)$/.test(prop)) return ((skin.motion?.alertMs ?? 900) / 1000) * calm;
      return 0;
    };
    const { ops, map } = diffOps(s.prev, prims, ease);
    const rt = this.rtFor(s.id);
    const head: GfxOp[] = [sceneOp(W, H, pal.bg, skin.bloom)];
    if (!s.open) head.push({ op: 'on', scene: SCENE, id: '#scene', events: ['close'] });
    s.open = true;
    s.prev = map;
    s.targets = new Map(prims.filter((p) => p.target).map((p) => [p.id, p.target!]));
    rt.apply([...head, ...ops]);
    // a new notice fades in (150 ms); an update in place does not, and reduced motion shows it at once
    if (nt && noticeNew && slow) for (const id of ['notice.bg', 'notice.tx']) rt.apply([{ op: 'tween', scene: SCENE, target: id, tracks: { opacity: { from: 0, to: 1 } }, dur: 0.15, ease: 'outQuad' }]);
  }

  /** A pointer event from a scene. Returns true when the scene is CMCP's (consumed). */
  handleGfxEvent(session: string, e: GfxEventOut): boolean {
    if (e.scene !== SCENE) return false;
    const s = this.state(session);
    if (e.id === '#scene' && e.event === 'close') { s.dismissed = s.key; s.open = false; s.prev = new Map(); s.targets = new Map(); this.rtFor(session).apply([{ op: 'clear', scene: SCENE }, { op: 'scene', scene: SCENE, open: false }]); return true; }
    const tg = s.targets.get(e.id);
    if (!tg) return true;
    if (tg.special === 'alert') { this.cycleAlert(session); return true; }
    if (tg.special === 'log') { this.toggleLog(session); return true; }
    if (tg.special === 'off') { this.toggleOff(session); return true; }
    if (tg.special === 'nav' && tg.screen) { // the console-switch column: another screen of this console, shown locally
      void this.engine.cmcpShowScreen(session, tg.screen).catch((err: unknown) => this.onError?.(`${tg.screen!.replace('std.', '')}: ${String(err).replace(/^Error: /, '')}`));
      return true;
    }
    let event = tg.event;
    if (e.event === 'drag' && tg.event === 'change') event = 'change';
    const val = typeof tg.value === 'function' ? (tg.value as (x: number, y: number) => unknown)(e.x, e.y) : tg.value;
    if (tg.local) {
      const lv = typeof tg.local.value === 'function' ? (tg.local.value as (x: number, y: number) => unknown)(e.x, e.y) : tg.local.value;
      if (lv === null) s.local.delete(tg.local.key); else s.local.set(tg.local.key, lv);
    }
    if (tg.setUi) void this.engine.cmcpSetUi(session, tg.setUi.key, tg.setUi.value).catch(() => undefined);
    if (tg.local || tg.setUi) this.render(s);
    if (!event) return true;
    const send = (ev: string): void => {
      void this.engine.cmcpEvent(session, tg.path, ev, val).then((r) => {
        for (const er of r.errors ?? []) this.onError?.(er);
      }).catch((err: unknown) => this.onError?.(String(err)));
    };
    if (e.event === 'settle') { send(event); if (event === 'change') send('release'); return true; }
    send(event);
    return true;
  }
}
