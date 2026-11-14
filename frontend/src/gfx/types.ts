/** The scene protocol (docs/GFX.md): JSON operations from a script host to the renderer. */
export type Json = number | string | boolean | null | Json[] | { [k: string]: Json };
export type Props = Record<string, unknown>;

export type GfxOp = { op: string; scene?: string } & Record<string, unknown>;

export interface Gradient {
  type: 'linear' | 'radial';
  stops: [number, string][];
  angle?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  cx?: number; cy?: number; r?: number;
}

export type NodeType =
  | 'group' | 'layer' | 'rect' | 'circle' | 'ellipse' | 'arc' | 'elbow' | 'line' | 'polyline' | 'polygon' | 'path'
  | 'text' | 'image' | 'button' | 'planet' | 'starfield' | 'emitter' | 'shader' | 'radar' | 'graph' | 'pixelcanvas';

export const NODE_TYPES: ReadonlySet<string> = new Set([
  'group', 'layer', 'rect', 'circle', 'ellipse', 'arc', 'elbow', 'line', 'polyline', 'polygon', 'path', 'text', 'image',
  'button', 'planet', 'starfield', 'emitter', 'shader', 'radar', 'graph', 'pixelcanvas',
]);

/** drag: throttled while a draggable object moves (x, y are its offset, scaled); settle: the pointer stopped moving for a moment or was released. */
export type PointerEventName = 'click' | 'down' | 'up' | 'enter' | 'leave' | 'move' | 'wheel' | 'drag' | 'settle' | 'close';

/** What the scene reports to its host (the Go side runs the command the script attached). */
export interface GfxEventOut { scene: string; id: string; event: PointerEventName; x: number; y: number }

export interface SceneConfig {
  open: boolean;
  w: number; h: number;
  bg: string;
  dock: 'full' | 'top' | 'bottom' | 'left' | 'right' | 'float';
  size?: number | string;
  margin: [number, number, number, number];
  fit: 'contain' | 'cover' | 'stretch' | 'none';
  bloom: { strength: number; radius: number; threshold: number };
  pixel: boolean;
  passthrough: boolean;
  stats: boolean;
  font: string;
  /** a rectangle in scene units where the game's text output shows through */
  port?: [number, number, number, number];
  /** a rectangle in scene units where the real input line sits */
  inputPort?: [number, number, number, number];
}
