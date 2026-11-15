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
  tokens: Record<string, string | number>;
  packKey: string;
  exhausted?: boolean;
  root: CmcpNode;
  ui: Record<string, unknown>;
}

export interface CmcpSub { pkg: string; rateMs?: number; source: string; ok: boolean; err?: string }
export interface CmcpCommandSpec { name: string; consoles: string[]; mutating: boolean; text: string; args: Record<string, unknown> }

export interface CmcpStackEntry { key: string; kind: string; id: string; name?: string; title?: string; screen: string; priority: number; active: boolean; readonly?: boolean; mannedBy?: string; expiresMs?: number }

export interface CmcpUI {
  session: string;
  rev: number;
  generation: number;
  state: 'off' | 'declared' | 'hello_sent' | 'ready' | 'closed';
  proto: number;
  server?: { server: string; game?: string };
  welcome?: { packs?: { id: string; kind: string; version: string; sha256: string }[]; features?: string[] };
  ship?: { id: string; name?: string; class?: string; empire?: string; epoch: number; ai?: boolean; theme?: string };
  console?: { id: string; name: string; manned_by?: string } | null;
  consoleRev: number;
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
  catalogue?: Record<string, CmcpCommandSpec>;
  subs: CmcpSub[];
  docs?: Record<string, unknown>;
  seqs: Record<string, number>;
  alert?: string;
  pending: number;
  tree: CmcpTree | null;
}

export interface CmcpEventResult { tickets: { id: number; cmd: string; mutating: boolean; echo: string }[]; errors?: string[]; show?: string }

/** Notes that are not model state: sounds, events, replies. */
export interface CmcpNote {
  kind: 'state' | 'ready' | 'reset' | 'console' | 'data' | 'event' | 'scan' | 'reply' | 'timeout' | 'pack' | 'bye' | 'error' | 'log' | 'sound' | 'ui-sound' | 'pack-consent' | 'pack-ready';
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
