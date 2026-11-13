// Mirrors docs/UI-CONTRACT.md and pkg/proto. Keep 1:1.

export type Color = number | string; // 0-15 theme ANSI, 16-255 xterm palette, "#rrggbb" truecolor

export interface Span {
  s: string;
  fg?: Color;
  bg?: Color;
  b?: true;
  dim?: true;
  i?: true;
  u?: true;
  st?: true;
  blink?: true;
  rev?: true;
  link?: string;
}

export type LineKind = 'game' | 'echo' | 'system';

export interface Line {
  session: string;
  seq: number;
  ts: number;
  kind: LineKind;
  spans: Span[];
  prompt?: true;
}

export type SessionState = 'connecting' | 'connected' | 'ended';

export interface SessionInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  tls: boolean;
  state: SessionState;
  startedAt: number;
  firstSeq: number;
  lastSeq: number;
  unread: number;
  attached: number;
  remoteEcho: boolean;
  via: 'direct' | string;
  /** Id of the world this session was opened from (absent for quick connects). */
  worldId?: string;
  endedAt?: number;
  endReason?: string;
  endDetail?: string;
  lastText?: string;
}

export interface WorldLogin {
  template: string;
  charName?: string;
  hasPassword: boolean;
  delayMs?: number;
}

export interface WorldConfig {
  id: string;
  name: string;
  group?: string;
  host: string;
  port: number;
  tls: boolean;
  tlsVerify: 'strict' | 'insecure';
  encoding: 'utf-8' | 'latin1';
  via: 'direct' | string;
  notes?: string;
  login?: WorldLogin;
  autoConnect?: boolean;
  macrosFile?: string;
}

export interface SquatterConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  fingerprint?: string;
  paired: boolean;
}

export interface Settings {
  theme: string;
  fontFamily: string;
  fontSize: number;
  scrollbackLines: number;
  timestamps: boolean;
  boldAsBright: boolean;
  minContrast: number;
  linkify: boolean;
  notifications: boolean;
  screenReader: boolean;
  pauseOnScroll: boolean;
  defaultEncoding: 'utf-8' | 'latin1';
  truecolor: true;
}

export type ConnectTarget = { worldId: string } | { host: string; port: number; tls: boolean };

export interface SearchHit {
  seq: number;
  preview: string;
}

export interface StatusField {
  name: string;
  text: string;
  attrs?: string;
}

export interface EngineEvents {
  line: Line;
  session: SessionInfo;
  status: { session: string; fields: StatusField[] };
  notice: { level: 'info' | 'warn' | 'error'; text: string; session?: string };
  bell: { session: string };
  gmcp: { session: string; package: string; data: unknown };
  quit: Record<string, never>;
  /** A session was dismissed (by this or another client). */
  'session-removed': { id: string };
  /** The engine changed the foreground session (e.g. a script ran /fg). */
  foreground: { session: string };
  /** The session's view filter (/limit) changed: drop the buffer and refetch scrollback. */
  reset: { session: string };
  /** A native menu item was chosen. */
  menu: { action: string };
}

export type EngineEventName = keyof EngineEvents;

export interface EngineAPI {
  listWorlds(): Promise<WorldConfig[]>;
  saveWorld(w: WorldConfig): Promise<WorldConfig>;
  deleteWorld(id: string): Promise<void>;
  setWorldPassword(id: string, password: string): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  listSquatters(): Promise<SquatterConfig[]>;
  pairSquatter(
    host: string,
    port: number,
    name: string,
    pairCode: string,
  ): Promise<{ id: string; fingerprint: string }>;
  confirmSquatter(id: string, accept: boolean): Promise<void>;
  removeSquatter(id: string): Promise<void>;
  connect(target: ConnectTarget): Promise<SessionInfo>;
  disconnect(sessionId: string): Promise<void>;
  dismiss(sessionId: string): Promise<void>;
  listSessions(): Promise<SessionInfo[]>;
  foreground(sessionId: string): Promise<void>;
  input(sessionId: string, text: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  scrollback(sessionId: string, opts: { beforeSeq?: number; limit: number }): Promise<Line[]>;
  search(
    sessionId: string,
    query: string,
    opts: { regex?: boolean; caseSensitive?: boolean },
  ): Promise<SearchHit[]>;
  ack(sessionId: string, seq: number): Promise<void>;
  on<E extends EngineEventName>(event: E, cb: (payload: EngineEvents[E]) => void): () => void;
}

export const DEFAULT_FONT = 'JetBrains Mono, SF Mono, Menlo, Consolas, monospace';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  fontFamily: DEFAULT_FONT,
  fontSize: 14,
  scrollbackLines: 20000,
  timestamps: false,
  boldAsBright: false,
  minContrast: 0,
  linkify: true,
  notifications: true,
  screenReader: false,
  pauseOnScroll: true,
  defaultEncoding: 'utf-8',
  truecolor: true,
};
