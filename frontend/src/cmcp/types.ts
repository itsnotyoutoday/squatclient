/** The CMCP model as the Go engine publishes it (squatClientDaemon pkg/engine/cmcp*.go). Protocol messages nested inside keep the
 * wire's snake_case; fields the client adds are camelCase. The front end never evaluates packs or parses protocol: it draws trees. */
export interface CmcpLayout {
  dir?: 'row' | 'col' | 'grid' | 'stack' | '';
  gap?: number; pad?: number; weight?: number; size?: number; hasSize?: boolean;
  cols?: number; rows?: number; col?: number; row?: number; colspan?: number; rowspan?: number; align?: string;
}

export interface CmcpNode {
  path: string;
  id?: string;
  widget: string;
  label?: string;
  props: Record<string, unknown>;
  layout: CmcpLayout;
  enabled: boolean;
  events?: string[];
  children?: CmcpNode[];
}

export interface CmcpTree {
  session: string;
  generation: number;
  screen: string;
  title: string;
  console?: string;
  theme: string;
  themeSource?: 'pack' | 'builtin' | 'plain';
  themeVersion?: string;
  /** textport_layout decided by the core for the reported viewport (side | stacked) and the side textport's width cap in device px */
  layout?: 'side' | 'stacked';
  portCapPx?: number;
  /** the effective alert_recolour (full | edge | off): the theme's field with the player's setting applied by the core */
  alertMode?: 'full' | 'edge' | 'off';
  /** The text view's state from the shared core (LOG / screen-off) and the player's size choice. */
  view?: { state: 'compact' | 'balanced' | 'large' | 'expanded' | 'off'; portDefault: 'compact' | 'balanced' | 'large'; fraction: number; calm: boolean };
  tokens: Record<string, string | number>;
  packKey: string;
  exhausted?: boolean;
  root: CmcpNode;
  ui: Record<string, unknown>;
}

export interface CmcpSub { pkg: string; rateMs?: number; source: string; ok: boolean; err?: string }
export interface CmcpCommandSpec { name: string; consoles: string[]; mutating: boolean; text: string; args: Record<string, unknown> }

export interface CmcpStackEntry { key: string; kind: string; id: string; name?: string; title?: string; screen: string; priority: number; active: boolean; readonly?: boolean; mannedBy?: string; expiresMs?: number }

export interface CmcpScope { title?: string; owner?: { id: string; epoch: number; name?: string; theme?: string; class?: string; empire?: string; ai?: boolean } | null }
/** The active context of a CMCP 2 session: where the player is, the layout in force and where it is presented. */
export interface CmcpCtx { type: string; scope: string; key: string; id?: string; layout: string; surface: 'screen' | 'panel' | 'dock' | 'float' | string; ambient: boolean; data?: Record<string, unknown>; layouts?: string[] }

export interface CmcpUI {
  session: string;
  rev: number;
  generation: number;
  state: 'off' | 'declared' | 'hello_sent' | 'ready' | 'closed';
  proto: number;
  server?: { server: string; game?: string };
  welcome?: { ship?: { id?: string; name?: string; class?: string }; packs?: { id: string; kind: string; version: string; sha256: string }[]; features?: string[] };
  ship?: { id: string; name?: string; class?: string; empire?: string; epoch: number; ai?: boolean; theme?: string };
  console?: { id: string; name: string; manned_by?: string } | null;
  consoleRev: number;
  /** CMCP 2 (spec chapter 20): scopes with their owners and the active context; the ship / console fields above are empty then. */
  v2?: boolean;
  def?: { id: string; version: string; sha256: string; size?: number };
  /** the definition was refused: no contexts are shown (the notice line says why) */
  textClient?: boolean;
  textReason?: string;
  scopes?: Record<string, CmcpScope>;
  ctx?: CmcpCtx;
  ambience?: boolean;
  reason?: string;
  readonly: boolean;
  ai: boolean;
  title?: string;
  shipTheme?: string;
  consoleTheme?: string;
  screen: { id: string; resolved: string; packId?: string; fallback: boolean };
  commands: string[];
  /** Held contexts (consoles, rooms, away teams, events, docks), lowest priority first; the last one is shown. */
  stack?: CmcpStackEntry[];
  catalogueComplete?: boolean;
  /** The screen menu: the screens this console can show, with why a screen is dimmed and how to get it. */
  /** the one notice line (the core's queue: pack downloads, accepted packs, theme in use, command errors with hints) */
  notice?: { id: string; kind: string; state: string; text: string };
  /** every screen with its state and hint, and the core's directory lines (`LABEL - man <console> to use`) */
  allScreens?: { id: string; title: string; available: boolean; reason?: string; hintCmd?: string; active: boolean; state?: string; hint?: string }[];
  directory?: string[];
  screens?: { id: string; title: string; available: boolean; reason?: string; hintCmd?: string; active: boolean; state?: string; hint?: string }[];
  localScreen?: string;
  pinned?: boolean;
  catalogue?: Record<string, CmcpCommandSpec>;
  subs: CmcpSub[];
  docs?: Record<string, unknown>;
  /** Space.Ship.Status (name, alert, hull, core, lock): what the frame's status strip shows (the pushed model has no docs). */
  status?: Record<string, unknown>;
  seqs: Record<string, number>;
  alert?: string;
  pending: number;
  tree: CmcpTree | null;
}

export interface CmcpEventResult { tickets: { id: number; cmd: string; mutating: boolean; echo: string }[]; errors?: string[]; show?: string }

/** Notes that are not model state: sounds, events, replies. */
export interface CmcpNote {
  kind: 'state' | 'ready' | 'reset' | 'console' | 'data' | 'event' | 'scan' | 'reply' | 'timeout' | 'pack' | 'bye' | 'error' | 'log' | 'sound' | 'ui-sound' | 'pack-consent' | 'pack-ready' | 'pack-accepted';
  pkg?: string;
  text?: string;
  event?: { type: string; level?: string; text?: string; data?: Record<string, unknown> };
  reply?: { id: number; cmd: string; ok: boolean; err?: string; hint?: string; hintCmd?: string; result?: Record<string, unknown> };
  sound?: { event?: string; id?: string; key?: string; loop?: boolean; stage?: number; vol?: number; params?: Record<string, unknown>; [k: string]: unknown };
  stop?: { key?: string; event?: string; all?: boolean; [k: string]: unknown };
  stopAll?: boolean;
  fadeMs?: number;
  params?: Record<string, unknown>;
  /** pack-consent / pack-ready: the pack entry */
  pack?: { id: string; kind: string; version: string; sha256: string; size?: number };
}

/** One sample of the red-alert pulse from the engine (the core's pulse function and theme.PulseColour): the roles r and x and the alert edge
 * re-coloured at this level. `active` false = steady (draw the plain colours). */
export interface CmcpPulse {
  session: string; active: boolean; level: number; phase: string; periodMs?: number; alert?: string; roles?: Record<string, string>; edge?: string;
  /** the ship-wide alert ambience (drawn on every screen aboard) and the hit shake offset (scene px; frame and widgets only) */
  ambient?: { edge: string; roles: string[]; hueBg?: string };
  shake?: { active: boolean; x: number; y: number };
}
