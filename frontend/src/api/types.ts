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
  /** Kind of game ("pennmush", "cobramush", "tinymux", "tinymush", "rhostmush", "mush", "other"); absent until detected. */
  gameType?: string;
  /** Module family of the game: "mush" for the MU* family; absent when unknown or not a MU*. */
  gameFamily?: string;
  /** The settings the connection was opened with. */
  encoding?: string;
  tlsVerify?: string;
  gameTypeSource?: 'world' | 'user' | 'banner' | 'probe';
  /** TinyFugue squatter sessions only: who may type and who runs triggers. */
  tf?: TFInfo;
}

/** Who may type into a TinyFugue session. */
export type TFInput = 'tf' | 'remote' | 'both';
/** Who runs triggers/macros for a TinyFugue session. */
export type TFAutomation = 'tf' | 'client';
export type TFPreset = 'viewer' | 'copilot' | 'takeover' | 'full';

/** Control state of one TinyFugue connection (engine proto.TFInfo). */
export interface TFInfo {
  /** TinyFugue's own name for the world this connection belongs to. */
  world: string;
  /** TinyFugue's keyboard is currently on this connection. */
  fg: boolean;
  input: TFInput;
  automation: TFAutomation;
  /** Device id holding automation (when automation is "client"). */
  controllerDevice?: string;
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
  /** The layout this world uses (id of a built-in or user layout; empty = the default). */
  layout?: string;
  /** Overrides game-type detection ("" = detect). */
  gameType?: string;
}

export interface SquatterConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  fingerprint?: string;
  paired: boolean;
  /** "squatterd" (default, absent in old records) or "tf-squatterd" (a TinyFugue bridge). */
  kind?: SquatterKind;
  /** tf-squatterd: "tf" (TinyFugue runs the triggers) or "client" (this client does while connected). */
  automation?: TFAutomation;
  /** tf-squatterd: this device's role, TinyFugue's instance id and offered features. */
  role?: 'viewer' | 'operator' | 'admin';
  instance?: string;
  features?: string[];
  /** Live connection state (absent in older engines / mock). */
  state?: SquatterState;
  /** fingerprint_mismatch | auth_failed | unreachable | rate_limited | connection_lost */
  problem?: string;
  message?: string;
  sessions?: number;
}

export type SquatterKind = 'squatterd' | 'tf-squatterd';

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
  /** The default layout (id); a world may choose its own. Empty = classic. */
  layout?: string;
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
  /** TinyFugue squatters: show lines TinyFugue's /gag hid (they are marked, not removed). */
  showGagged: boolean;
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

export type ConnectTarget =
  | { worldId: string }
  | {
      host: string;
      port: number;
      tls: boolean;
      /** Optional settings of an ad-hoc connection (kept when a quick connect is reconnected). */
      name?: string;
      tlsVerify?: string;
      encoding?: string;
      /** "direct" or a squatter id. */
      via?: string;
    };

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
  /** TinyFugue asks its user (squat_takeover=ask) whether this device may take control. */
  'control-pending': { session: string; axis: 'input' | 'automation'; mode: string; deviceName?: string };
  /** Another device changed TinyFugue's world records: reload the list. */
  'tf-worlds': { squatter: string };
  /** MSDP variables a game sent (changed variables only). */
  msdp: { session: string; vars: Record<string, unknown> };
  /** Snapshot of a session's GMCP/MSDP data (after attach or on request). */
  data: SessionData;
}

/** Latest GMCP and MSDP values of a session. */
export interface SessionData {
  session: string;
  asOf: number;
  gmcp?: Record<string, unknown>;
  msdp?: Record<string, unknown>;
}

/** A world record held by TinyFugue (never contains the password). */
export interface TFWorld {
  name: string;
  host: string;
  /** A number or a service name. */
  port: string;
  type?: string;
  char?: string;
  passSet: boolean;
  tls?: boolean;
  echo?: boolean;
  charset?: string;
  /** Admins only. */
  mfile?: string;
  temp?: boolean;
}

/** Argument of putTFWorld. password is write-only: empty keeps the stored one. */
export interface TFWorldPut extends Omit<TFWorld, 'passSet'> {
  passSet?: boolean;
  password?: string;
  clearPassword?: boolean;
  setMfile?: boolean;
  /** Also run /saveworld in TinyFugue so the record survives its restart. */
  save?: boolean;
}

/** What uploading a script did: stored on TinyFugue, loaded without an error, and what TinyFugue printed. */
export interface TFScriptResult {
  stored: boolean;
  loaded: boolean;
  out: string[];
}

export interface TFScript {
  name: string;
  size: number;
  /** unix milliseconds */
  mtime: number;
}

export interface TFExecResult {
  ok: boolean;
  out: string[];
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

// ---- object details of the Object Editor (docs/EDIT.md section 11). Calls never reject: check `ok`.

export interface EditLock {
  type: string;
  expr: string;
  /** lock flags by name: visual, no_inherit, no_clone, wizard, locked */
  flags: string[];
}
export interface EditObjRef {
  dbref: string;
  name: string;
}
export interface EditDetails {
  dbref: string;
  name: string;
  /** lower case: room, thing, player, exit, garbage */
  type: string;
  owner: string;
  /** '' when none */
  parent: string;
  zone: string;
  /** containing room (an exit: its source room) */
  location: string;
  home: string;
  /** exits only */
  destination: string;
  /** null: the game did not say */
  pennies: number | null;
  created: string;
  modified: string;
  flags: string[];
  flagLetters: string;
  powers: string[];
  locks: EditLock[];
  contents: EditObjRef[];
  exits: EditObjRef[];
  /** -1 when unknown */
  attrCount: number;
  /** names of the dbrefs above (owner, parent, zone, location, home, destination), where known */
  names: Record<string, string>;
  /** the warning list as the game reports it ('' = unknown) */
  warnings: string;
  /** parent, grandparent, ... */
  parentChain: EditObjRef[];
  /** player facts the game exposed: alias, channels, quota */
  extra: Record<string, string>;
}
/** Result of editDetails and of every mutation: the verified state and the game's exact reply. */
export interface EditDetailsResult extends EditResult {
  reply: string;
  details: EditDetails;
}
export interface EditCatalogItem {
  name: string;
  letter: string;
  desc: string;
}
export interface EditCatalogResult extends EditResult {
  /** false: the game gave nothing usable (let the user type a name) */
  known: boolean;
  items: EditCatalogItem[];
}
export interface EditAttrFlagResult extends EditResult {
  reply: string;
  known: boolean;
  flags: string;
  flagNames: string;
}
export interface EditPlace {
  dbref: string;
  name: string;
  type: string;
  owner: string;
}
export interface EditSearchResult extends EditResult {
  items: EditPlace[];
  /** the game refused a global room search: only your own rooms and things nearby */
  restricted: boolean;
  truncated: boolean;
}
export interface EditNearbyExit {
  dbref: string;
  name: string;
  destDbref: string;
  destName: string;
}
export interface EditNearbyResult extends EditResult {
  room: EditPlace;
  desc: string;
  exits: EditNearbyExit[];
  contents: EditPlace[];
}

export interface EditTestLockResult extends EditResult {
  result: Tri;
  /** the game's text */
  raw: string;
}
export interface EditAttrLockResult extends EditResult {
  locked: Tri;
  reply: string;
}
export interface EditAttrOwnerResult extends EditResult {
  owner: string;
  reply: string;
}
export interface EditReplyResult extends EditResult {
  reply: string;
}
export interface EditLinesResult extends EditResult {
  lines: string[];
}
/** The game's examine text with colour: one span list per line. */
export interface EditExamineResult extends EditResult {
  lines: Span[][];
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
    /** "squatterd" (default) or "tf-squatterd". */
    kind?: SquatterKind,
  ): Promise<{ id: string; fingerprint: string }>;
  confirmSquatter(id: string, accept: boolean): Promise<void>;
  removeSquatter(id: string): Promise<void>;
  /** Reconnect a squatter right now (the app also does this by itself unless turned off in Settings). */
  reconnectSquatter(id: string): Promise<void>;
  // ---- TinyFugue squatters (docs/TF-SQUATTER.md in the daemon repository)
  /** Change one control axis of a TinyFugue session; resolves when TinyFugue applied it (may wait for its user). */
  setControl(sessionId: string, axis: 'input' | 'automation', mode: string): Promise<void>;
  /** Apply a preset: viewer (watch), copilot (type too), takeover (type + run triggers), full. */
  controlPreset(sessionId: string, preset: TFPreset): Promise<void>;
  /** Store and apply which side runs triggers for a TinyFugue squatter. */
  setSquatterAutomation(squatterId: string, mode: TFAutomation): Promise<void>;
  listTFWorlds(squatterId: string): Promise<TFWorld[]>;
  putTFWorld(squatterId: string, w: TFWorldPut): Promise<void>;
  deleteTFWorld(squatterId: string, name: string): Promise<void>;
  /** Open a connection from one of TinyFugue's own world records. */
  connectTFWorld(squatterId: string, name: string): Promise<SessionInfo>;
  /** Run a TinyFugue command (admin devices only). */
  tfExec(squatterId: string, line: string): Promise<TFExecResult>;
  /**
   * Upload a script (a TinyFugue macro file) to TinyFugue, and with `load` activate it. Admin devices
   * only. TinyFugue's squat_scripts decides: off refuses, "safe" runs it sandboxed (no shell, files,
   * new connections or Lua, also when its macros run later), "on" with TinyFugue's own rights.
   * Names are letters, digits, . _ - and end in .tf; the same name replaces the old script.
   */
  putTFScript(squatterId: string, name: string, content: string, load: boolean): Promise<TFScriptResult>;
  listTFScripts(squatterId: string): Promise<TFScript[]>;
  deleteTFScript(squatterId: string, name: string): Promise<void>;
  sendGmcp(sessionId: string, pkg: string, dataJson: string): Promise<void>;
  sendMsdp(sessionId: string, varsJson: string): Promise<void>;
  getSessionData(sessionId: string): Promise<SessionData>;
  /** Retry lost squatter links immediately (wake, window shown, network back); returns how many it is retrying. */
  nudgeSquatters(): Promise<number>;
  /** Set what kind of game a session is ("" or "auto" detects it again). */
  setGameType(sessionId: string, gameType: string): Promise<void>;
  /** Link a session to a saved world (after saving a quick connect as a world). */
  setSessionWorld(sessionId: string, worldId: string): Promise<void>;
  /** /suspend: detach squatter sessions (they keep running) and minimise; returns how many were detached. */
  suspend(): Promise<number>;
  /** Re-attach suspended squatter sessions; what was missed is replayed. */
  resume(): Promise<void>;
  /** Quit the application (File > Quit on Windows and Linux). */
  quit(): Promise<void>;
  /** The application version (About dialog). */
  appVersion(): Promise<string>;
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
  // ---- object details (docs/EDIT.md section 11): silent like the calls above; never typed input
  editDetails(sessionId: string, dbref: string): Promise<EditDetailsResult>;
  editListFlags(sessionId: string): Promise<EditCatalogResult>;
  editListPowers(sessionId: string): Promise<EditCatalogResult>;
  editSetFlag(sessionId: string, dbref: string, flag: string, on: boolean): Promise<EditDetailsResult>;
  editSetPower(sessionId: string, dbref: string, power: string, on: boolean): Promise<EditDetailsResult>;
  editSetAttrFlag(
    sessionId: string,
    dbref: string,
    attr: string,
    flag: string,
    on: boolean,
  ): Promise<EditAttrFlagResult>;
  editRename(sessionId: string, dbref: string, name: string): Promise<EditDetailsResult>;
  editChown(sessionId: string, dbref: string, owner: string): Promise<EditDetailsResult>;
  /** parent '' or 'none' clears */
  editSetParent(sessionId: string, dbref: string, parent: string): Promise<EditDetailsResult>;
  editSetZone(sessionId: string, dbref: string, zone: string): Promise<EditDetailsResult>;
  /** expr '' or 'none' removes the lock */
  editSetLock(sessionId: string, dbref: string, lockType: string, expr: string): Promise<EditDetailsResult>;
  editSetHome(sessionId: string, dbref: string, room: string): Promise<EditDetailsResult>;
  editSetDestination(sessionId: string, dbref: string, room: string): Promise<EditDetailsResult>;
  editMove(sessionId: string, dbref: string, dest: string): Promise<EditDetailsResult>;
  editSetLockFlag(
    sessionId: string,
    dbref: string,
    lockType: string,
    flag: string,
    on: boolean,
  ): Promise<EditDetailsResult>;
  /** evaluates the stored lock for a target (dbref or name) with elock() */
  editTestLock(
    sessionId: string,
    dbref: string,
    lockType: string,
    target: string,
  ): Promise<EditTestLockResult>;
  editSetAttrLock(sessionId: string, dbref: string, attr: string, on: boolean): Promise<EditAttrLockResult>;
  editAttrChown(sessionId: string, dbref: string, attr: string, player: string): Promise<EditAttrOwnerResult>;
  editRenameAttr(sessionId: string, dbref: string, from: string, to: string): Promise<EditReplyResult>;
  editDeleteAttr(sessionId: string, dbref: string, attr: string): Promise<EditReplyResult>;
  /** list: space separated warning names, e.g. 'normal' or 'none' */
  editSetWarnings(sessionId: string, dbref: string, list: string): Promise<EditDetailsResult>;
  editWCheck(sessionId: string, dbref: string): Promise<EditLinesResult>;
  /** mode: '' | 'all' | 'brief' */
  editExamine(sessionId: string, dbref: string, mode: string): Promise<EditExamineResult>;
  editSearchRooms(sessionId: string, query: string): Promise<EditSearchResult>;
  editNearby(sessionId: string, dbref: string): Promise<EditNearbyResult>;
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
  showGagged: false,
};
