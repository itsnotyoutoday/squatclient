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
  /** this world's sound is muted (the speaker button, the tab menu); the global soundMuted setting mutes every world */
  soundMuted?: boolean;
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
  /** "gtf": a tf-squatterd that is GoTinyFugue's built-in squatter (own worlds, own triggers, no scripts upload). */
  flavor?: 'gtf';
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
  /** The user's scripts folder ('' = the app-data folder): a relative /load, /log, /save starts here. Applies at the next start. */
  scriptsDir?: string;
  /** Extra library folders /load and /require search after the shipped library. Applies at the next start. */
  libDirs?: string[];
  /** Editor mode: ask before sending a buffer with bracket problems. */
  warnUnbalanced: boolean;
  /** Bring a lost link to a squatter back by itself (laptop sleep, network drop). */
  autoReconnectSquatters: boolean;
  /** TinyFugue squatters: show lines TinyFugue's /gag hid (they are marked, not removed). */
  showGagged: boolean;
  /** Send TinyFugue (admin devices, squat_scripts on) a script that keeps SquatClient's own queries off its screen. */
  tfHideQueries: boolean;
  /** CMCP: advertise it to games (off = text only). */
  cmcp: boolean;
  /** Console theme: tng soft klingon romulan tos ferengi ops. */
  consoleTheme: string;
  /** Follow the theme and sound era the ship or console suggests. */
  useShipTheme: boolean;
  /** Sound era override ("" = the game's). */
  soundEra: string;
  /** The player's local sound folder (never uploaded). */
  soundFolder: string;
  soundVolume: number;
  soundMuted: boolean;
  /** CMCP screens start switched off (the text has the whole area); Alt+S or the pane's button brings them back. */
  /** Draw a screen for ship rooms, the turbolift and away teams too (default off: only a console you man gets a screen). */
  cmcpRoomScreens: boolean;
  cmcpStartCollapsed: boolean;
  cmcpPackConsent: 'always' | 'ask' | 'never';
  cmcpAlertRecolour: 'theme' | 'full' | 'edge' | 'off';
  cmcpAlertPulse: 'theme' | 'on' | 'off';
  cmcpAlertAmbient: 'theme' | 'on' | 'off';
  cmcpHitShake: 'theme' | 'on' | 'off';
  cmcpTextLayout: 'auto' | 'left' | 'stacked';
  /** Console theme: follow the ship's suggested theme (default) or always use `consoleTheme`. */
  consoleThemeMode: 'ship' | 'fixed';
  /** Text view size: compact (the theme's own, ~20%, animated LOG toggle), balanced (45%, default), large (60%). */
  cmcpPortDefault: 'compact' | 'balanced' | 'large';
  /** Calm mode: eased motion 2.5 times slower. */
  cmcpCalm: boolean;
  soundCategoryVolumes?: Record<string, number>;
}

/** Result of `readTextFile` (the /upload command). Failures are reported inside the result. */
/** The folders TinyFugue files live in (see docs/LIB.md "Where files go"). */
export interface ScriptFolders {
  scripts: string;
  appData: string;
  lib: string;
  tfLib: string;
  home: string;
}

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

import type { CmcpEventResult, CmcpNote, CmcpPulse, CmcpUI } from '../cmcp/types';
import type { SoundMsg } from '../cmcp/audio';

export interface EngineEvents {
  /** The CMCP model of a session changed (throttled); `tree` is the bound console screen, null when none is up. */
  cmcp: CmcpUI;
  /** A CMCP sound, resolved by the Go side (local file, pack sample, recipe, bell) for the Web Audio engine. */
  'cmcp-audio': SoundMsg;
  /** CMCP sounds, events and replies of a session (never coalesced). */
  'cmcp-notes': { session: string; notes: CmcpNote[] };
  'cmcp-pulse': CmcpPulse;
  'sound-mute': { session: string; muted: '' | 'global' | 'world' };
  /** The Go side wrote a diagnostics snapshot: the page adds its own state lines (tabs, audio, mutes). */
  'diag-snapshot': { why: string };
  line: Line;
  session: SessionInfo;
  status: { session: string; fields: StatusField[] };
  notice: { level: 'info' | 'warn' | 'error'; text: string; session?: string };
  bell: { session: string };
  gmcp: { session: string; package: string; data: unknown };
  quit: Record<string, never>;
  /** A script ran /help: open the help browser on this topic. */
  help: { topic: string };
  /** A script ran /input: insert this text into the input line (it is never sent). */
  input: { text: string };
  /** A world command or script asks for a window ("worlds", "settings", "layouts", ...; "gfx" shows the graphics layer). */
  dialog: { name: string };
  /** Scene operations of the graphics language (docs/GFX.md). */
  gfx: GfxOp[];
  /** A TinyFugue variable that shapes the output window changed (wrap, wrapsize, wrapspace, wrappunct, visual, more). */
  tfvar: { name: string; value: string };
  /** The key sequences TinyFugue scripts have bound (/bind notation). */
  tfkeys: { seqs: string[] };
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
  'tf-worlds': { squatter: string; oldName?: string; newName?: string };
  /** The list of worlds changed behind the UI's back (e.g. TinyFugue renamed one): reload it. */
  worlds: { reason?: string };
  /** MSDP variables a game sent (changed variables only). */
  msdp: { session: string; vars: Record<string, unknown> };
  /** Snapshot of a session's GMCP/MSDP data (after attach or on request). */
  data: SessionData;
  /** The layouts folder or the list of allowed layouts changed: reload the layout in use. */
  'layouts-changed': Record<string, never>;
  /** The themes folder changed: reload the theme list. */
  'themes-changed': Record<string, never>;
  /** Lua variables (squat.var) that were set (or, with null, deleted). */
  vars: { vars: Record<string, unknown> };
}

/** A file in the user's themes folder; `json` is its contents, validated by the window. */
export interface ThemeFile {
  id: string;
  file: string;
  json: string;
  modified: number;
}

/** A layout file in the user's layouts folder (docs/LAYOUTS.md). */
export interface LayoutInfo {
  id: string;
  name: string;
  file: string;
  hash: string;
  modified: number;
  /** The user allowed this exact content to run. */
  allowed: boolean;
}

/** What the window needs to run a layout. */
export interface LayoutBundle {
  id: string;
  hash: string;
  /** Compiled JavaScript (CommonJS); empty until the user allowed the layout. */
  code?: string;
  /** The layout's <lua> block, for the engine. */
  lua?: string;
  css?: string;
  needsConsent?: boolean;
  /** Source to show when consent is needed. */
  source?: string;
  error?: string;
}

/** A layout that ships with the app, as source to copy and edit. */
export interface LayoutStarter {
  id: string;
  name: string;
  source: string;
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

export interface TFKeyResult {
  handled: boolean;
  text: string;
  /** a byte offset */
  cursor: number;
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

// ---- diagnostics log (docs/DIAGNOSTICS.md)

export interface DiagInfo {
  mode: 'always' | 'optin' | 'off';
  available: boolean;
  enabled: boolean;
  build: string;
  version: string;
  os: string;
  arch: string;
  repoSlug: string;
  contactName: string;
  contactHost: string;
  contactPort: number;
  folder: string;
}
export interface DiagSession {
  id: string;
  current: boolean;
  bytes: number;
  segments: number;
  redactions: number;
}
export interface DiagStatus {
  info: DiagInfo;
  log: { enabled: boolean; session: string; sessions: DiagSession[]; dropped: number; budget: number };
  redactions: number;
}
export interface DiagZipOptions {
  currentOnly: boolean;
  note: string;
  dest: string;
}
export interface DiagZipResult {
  path: string;
  size: number;
  files: { name: string; bytes: number }[];
  redactions: number;
}

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

/** One operation of the graphics scene protocol. */
export type GfxOp = { op: string; scene?: string } & Record<string, unknown>;

export interface EngineAPI {
  // ---- CMCP (docs/CMCP.md): the game's consoles, drawn from protocol data evaluated by the shared Go core
  /** The CMCP model of a session with its bound screen, or null when the game does not speak CMCP. */
  cmcpState(session: string): Promise<CmcpUI | null>;
  /** A widget event of the current screen (path of the CmcpNode, event name, the widget's output). */
  cmcpEvent(session: string, path: string, event: string, value?: unknown): Promise<CmcpEventResult>;
  /** Sends a verb of the game's catalogue. */
  cmcpCommand(session: string, name: string, args?: Record<string, unknown>): Promise<{ id: number; echo: string }>;
  /** Extra packages an owner needs (reference counted); an empty list releases the owner. */
  cmcpAcquire(session: string, owner: string, subs: { pkg: string; rate_ms?: number }[]): Promise<void>;
  cmcpRelease(session: string, owner: string): Promise<void>;
  /** Toggles the text view: 'log_toggle' (compact <-> expanded) or 'screen_toggle' (console screen off/on). Returns the state. */
  cmcpViewEvent(session: string, ev: 'log_toggle' | 'screen_toggle'): Promise<string>;
  /** Shows another screen of the current console locally (the console-switch column); subscriptions follow. */
  cmcpShowScreen(session: string, screen: string): Promise<void>;
  /** Next (dir > 0) or previous available screen of the console; returns the one shown. */
  cmcpCycleScreen(session: string, dir: number): Promise<string>;
  cmcpPinScreen(session: string, pin: boolean): Promise<void>;
  /** The player's answer to the first-use question about a game's interface pack. */
  cmcpPackConsent(session: string, packId: string, allow: boolean): Promise<void>;
  cmcpThemeDoc(session: string, themeId: string): Promise<Record<string, unknown>>;
  cmcpReducedMotion(on: boolean): Promise<void>;
  /** a line of the web view's own diagnostics (classified by its prefix) for the diagnostics log */
  clientLog(line: string): Promise<void>;
  /** the build's diagnostics policy and constants (docs/DIAGNOSTICS.md) */
  diagInfo(): Promise<DiagInfo>;
  /** logging state and the sizes of the current and the previous session's logs */
  diagStatus(): Promise<DiagStatus>;
  /** the dialog's on/off switch (persists) */
  diagSetEnabled(on: boolean): Promise<void>;
  /** delete every diagnostics log */
  diagClear(): Promise<void>;
  /** the last n lines of the current session that contain filter */
  diagView(n: number, filter: string): Promise<string[]>;
  /** one line of the page's own timeline (layer ui, web-audio, error, snapshot...; session is the engine's session id or "") */
  diagLog(layer: string, session: string, text: string): Promise<void>;
  /** write a state snapshot now */
  diagSnapshot(): Promise<void>;
  /** the last few error lines (already redacted) for the issue form */
  diagSummary(): Promise<string[]>;
  /** build the redacted zip (Downloads folder, or a Save As dialog); null when the user cancelled the dialog. Nothing is uploaded. */
  diagBuildZip(o: DiagZipOptions, saveAs: boolean): Promise<DiagZipResult | null>;
  /** show a saved zip in Finder / Explorer / the file manager */
  diagReveal(path: string): Promise<void>;
  /** delete a saved diagnostics zip */
  diagDeleteZip(path: string): Promise<void>;
  /** open the project's issue form or issue list in the browser (other addresses are refused) */
  diagOpenUrl(url: string): Promise<void>;
  /** which build is running: git commit ("-dirty" with uncommitted changes) and build time */
  buildInfo(): Promise<{ commit: string; time: string }>;
  /** the developer sound self-test folder ("" in a normal run) */
  audioSelfTestDir(): Promise<string>;
  /** developer live self-test script ("host:port|command|command"), "" in a normal run */
  audioSelfTestLive(): Promise<string>;
  /** ask the game to close the active context (the X of the console window); the game decides, nothing is hidden here */
  cmcpClose(session: string, reason: 'user' | 'client'): Promise<void>;
  /** mute or unmute one session's world (persisted on a saved world, else for this connection) */
  setWorldSoundMuted(session: string, muted: boolean): Promise<void>;
  /** what mutes a session: 'global', 'world' or '' */
  soundMuteState(session: string): Promise<'' | 'global' | 'world'>;
  cmcpViewport(session: string, widthPx: number, scale: number, monoPx: number): Promise<void>;
  /** A widget wrote a screen UI key ($ui.team). */
  cmcpSetUi(session: string, key: string, value: unknown): Promise<void>;
  /** A sprite of the current pack with the theme's tokens resolved (JSON text). */
  cmcpSprite(session: string, sprite: string): Promise<string>;
  /** Every open graphics scene as operations (for a window that mounts after a script ran). */
  gfxSnapshot(): Promise<GfxOp[]>;
  /** A pointer event on a graphics object; the script's handler runs. */
  gfxEvent(scene: string, id: string, event: string, x: number, y: number): Promise<void>;
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
    /** "squatterd" (default), "tf-squatterd", or "gtf" (stored as a tf-squatterd with flavor "gtf"). */
    kind?: SquatterKind | 'gtf',
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
  /** Rename a world record in TinyFugue (also while connected); a world of this app routed through it follows. */
  renameTFWorld(squatterId: string, name: string, newName: string): Promise<void>;
  /** Rename the world behind a TinyFugue connection (its tab) in TinyFugue; the tab and the local world follow. */
  renameTFSession(sessionId: string, newName: string): Promise<void>;
  /**
   * Rename any connection. A saved world is renamed with it, a connection through TinyFugue renames
   * TinyFugue's world record, a quick connect only changes the tab.
   */
  renameSession(sessionId: string, newName: string): Promise<void>;
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
  /** The key sequences TinyFugue scripts have bound. */
  tfKeyBindings(): Promise<string[]>;
  /** Run the script binding of one keystroke; text and cursor (a byte offset) are the input line as it is. */
  tfKey(sessionId: string, seq: string, text: string, cursor: number): Promise<TFKeyResult>;
  sendMsdp(sessionId: string, varsJson: string): Promise<void>;
  getSessionData(sessionId: string): Promise<SessionData>;
  /** Retry lost squatter links immediately (wake, window shown, network back); returns how many it is retrying. */
  nudgeSquatters(): Promise<number>;
  /** Set what kind of game a session is ("" or "auto" detects it again). */
  setGameType(sessionId: string, gameType: string): Promise<void>;
  /** Layout files (docs/LAYOUTS.md). `loadLayout` compiles; a layout nobody allowed comes back with `needsConsent`. */
  listLayouts(): Promise<LayoutInfo[]>;
  loadLayout(id: string): Promise<LayoutBundle>;
  allowLayout(id: string, hash: string, allow: boolean): Promise<void>;
  readLayout(id: string): Promise<string>;
  /** Saves a layout (it must compile) and allows it to run. */
  saveLayout(id: string, source: string): Promise<LayoutInfo>;
  deleteLayout(id: string): Promise<void>;
  layoutStarters(): Promise<LayoutStarter[]>;
  layoutsDir(): Promise<string>;
  /** Lua variables (squat.var), shared with layouts both ways. */
  luaVars(): Promise<Record<string, unknown>>;
  setLuaVar(name: string, value: unknown): Promise<void>;
  /** Loads the `<lua>` block of the layout in use (empty id or code unloads the previous one). */
  setLayoutLua(id: string, code: string): Promise<void>;
  /** The themes folder: `<id>.json` or `<id>/theme.json` per theme. */
  listThemes(): Promise<ThemeFile[]>;
  themesDir(): Promise<string>;
  saveTheme(id: string, json: string): Promise<void>;
  deleteTheme(id: string): Promise<void>;
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
  /** Platform facts for Help > Diagnostics (OS, build, paths). */
  diagnostics(): Promise<DiagReport>;
  /** Ask where to save a text file and write it; resolves to the path, or "" when cancelled. */
  saveTextFile(defaultName: string, text: string): Promise<string>;
  /** Put text on the system clipboard (the web view may refuse its own clipboard). */
  copyText(text: string): Promise<void>;
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
  /** Native folder dialog; resolves '' when cancelled. */
  pickFolder(title: string, start: string): Promise<string>;
  /** Show a folder in the system file manager. */
  openFolder(path: string): Promise<void>;
  /** Where TinyFugue files are right now (for Settings > Scripts). */
  scriptFolders(): Promise<ScriptFolders>;
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

/** internal/diag.Report (Go). */
export interface DiagReport {
  app: {
    version: string;
    commit: string;
    buildDate: string;
    buildType: string;
    engineVersion: string;
    swpVersion: number;
  };
  platform: {
    os: string;
    osName: string;
    osVersion: string;
    arch: string;
    goVersion: string;
    locale: string;
    timezone: string;
    numCPU: number;
    notes: string[] | null;
  };
  webview: { engine: string; version: string; note: string };
  paths: { config: string; data: string; logs: string };
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
  tfHideQueries: true,
  cmcp: true,
  consoleTheme: 'tng',
  useShipTheme: false,
  soundEra: '',
  soundFolder: '',
  soundVolume: 70,
  soundMuted: false,
  cmcpRoomScreens: false,
  cmcpStartCollapsed: false,
  cmcpPackConsent: 'always',
  cmcpAlertRecolour: 'theme',
  cmcpAlertPulse: 'theme',
  cmcpAlertAmbient: 'theme',
  cmcpHitShake: 'theme',
  cmcpTextLayout: 'auto',
  consoleThemeMode: 'ship',
  cmcpPortDefault: 'balanced',
  cmcpCalm: false,
};
