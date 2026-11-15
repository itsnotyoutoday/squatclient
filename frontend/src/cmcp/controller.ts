import type { EngineAPI, GfxOp } from '../api/types';
import type { GfxEventOut } from '../gfx/types';
import type { GfxRuntime } from '../gfx/runtime';
import { findTextport, place } from './layout';
import { diffOps, PORT_ID, SCENE, sceneOp } from './ops';
import { drawSprite, type SpriteView } from './sprite';
import type { CmcpNode, CmcpNote, CmcpTree, CmcpUI } from './types';
import { draw, recordHistory, type Ctx, type Prim, type Target } from './widgets';

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
  aspect: number;
  open: boolean;
  dismissed: string;
  key: string;
  fonts: Set<string>;
  lastRev: number;
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
    const offs = [
      this.engine.on('cmcp', (ui) => this.onUi(ui)),
      this.engine.on('cmcp-notes', (p) => { this.onNotes?.(p.session, p.notes); this.noteErrors(p.notes); }),
      this.engine.on('session-removed', (p) => this.sess.delete(p.id)),
    ];
    return () => offs.forEach((o) => o());
  }

  /** For a window that mounts late: fetch the model of a session once. */
  async sync(session: string): Promise<void> {
    const ui = await this.engine.cmcpState(session).catch(() => null);
    if (ui) this.onUi(ui);
  }

  state(session: string): SessionState {
    let s = this.sess.get(session);
    if (!s) {
      s = { id: session, ui: null, tree: null, prev: new Map(), targets: new Map(), local: new Map(), history: new Map(), images: new Map(), spriteDocs: new Map(), spriteWanted: new Set(), spriteDrawn: new Map(), spriteN: 0, aspect: 9 / 16, open: false, dismissed: '', key: '', fonts: new Set(), lastRev: -1 };
      this.sess.set(session, s);
      const rt = this.rtFor(session);
      const prev = rt.onResize;
      rt.onResize = (id, w, h) => {
        prev?.(id, w, h);
        if (id !== SCENE || w <= 0 || h <= 0) return;
        const a = h / w;
        if (Math.abs(a - s!.aspect) > 0.01) { s!.aspect = a; this.render(s!); }
      };
    }
    return s;
  }

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
    if (!t) { this.close(s); s.tree = null; return; }
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

  private reset(s: SessionState): void {
    if (s.open) this.rtFor(s.id).apply([{ op: 'clear', scene: SCENE }]);
    s.prev = new Map();
    s.targets = new Map();
  }

  private close(s: SessionState): void {
    if (!s.open) return;
    this.rtFor(s.id).apply([{ op: 'clear', scene: SCENE }, { op: 'scene', scene: SCENE, open: false }]);
    s.open = false;
    s.prev = new Map();
    s.targets = new Map();
    s.key = '';
  }

  /** Builds the primitives for the current tree and applies the difference. */
  render(s: SessionState): void {
    const t = s.tree;
    if (!t || s.dismissed === s.key) return;
    const W = BASE_W, H = Math.round(BASE_W * s.aspect);
    const root = place(t.root, { x: 0, y: 0, w: W, h: H });
    const tp = findTextport(root);
    if (!tp) return; // a screen without a text port is invalid (spec 6.2); never draw it
    const ctx: Ctx = { tree: t, local: s.local, history: s.history, images: s.images, readonly: s.ui?.readonly ?? false, reduceMotion: this.reduceMotion };
    const prims: Prim[] = draw(root, ctx);
    // the port node: the rectangle where the real text shows (never drawn over)
    prims.unshift({ id: PORT_ID, type: 'rect', props: { x: tp.rect.x, y: tp.rect.y, w: tp.rect.w, h: tp.rect.h, fill: '#00000000' } });
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

  /** A pointer event from a scene. Returns true when the scene is CMCP's (consumed). */
  handleGfxEvent(session: string, e: GfxEventOut): boolean {
    if (e.scene !== SCENE) return false;
    const s = this.state(session);
    if (e.id === '#scene' && e.event === 'close') { s.dismissed = s.key; s.open = false; s.prev = new Map(); s.targets = new Map(); this.rtFor(session).apply([{ op: 'clear', scene: SCENE }, { op: 'scene', scene: SCENE, open: false }]); return true; }
    const tg = s.targets.get(e.id);
    if (!tg) return true;
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
