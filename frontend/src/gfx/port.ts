/**
 * The text port: a scene may reserve a rectangle (scene units) where the real game output shows through, as the
 * LCARS console of the terminal client had a port into the MUSH. The scene is fitted into its box with the same rules
 * the renderer uses (contain / cover / stretch / none), so the rectangle can be computed in CSS pixels.
 */
import type { SceneConfig } from './types';

export interface Rect { x: number; y: number; w: number; h: number }

export function viewFit(cfg: Pick<SceneConfig, 'w' | 'h' | 'fit'>, boxW: number, boxH: number): { sx: number; sy: number; ox: number; oy: number } {
  const lw = cfg.w > 0 ? cfg.w : boxW, lh = cfg.h > 0 ? cfg.h : boxH;
  const kx = boxW / lw, ky = boxH / lh;
  switch (cfg.fit) {
    case 'cover': { const s = Math.max(kx, ky); return { sx: s, sy: s, ox: (boxW - lw * s) / 2, oy: (boxH - lh * s) / 2 }; }
    case 'stretch': return { sx: kx, sy: ky, ox: 0, oy: 0 };
    case 'none': return { sx: 1, sy: 1, ox: 0, oy: 0 };
    default: { const s = Math.min(kx, ky); return { sx: s, sy: s, ox: (boxW - lw * s) / 2, oy: (boxH - lh * s) / 2 }; }
  }
}

function rectIn(cfg: Pick<SceneConfig, 'w' | 'h' | 'fit'>, p: unknown, boxW: number, boxH: number, minH: number): Rect | null {
  if (!Array.isArray(p) || p.length !== 4 || boxW <= 0 || boxH <= 0) return null;
  const v = viewFit(cfg, boxW, boxH);
  const r = { x: p[0] * v.sx + v.ox, y: p[1] * v.sy + v.oy, w: p[2] * v.sx, h: p[3] * v.sy };
  if (r.h < minH) { r.y -= (minH - r.h) / 2; r.h = minH; } // a usable input line even when the scene is scaled down
  return r.w > 1 && r.h > 1 ? r : null;
}

/** The text port in CSS pixels inside the scene's box, or null when the scene has none (or the box is empty). */
export function portRect(cfg: Pick<SceneConfig, 'w' | 'h' | 'fit' | 'port'>, boxW: number, boxH: number): Rect | null {
  return rectIn(cfg, cfg.port, boxW, boxH, 0);
}

/** clip-path that shows everything except the holes, so the real output and input beneath show through and get the pointer. */
export function holeClip(box: { w: number; h: number }, holes: Rect | Rect[]): string {
  const list = Array.isArray(holes) ? holes : [holes];
  const parts = [`0 0, ${box.w}px 0, ${box.w}px ${box.h}px, 0 ${box.h}px, 0 0`];
  for (const r of list) {
    const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
    parts.push(`${x1}px ${y1}px, ${x1}px ${y2}px, ${x2}px ${y2}px, ${x2}px ${y1}px, ${x1}px ${y1}px, 0 0`);
  }
  return `polygon(evenodd, ${parts.join(', ')})`;
}

// ---------------------------------------------------------------- the invariant: text and input are never covered

/** A usable game text area: smaller than this and the graphics give way, never the text. */
export const MIN_TEXT = { w: 240, h: 100 };
/** In strip layouts the text output keeps at least this much height. */
export const MIN_TEXT_STRIP_H = 140;

export type Plan =
  | { mode: 'hidden' }
  | { mode: 'strip'; dock: 'top' | 'bottom'; size: string }
  | { mode: 'frame'; out: Rect; input: null };

/**
 * Decides how a scene may sit in the output area. The text output belongs to the app (the input bar below the output area is outside every scene): a scene is laid
 * out around them. 'frame' (full area with a text port, and optionally an input spot) is allowed only when the port is
 * usable; anything else becomes a strip above or below the text that always leaves MIN_TEXT_STRIP_H; if even that does
 * not fit, the scene is hidden. Overlay docks (left, right, float) and margins are not honoured: they could cover text.
 */
export function planScene(cfg: Pick<SceneConfig, 'dock' | 'size' | 'w' | 'h' | 'fit' | 'port'>, box: { w: number; h: number }): Plan {
  if (box.w <= 0 || box.h <= 0) return { mode: 'hidden' };
  if (cfg.dock === 'full' && Array.isArray(cfg.port)) {
    const out = portRect(cfg, box.w, box.h);
    const inside = (r: Rect): boolean => r.x >= -1 && r.y >= -1 && r.x + r.w <= box.w + 1 && r.y + r.h <= box.h + 1;
    if (out && out.w >= MIN_TEXT.w && out.h >= MIN_TEXT.h && inside(out)) return { mode: 'frame', out, input: null };
    return { mode: 'hidden' };
  }
  return { mode: 'strip', dock: cfg.dock === 'bottom' ? 'bottom' : 'top', size: typeof cfg.size === 'number' ? `${cfg.size}px` : cfg.size ?? '60%' };
}

/** The strip's flex-basis, clamped so the text keeps its share. */
export function stripBasis(size: string): string {
  return `max(0px, min(${size}, calc(100% - ${MIN_TEXT_STRIP_H}px)))`;
}

/** The id of the object that is the text port, or undefined ("none" / empty mean no port object). */
export function portNodeOf(cfg: { portNode?: string }): string | undefined {
  const n = cfg.portNode;
  return n && n !== 'none' && n !== '-' ? n : undefined;
}
