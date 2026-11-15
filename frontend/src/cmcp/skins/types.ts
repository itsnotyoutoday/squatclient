/** A skin is the look of one theme as plain data (JSON-expressible: the spec's theme-pack format will carry the same things). All
 * geometry is in the scene space of the Lua themes this was modelled on: 1600 x 900 units, fit "contain". Colours are palette roles
 * (`p s t q x r k bg`) or `#rrggbb[aa]`; roles swap to the `red` palette on red alert with an eased recolour. */
export type Role = 'p' | 's' | 't' | 'q' | 'x' | 'r' | 'k' | 'bg';
export type Pal = Record<Role, string>;
export type Rect4 = [number, number, number, number];
export type Colour = Role | `#${string}` | 'none';

interface Common { id?: string; opacity?: number; glow?: number; z?: number }
export type Shape =
  | (Common & { t: 'rect'; x: number; y: number; w: number; h: number; r?: number | number[]; fill?: Colour; stroke?: Colour; sw?: number })
  | (Common & { t: 'elbow'; x: number; y: number; w: number; h: number; corner: 'tl' | 'tr' | 'bl' | 'br'; ro: number; ri: number; bar: number; side: number; fill: Colour })
  | (Common & { t: 'polygon'; points: number[]; fill?: Colour; stroke?: Colour; sw?: number })
  | (Common & { t: 'polyline'; points: number[]; stroke: Colour; sw?: number })
  | (Common & { t: 'path'; d: string; stroke: Colour; sw?: number; fill?: Colour })
  | (Common & { t: 'circle'; x: number; y: number; r: number; fill?: Colour; stroke?: Colour; sw?: number })
  | (Common & { t: 'arc'; x: number; y: number; r0: number; r1: number; a0: number; a1: number; fill: Colour })
  | (Common & { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: Colour; sw?: number })
  /** text with {templates}: {ship} {class} {game} {mode} {hull} {core} {lock} {alert} {title} */
  | (Common & { t: 'text'; x: number; y: number; text: string | TextMap; size: number; fill?: Colour; align?: 'left' | 'center' | 'right'; weight?: string });

/** text chosen by the screen: map[screen key] or default (theme packs, 19.x `text: {by, map, default}`) */
export interface TextMap { by: string; map: Record<string, string>; default?: string }
export interface NavItem { label: string; role: Role; screens: string[] }
export type Button = ButtonSkin;
export interface ButtonSkin { x: number; y: number; w: number; h: number; dx?: number; dy?: number; r?: number | number[]; size: number; align?: 'left' | 'center' | 'right'; padX?: number; color?: Colour; skewX?: number; stroke?: Colour; sw?: number }

export interface Skin {
  name: string;
  font: { family: string; weight: string; files: { file: string; weight?: string }[]; tscale?: number; ctscale?: number };
  sharp?: boolean;
  bloom: number;
  pal: { normal: Pal; red: Pal };
  /** static decoration, back to front */
  frame: Shape[];
  nav: { items: NavItem[]; button: ButtonSkin; marker?: Shape & { t: 'rect' }; fill?: Shape };
  log: { button: ButtonSkin & { role: Role }; shrink: string; expand: string };
  /** the screen-off button: hides the whole CMCP screen and gives the area back to the text (data keeps streaming) */
  off: { button: ButtonSkin & { role: Role }; label: string };
  /** the alert pill (every screen): click cycles green / yellow / red and sends alert.set; default: under the SCREEN OFF button */
  alert?: ButtonSkin & { role: Role };
  port: { rect: Rect4; expanded: Rect4; frame: { role: Role; r: number; width: number; glow: number; inset?: number } };
  /** generic slots (plot#0 data#0 log#0 ...) of the stacked layout; the selector `widget#n` in arrange wins */
  slots?: Record<string, Rect4>;
  /** the side layout's own slots and per-screen arrangements (theme packs author the side layout as their top level) */
  sideSlots?: Record<string, Rect4>;
  sideArrange?: Record<string, Record<string, Rect4>>;
  /** port.max_cols: the side layout's text is at most this many columns wide (default 80) */
  maxCols?: number;
  alertEdge?: { color: string; width: number; r: number };
  motion?: { calm?: number; alertMs?: number };
  /** what a red alert recolours: full | edge | off (theme packs: alert_recolour) */
  alertRecolour?: 'full' | 'edge' | 'off';
  /** where it came from: a downloaded theme pack, or the built-in table */
  source?: 'pack' | 'builtin';
  /** the side layout for dense screens (the band would overflow): the text on the left at 60% of the width, the widgets stacked in a column */
  side: { port: Rect4; content: Rect4 };
  /** the band the screen's widgets are laid out in, around the text port (scene units) */
  content: Rect4;
  widgets: {
    panelTitle: { role: Role; size: number };
    text: Role; head: Role;
    button: { h: number; roles: Role[]; color: Colour };
    bar: { h: number; track: string; fill: Role };
    radar: { kind: 'dish' | 'hex' | 'wing'; ring: Role; color: Role; bg: string; rings: number };
    viewscreen: { r: number; width: number; role: Role };
  };
  /** per-screen arrangement: selector -> rect in scene units. Selectors: `widget#n` (n-th in document order) and `container-of:widget#n`. */
  arrange: Record<string, Record<string, Rect4>>;
}
