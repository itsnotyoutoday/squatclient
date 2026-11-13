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

export type SessionLink = 'attached' | 'detached' | 'unreachable';

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
  /** Squatter sessions only: attached (live), detached (suspended / closed on purpose) or unreachable (connection lost). */
  link?: SessionLink;
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
  /** Live connection state (absent in older engines / mock). */
  state?: SquatterState;
  /** fingerprint_mismatch | auth_failed | unreachable | rate_limited | connection_lost */
  problem?: string;
  message?: string;
  sessions?: number;
}

export type SquatterState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'unreachable' | 'refused';

/** One entry of the "While you were away" summary. */
export interface AwayItem {
  session: string;
  name: string;
  squatter: string;
  unread: number;
  ended: boolean;
  endReason?: string;
  endedAt?: number;
  lastText?: string;
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
  /** Height in px of the single-line input area; 0 = automatic (one line, grows to 8). */
  inputHeight: number;
  /** Height in px of the editor-mode area. */
  editorHeight: number;
  /** Editor mode: lines starting with whitespace continue the previous line. */
  softcodeJoin: boolean;
  /** Editor mode: drop blank lines and `@@` comment-only lines. */
  stripBlankLines: boolean;
  /** Editor mode: pause between the lines of a block (ms; 0 = send at once). */
  sendLineDelayMs: number;
  /** History entries kept per world. */
  historyMax: number;
  /** Editor mode: ask before sending a buffer with bracket problems. */
  warnUnbalanced: boolean;
  /** Bring a lost link to a squatter back by itself (laptop sleep, network drop). */
  autoReconnectSquatters: boolean;
}

/** Result of `readTextFile` (the /upload command). Failures are reported inside the result. */
export interface FileResult {
  ok: boolean;
  error?: string;
  path: string;
  name: string;
  /** bytes on disk */
  size: number;
  encoding: string;
  /** Decoded text, LF line endings, BOM removed. */
  text: string;
}

/** One remembered input. A multi-line editor block is ONE entry (text contains newlines). */
export interface HistoryEntry {
  id: number;
  /** unix milliseconds */
  ts: number;
  text: string;
}

export interface HistoryQueryOpts {
  regex?: boolean;
  caseSensitive?: boolean;
  limit?: number;
  offset?: number;
}

/** A newest-first window onto the matching history entries; `total` counts all matches. */
export interface HistoryPage {
  entries: HistoryEntry[];
  total: number;
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
  /** A squatter's connection state changed. */
  squatter: SquatterConfigState;
  /** /suspend detached the squatter sessions (true) or Resume re-attached them (false). */
  suspend: { suspended: boolean };
  /** Sessions with unread output after (re)attaching to a squatter. */
  away: { sessions: AwayItem[] };
}

/** Payload of the `squatter` event (engine SquatterInfo). */
export interface SquatterConfigState {
  id: string;
  name: string;
  host: string;
  port: number;
  state: SquatterState;
  problem?: string;
  message?: string;
  sessions: number;
  suspended?: boolean;
}

export type EngineEventName = keyof EngineEvents;

// ---- in-game object/attribute editor (docs/EDIT.md sections 9 and 10)

export type EditCode =
  | 'no_session'
  | 'no_such_object'
  | 'permission'
  | 'invalid'
  | 'timeout'
  | 'session_ended'
  | 'rejected'
  | 'mismatch'
  | 'unsafe_value'
  | 'bad_reply'
  | 'ambiguous'
  | 'error';

export interface EditResult {
  ok: boolean;
  error?: string;
  code?: EditCode;
}

export interface EditObjectResult extends EditResult {
  dbref: string;
  name: string;
  type: string;
  owner: string;
  flags: string;
  /** '' when none */
  location: string;
  attrs: { name: string }[];
}

export interface EditAttrResult extends EditResult {
  dbref: string;
  name: string;
  exists: boolean;
  /** raw stored text, literal %r */
  value: string;
  /** %r shown as newline, %t as tab */
  editable: string;
}

export interface EditResolveResult extends EditResult {
  dbref: string;
  name: string;
}

export type Tri = 'true' | 'false' | 'unknown';

export interface EditControlsResult extends EditResult {
  controls: Tri;
}

export interface EditAttrInfoResult extends EditResult {
  known: boolean;
  flags: string;
  flagNames: string;
  owner: string;
  writable: Tri;
}

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
  /** Reconnect a squatter right now (the app also does this by itself unless turned off in Settings). */
  reconnectSquatter(id: string): Promise<void>;
  /** Retry lost squatter links immediately (wake, window shown, network back); returns how many it is retrying. */
  nudgeSquatters(): Promise<number>;
  /** /suspend: detach squatter sessions (they keep running) and minimise; returns how many were detached. */
  suspend(): Promise<number>;
  /** Re-attach suspended squatter sessions; what was missed is replayed. */
  resume(): Promise<void>;
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
  /** Remember one input (a multi-line block is one entry). Never stores secret lines or text typed while echo is off. */
  recordHistory(sessionId: string, text: string): Promise<void>;
  /** The session's WORLD history, newest first; rejects with the reason when `regex` is invalid. */
  history(sessionId: string, query: string, opts: HistoryQueryOpts): Promise<HistoryPage>;
  deleteHistory(sessionId: string, id: number): Promise<void>;
  clearHistory(sessionId: string): Promise<void>;
  /** Native file dialog (text/code filters, starts in the last folder). Resolves '' when cancelled. */
  pickFile(title: string): Promise<string>;
  /** Read a text file the user chose or typed (regular file, <= 5 MiB, no binary). */
  readTextFile(path: string): Promise<FileResult>;
  // ---- in-game object/attribute editor (docs/EDIT.md). These never reject: check `ok`.
  editFetchObject(sessionId: string, dbref: string): Promise<EditObjectResult>;
  editFetchAttr(sessionId: string, dbref: string, attr: string): Promise<EditAttrResult>;
  /** `value` is the editor text (real newlines); the engine stores %r and verifies by reading back. */
  editSaveAttr(sessionId: string, dbref: string, attr: string, value: string): Promise<EditResult>;
  editResolve(sessionId: string, target: string): Promise<EditResolveResult>;
  editControls(sessionId: string, dbref: string): Promise<EditControlsResult>;
  editAttrInfo(sessionId: string, dbref: string, attr: string): Promise<EditAttrInfoResult>;
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
  inputHeight: 0,
  editorHeight: 240,
  softcodeJoin: true,
  stripBlankLines: true,
  sendLineDelayMs: 0,
  historyMax: 20000,
  warnUnbalanced: true,
  autoReconnectSquatters: true,
};
