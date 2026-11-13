import { DEFAULT_SETTINGS } from './types';
import { GAME_TYPES } from '../lib/modules';
import type {
  ConnectTarget,
  EditAttrFlagResult,
  EditAttrLockResult,
  EditAttrOwnerResult,
  EditExamineResult,
  EditLinesResult,
  EditReplyResult,
  EditTestLockResult,
  EditAttrInfoResult,
  EditAttrResult,
  EditCatalogResult,
  EditControlsResult,
  EditDetailsResult,
  EditNearbyResult,
  EditObjectResult,
  EditResolveResult,
  EditResult,
  EditSearchResult,
  EngineAPI,
  EngineEventName,
  EngineEvents,
  FileResult,
  HistoryEntry,
  HistoryPage,
  HistoryQueryOpts,
  Line,
  LineKind,
  SearchHit,
  SessionInfo,
  Settings,
  SquatterConfig,
  Span,
  WorldConfig,
} from './types';
import { chatterLine, roomLines, sampleGroup } from './mock-samples';
import { MockGame } from './mock-game';

export interface MockOptions {
  /** Stream sample lines into connected sessions on a timer. */
  stream?: boolean;
  streamIntervalMs?: number;
  connectDelayMs?: number;
  /** "demo": seeded sessions incl. an ended one and unread backlog. "empty": nothing. */
  scenario?: 'demo' | 'empty';
}

/** Canned text the mock returns for any path it has not been given (see MockEngine.setFile). */
const MOCK_UPLOAD = '@@ demo upload\n&GREET me=Hello,\n  [name(%#)]\n\nthink uploaded\n';

const plain = (spans: Span[]): string => spans.map((s) => s.s).join('');

export const MOCK_FINGERPRINT = 'SHA256:3f:9a:1c:de:ad:be:ef:00:11:22:33:44:55:66:77:88';

type Listener = (p: never) => void;

/** Same rule as engine.MaskSecret: connect/create <name> <password> and @password lines. */
const SECRET_RES = [
  /^\s*(?:co|con|conn|conne|connec|connect|cr|cre|crea|creat|create)\s+(?:"[^"]*"|\S+)\s+\S/i,
  /^\s*@(?:pass|password|newpass|newpassword)\s+\S/i,
];
const hasSecret = (text: string): boolean =>
  text.split('\n').some((l) => SECRET_RES.some((re) => re.test(l.replace(/\r$/, ''))));

interface SessionData {
  info: SessionInfo;
  lines: Line[];
  acked: number;
  timer?: ReturnType<typeof setInterval>;
  tick: number;
  password?: boolean;
}

export class MockEngine implements EngineAPI {
  private listeners = new Map<string, Set<Listener>>();
  private worlds: WorldConfig[] = [];
  private squatters: SquatterConfig[] = [];
  private pending = new Map<string, SquatterConfig>();
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private sessions = new Map<string, SessionData>();
  private passwords = new Map<string, string>();
  private counter = 0;
  private opts: Required<MockOptions>;
  private fg = '';
  /** Every input sent, for tests and demos. */
  readonly sent: { session: string; text: string }[] = [];
  /** Per-world command history, oldest first (key: world id, else host:port). */
  private histories = new Map<string, { list: HistoryEntry[]; next: number }>();

  constructor(opts: MockOptions = {}) {
    this.opts = {
      stream: opts.stream ?? false,
      streamIntervalMs: opts.streamIntervalMs ?? 900,
      connectDelayMs: opts.connectDelayMs ?? 0,
      scenario: opts.scenario ?? 'demo',
    };
    this.worlds = [
      this.world('w-hogwarts', 'Hogwarts MUSH', 'mush.example.com', 4201, true, 'Fantasy'),
      this.world('w-moon', 'Moon Base Alpha', 'moon.example.org', 6250, false, 'Sci-Fi'),
      this.world('w-realm', 'Old Realm', 'realm.example.net', 4000, false, 'Fantasy'),
      this.world('w-login', 'Login Demo', 'login.example.net', 7000, true, 'Demo'),
    ];
    this.squatters = [
      {
        id: 'sq-home',
        name: 'Home server',
        host: 'squat.example.com',
        port: 7443,
        fingerprint: MOCK_FINGERPRINT,
        paired: true,
      },
    ];
    if (this.opts.scenario === 'demo') this.seedDemo();
  }

  private world(
    id: string,
    name: string,
    host: string,
    port: number,
    tls: boolean,
    group: string,
  ): WorldConfig {
    return {
      id,
      name,
      host,
      port,
      tls,
      tlsVerify: 'strict',
      encoding: 'utf-8',
      via: 'direct',
      group,
      login: { template: 'connect {name} {password}', charName: 'Guest', hasPassword: false },
    };
  }

  private seedDemo(): void {
    const now = Date.now();
    const a = this.makeSession(
      'w-hogwarts',
      'Hogwarts MUSH',
      'mush.example.com',
      4201,
      true,
      'connected',
      now - 3600_000,
    );
    this.preload(a, 300);
    a.acked = a.info.lastSeq; // foreground, caught up
    a.info.unread = 0;
    const b = this.makeSession(
      'w-moon',
      'Moon Base Alpha',
      'moon.example.org',
      6250,
      false,
      'connected',
      now - 7200_000,
    );
    this.preload(b, 40);
    b.acked = b.info.lastSeq - 12;
    this.refreshUnread(b);
    const c = this.makeSession(
      'w-realm',
      'Old Realm',
      'realm.example.net',
      4000,
      false,
      'connected',
      now - 9000_000,
    );
    this.preload(c, 25);
    c.acked = c.info.lastSeq - 25;
    this.appendLine(
      c,
      [{ s: 'The server is going down for maintenance. Back in 5 minutes.', fg: 11 }],
      'game',
      false,
      false,
    );
    this.appendLine(c, [{ s: 'Connection closed by foreign host.', fg: 1 }], 'system', false, false);
    this.refreshUnread(c);
    this.endData(c, 'remote_closed', 'EOF from server', now - 600_000);
    const d = this.makeSession(
      'w-login',
      'Login Demo',
      'login.example.net',
      7000,
      true,
      'connected',
      now - 1000,
    );
    this.appendLine(d, [{ s: 'Welcome to Login Demo!', fg: 11 }], 'game');
    this.appendLine(d, [{ s: 'Password: ' }], 'game', true);
    d.info.remoteEcho = true;
    d.password = true;
    this.fg = a.info.id;
    this.startStreams();
  }

  private preload(sd: SessionData, n: number): void {
    for (let i = 0; i < n; i++) {
      const g = sampleGroup(i);
      for (const spans of g) this.appendLine(sd, spans, 'game', false, false);
    }
  }

  private makeSession(
    worldId: string,
    name: string,
    host: string,
    port: number,
    tls: boolean,
    state: SessionInfo['state'],
    startedAt = Date.now(),
  ): SessionData {
    const id = `s-${(++this.counter).toString(16).padStart(6, '0')}`;
    const info: SessionInfo = {
      id,
      name,
      host,
      port,
      tls,
      state,
      startedAt,
      firstSeq: 0,
      lastSeq: 0,
      unread: 0,
      attached: 1,
      remoteEcho: false,
      via: this.worlds.find((w) => w.id === worldId)?.via ?? 'direct',
      ...(worldId ? { worldId } : {}),
      // the mock game is a PennMUSH-like one (what the Object Editor module is for)
      gameType: 'pennmush',
      gameFamily: 'mush',
      gameTypeSource: 'probe',
    };
    const sd: SessionData = { info, lines: [], acked: 0, tick: 0 };
    this.sessions.set(id, sd);
    return sd;
  }

  private startStreams(): void {
    if (!this.opts.stream) return;
    for (const sd of this.sessions.values()) this.startStream(sd);
  }

  private startStream(sd: SessionData): void {
    if (!this.opts.stream || sd.timer || sd.info.state !== 'connected' || sd.password) return;
    sd.timer = setInterval(() => {
      for (const spans of sampleGroup(sd.tick++)) this.appendLine(sd, spans, 'game');
    }, this.opts.streamIntervalMs);
  }

  private stopStream(sd: SessionData): void {
    if (sd.timer) clearInterval(sd.timer);
    sd.timer = undefined;
  }

  /** Stop all timers (tests / HMR). */
  dispose(): void {
    for (const sd of this.sessions.values()) this.stopStream(sd);
  }

  private refreshUnread(sd: SessionData): void {
    sd.info.unread = Math.max(0, sd.info.lastSeq - sd.acked);
  }

  private emit<E extends EngineEventName>(event: E, payload: EngineEvents[E]): void {
    const set = this.listeners.get(event);
    if (set) for (const cb of [...set]) (cb as (p: EngineEvents[E]) => void)(payload);
  }

  private snapshot(sd: SessionData): SessionInfo {
    return { ...sd.info };
  }

  private appendLine(sd: SessionData, spans: Span[], kind: LineKind, prompt = false, live = true): Line {
    const seq = sd.info.lastSeq + 1;
    const line: Line = {
      session: sd.info.id,
      seq,
      ts: Date.now(),
      kind,
      spans,
      ...(prompt ? { prompt: true as const } : {}),
    };
    sd.lines.push(line);
    sd.info.lastSeq = seq;
    if (sd.info.firstSeq === 0) sd.info.firstSeq = seq;
    if (kind === 'game') {
      const txt = plain(spans).trim();
      if (txt) sd.info.lastText = txt;
    }
    this.refreshUnread(sd);
    if (live) {
      this.emit('line', line);
      this.emit('session', this.snapshot(sd));
    }
    return line;
  }

  /** Test/demo hook: inject a game line into a session as if the server sent it. */
  pushLine(sessionId: string, spans: Span[], kind: LineKind = 'game'): Line {
    return this.appendLine(this.must(sessionId), spans, kind);
  }

  /** Test/demo hook: end a session. */
  endSession(sessionId: string, reason: string, detail?: string): void {
    this.endData(this.must(sessionId), reason, detail);
  }

  private endData(sd: SessionData, reason: string, detail?: string, at = Date.now()): void {
    this.stopStream(sd);
    sd.info.state = 'ended';
    sd.info.endedAt = at;
    sd.info.endReason = reason;
    if (detail) sd.info.endDetail = detail;
    sd.info.remoteEcho = false;
    sd.info.attached = 0;
    this.emit('session', this.snapshot(sd));
  }

  private must(id: string): SessionData {
    const sd = this.sessions.get(id);
    if (!sd) throw new Error(`no such session: ${id}`);
    return sd;
  }

  // ---- worlds + settings
  async listWorlds(): Promise<WorldConfig[]> {
    return this.worlds.map((w) => ({ ...w }));
  }
  async saveWorld(w: WorldConfig): Promise<WorldConfig> {
    const saved: WorldConfig = { ...w, id: w.id || `w-${++this.counter}` };
    if (saved.login)
      saved.login = { ...saved.login, hasPassword: saved.login.hasPassword || this.passwords.has(saved.id) };
    const i = this.worlds.findIndex((x) => x.id === saved.id);
    if (i >= 0) this.worlds[i] = saved;
    else this.worlds.push(saved);
    return { ...saved };
  }
  async deleteWorld(id: string): Promise<void> {
    this.worlds = this.worlds.filter((w) => w.id !== id);
    this.passwords.delete(id);
  }
  async setWorldPassword(id: string, password: string): Promise<void> {
    const w = this.worlds.find((x) => x.id === id);
    if (!w) throw new Error(`no such world: ${id}`);
    if (password) this.passwords.set(id, password);
    else this.passwords.delete(id);
    w.login = {
      template: w.login?.template ?? 'connect {name} {password}',
      ...w.login,
      hasPassword: !!password,
    };
  }
  async getSettings(): Promise<Settings> {
    return { ...this.settings };
  }
  async saveSettings(s: Settings): Promise<void> {
    this.settings = { ...s };
  }

  // ---- squatters
  async listSquatters(): Promise<SquatterConfig[]> {
    return this.squatters.map((s) => ({ ...s }));
  }
  async pairSquatter(
    host: string,
    port: number,
    name: string,
    pairCode: string,
  ): Promise<{ id: string; fingerprint: string }> {
    if (!pairCode.trim()) throw new Error('pair code required');
    const id = `sq-${++this.counter}`;
    this.pending.set(id, { id, name, host, port, fingerprint: MOCK_FINGERPRINT, paired: false });
    return { id, fingerprint: MOCK_FINGERPRINT };
  }
  async confirmSquatter(id: string, accept: boolean): Promise<void> {
    const p = this.pending.get(id);
    if (!p) throw new Error(`no pending squatter: ${id}`);
    this.pending.delete(id);
    if (accept) this.squatters.push({ ...p, paired: true });
  }
  async removeSquatter(id: string): Promise<void> {
    this.squatters = this.squatters.filter((s) => s.id !== id);
  }
  async reconnectSquatter(id: string): Promise<void> {
    if (!this.squatters.some((s) => s.id === id)) throw new Error(`no such squatter: ${id}`);
  }
  async nudgeSquatters(): Promise<number> {
    return 0;
  }
  async setSessionWorld(id: string, worldId: string): Promise<void> {
    const sd = this.sessions.get(id);
    if (!sd) throw new Error(`no such session: ${id}`);
    sd.info = { ...sd.info, ...(worldId ? { worldId } : {}) };
    this.emit('session', sd.info);
  }
  async setGameType(id: string, t: string): Promise<void> {
    const sd = this.sessions.get(id);
    if (!sd) throw new Error(`no such session: ${id}`);
    const auto = t === '' || t === 'auto';
    const family = GAME_TYPES.find((g) => g.type === t)?.family;
    sd.info = {
      ...sd.info,
      gameType: auto ? undefined : t,
      gameFamily: auto ? undefined : family,
      gameTypeSource: auto ? undefined : 'user',
    };
    this.emit('session', sd.info);
  }
  async suspend(): Promise<number> {
    this.emit('suspend', { suspended: true });
    return 0;
  }
  async resume(): Promise<void> {
    this.emit('suspend', { suspended: false });
  }
  async appVersion(): Promise<string> {
    return '0.0.0-mock';
  }
  async quit(): Promise<void> {
    /* nothing to quit in the mock */
  }

  // ---- sessions
  async connect(target: ConnectTarget): Promise<SessionInfo> {
    let sd: SessionData;
    if ('worldId' in target) {
      const w = this.worlds.find((x) => x.id === target.worldId);
      if (!w) throw new Error(`no such world: ${target.worldId}`);
      sd = this.makeSession(w.id, w.name, w.host, w.port, w.tls, 'connecting');
    } else {
      sd = this.makeSession(
        '',
        `${target.host}:${target.port}`,
        target.host,
        target.port,
        target.tls,
        'connecting',
      );
    }
    const info = this.snapshot(sd);
    const finish = (): void => {
      if (sd.info.state !== 'connecting') return;
      sd.info.state = 'connected';
      this.emit('session', this.snapshot(sd));
      this.appendLine(sd, [{ s: `Connected to ${sd.info.host}:${sd.info.port}.`, fg: 10 }], 'system');
      for (const l of roomLines) this.appendLine(sd, l, 'game');
      this.startStream(sd);
    };
    if (this.opts.connectDelayMs <= 0) queueMicrotask(finish);
    else setTimeout(finish, this.opts.connectDelayMs);
    this.emit('session', info);
    if (!this.fg) this.fg = sd.info.id;
    return info;
  }
  async disconnect(sessionId: string): Promise<void> {
    const sd = this.must(sessionId);
    if (sd.info.state === 'ended') return;
    this.appendLine(sd, [{ s: 'Disconnected.', fg: 3 }], 'system');
    this.endData(sd, 'client_quit');
  }
  async dismiss(sessionId: string): Promise<void> {
    const sd = this.must(sessionId);
    if (sd.info.state !== 'ended') throw new Error('session_not_ended');
    this.sessions.delete(sessionId);
    if (this.fg === sessionId) this.fg = '';
    this.emit('session-removed', { id: sessionId });
  }
  async listSessions(): Promise<SessionInfo[]> {
    return [...this.sessions.values()].map((s) => this.snapshot(s));
  }
  async foreground(sessionId: string): Promise<void> {
    this.must(sessionId);
    this.fg = sessionId;
  }

  // ---- I/O
  async input(sessionId: string, text: string): Promise<void> {
    const sd = this.must(sessionId);
    if (sd.info.state === 'ended') throw new Error('session_ended');
    this.sent.push({ session: sessionId, text });
    if (sd.password) {
      sd.password = false;
      sd.info.remoteEcho = false;
      this.emit('session', this.snapshot(sd));
      this.appendLine(sd, [{ s: 'Welcome back, Guest.', fg: 10 }], 'game');
      this.startStream(sd);
      return;
    }
    this.appendLine(sd, [{ s: text }], 'echo');
    if (text.trim() === '/quit') {
      this.emit('quit', {});
      return;
    }
    this.appendLine(sd, chatterLine(sd.tick++), 'game');
  }
  async resize(_sessionId: string, _cols: number, _rows: number): Promise<void> {
    return;
  }
  async scrollback(sessionId: string, opts: { beforeSeq?: number; limit: number }): Promise<Line[]> {
    const sd = this.must(sessionId);
    const before = opts.beforeSeq ?? Infinity;
    const eligible = sd.lines.filter((l) => l.seq < before);
    return eligible.slice(Math.max(0, eligible.length - opts.limit));
  }
  async search(
    sessionId: string,
    query: string,
    opts: { regex?: boolean; caseSensitive?: boolean },
  ): Promise<SearchHit[]> {
    const sd = this.must(sessionId);
    if (!query) return [];
    let test: (s: string) => boolean;
    if (opts.regex) {
      const re = new RegExp(query, opts.caseSensitive ? '' : 'i');
      test = (s) => re.test(s);
    } else {
      const q = opts.caseSensitive ? query : query.toLowerCase();
      test = (s) => (opts.caseSensitive ? s : s.toLowerCase()).includes(q);
    }
    return sd.lines
      .filter((l) => test(plain(l.spans)))
      .map((l) => ({ seq: l.seq, preview: plain(l.spans).slice(0, 200) }));
  }
  private histKey(sessionId: string): { key: string; sd: SessionData } {
    const sd = this.must(sessionId);
    const i = sd.info;
    return { key: i.worldId ? `w-${i.worldId}` : `h-${i.host.toLowerCase()}:${i.port}`, sd };
  }
  private hist(key: string): { list: HistoryEntry[]; next: number } {
    let h = this.histories.get(key);
    if (!h) this.histories.set(key, (h = { list: [], next: 1 }));
    return h;
  }
  async recordHistory(sessionId: string, text: string): Promise<void> {
    const { key, sd } = this.histKey(sessionId);
    if (sd.info.remoteEcho || hasSecret(text) || !text.trim()) return;
    const h = this.hist(key);
    if (h.list.at(-1)?.text === text) return;
    h.list.push({ id: h.next++, ts: Date.now(), text });
    const max = Math.min(1_000_000, Math.max(100, this.settings.historyMax || 100));
    if (h.list.length > max) h.list.splice(0, h.list.length - max);
  }
  async history(sessionId: string, query: string, opts: HistoryQueryOpts): Promise<HistoryPage> {
    const { key } = this.histKey(sessionId);
    let test: (s: string) => boolean = () => true;
    if (query && opts.regex) {
      let re: RegExp;
      try {
        re = new RegExp(query, opts.caseSensitive ? '' : 'i');
      } catch (e) {
        throw new Error(`invalid regular expression: ${e instanceof Error ? e.message : String(e)}`);
      }
      test = (s) => re.test(s);
    } else if (query) {
      const q = opts.caseSensitive ? query : query.toLowerCase();
      test = (s) => (opts.caseSensitive ? s : s.toLowerCase()).includes(q);
    }
    const all = this.hist(key)
      .list.filter((e) => test(e.text))
      .reverse();
    const off = Math.max(0, opts.offset ?? 0);
    const lim = opts.limit && opts.limit > 0 ? opts.limit : 50000;
    return { entries: all.slice(off, off + lim).map((e) => ({ ...e })), total: all.length };
  }
  async deleteHistory(sessionId: string, id: number): Promise<void> {
    const h = this.hist(this.histKey(sessionId).key);
    h.list = h.list.filter((e) => e.id !== id);
  }
  async clearHistory(sessionId: string): Promise<void> {
    this.hist(this.histKey(sessionId).key).list = [];
  }
  // ---- in-game editor (docs/EDIT.md): a fake game with objects, permissions and failure modes
  /** The fake game behind the Edit* calls: tweak latency, rejections, objects and concurrent changes in tests/demos. */
  readonly game = new MockGame();
  private editGate<T extends EditResult>(sessionId: string, rest: Omit<T, keyof EditResult>): T | null {
    const sd = this.sessions.get(sessionId);
    if (!sd) return { ...rest, ok: false, code: 'no_session', error: 'engine: no such session' } as T;
    if (sd.info.state === 'ended')
      return { ...rest, ok: false, code: 'session_ended', error: 'engine: the session has ended' } as T;
    return null;
  }
  async editFetchObject(sessionId: string, dbref: string): Promise<EditObjectResult> {
    return (
      this.editGate<EditObjectResult>(sessionId, {
        dbref,
        name: '',
        type: '',
        owner: '',
        flags: '',
        location: '',
        attrs: [],
      }) ?? this.game.fetchObject(dbref)
    );
  }
  async editFetchAttr(sessionId: string, dbref: string, attr: string): Promise<EditAttrResult> {
    return (
      this.editGate<EditAttrResult>(sessionId, {
        dbref,
        name: attr,
        exists: false,
        value: '',
        editable: '',
      }) ?? this.game.fetchAttr(dbref, attr)
    );
  }
  async editSaveAttr(sessionId: string, dbref: string, attr: string, value: string): Promise<EditResult> {
    return this.editGate<EditResult>(sessionId, {}) ?? this.game.saveAttr(dbref, attr, value);
  }
  async editResolve(sessionId: string, target: string): Promise<EditResolveResult> {
    return this.editGate<EditResolveResult>(sessionId, { dbref: '', name: '' }) ?? this.game.resolve(target);
  }
  async editControls(sessionId: string, dbref: string): Promise<EditControlsResult> {
    return this.editGate<EditControlsResult>(sessionId, { controls: 'unknown' }) ?? this.game.controls(dbref);
  }
  async editAttrInfo(sessionId: string, dbref: string, attr: string): Promise<EditAttrInfoResult> {
    return (
      this.editGate<EditAttrInfoResult>(sessionId, {
        known: false,
        flags: '',
        flagNames: '',
        owner: '',
        writable: 'unknown',
      }) ?? this.game.attrInfo(dbref, attr)
    );
  }
  // ---- object details (docs/EDIT.md section 11)
  async editDetails(sessionId: string, dbref: string): Promise<EditDetailsResult> {
    return this.editGate<EditDetailsResult>(sessionId, this.noDetails(dbref)) ?? this.game.details(dbref);
  }
  async editListFlags(sessionId: string): Promise<EditCatalogResult> {
    return this.editGate<EditCatalogResult>(sessionId, { known: false, items: [] }) ?? this.game.listFlags();
  }
  async editListPowers(sessionId: string): Promise<EditCatalogResult> {
    return this.editGate<EditCatalogResult>(sessionId, { known: false, items: [] }) ?? this.game.listPowers();
  }
  async editSetFlag(sessionId: string, dbref: string, flag: string, on: boolean): Promise<EditDetailsResult> {
    return (
      this.editGate<EditDetailsResult>(sessionId, this.noDetails(dbref)) ?? this.game.setFlag(dbref, flag, on)
    );
  }
  async editSetPower(
    sessionId: string,
    dbref: string,
    power: string,
    on: boolean,
  ): Promise<EditDetailsResult> {
    return (
      this.editGate<EditDetailsResult>(sessionId, this.noDetails(dbref)) ??
      this.game.setPower(dbref, power, on)
    );
  }
  async editSetAttrFlag(
    sessionId: string,
    dbref: string,
    attr: string,
    flag: string,
    on: boolean,
  ): Promise<EditAttrFlagResult> {
    return (
      this.editGate<EditAttrFlagResult>(sessionId, { reply: '', known: false, flags: '', flagNames: '' }) ??
      this.game.setAttrFlag(dbref, attr, flag, on)
    );
  }
  async editRename(sessionId: string, dbref: string, name: string): Promise<EditDetailsResult> {
    return (
      this.editGate<EditDetailsResult>(sessionId, this.noDetails(dbref)) ?? this.game.rename(dbref, name)
    );
  }
  async editChown(sessionId: string, dbref: string, owner: string): Promise<EditDetailsResult> {
    return (
      this.editGate<EditDetailsResult>(sessionId, this.noDetails(dbref)) ?? this.game.chown(dbref, owner)
    );
  }
  async editSetParent(sessionId: string, dbref: string, parent: string): Promise<EditDetailsResult> {
    return (
      this.editGate<EditDetailsResult>(sessionId, this.noDetails(dbref)) ?? this.game.setParent(dbref, parent)
    );
  }
  async editSetZone(sessionId: string, dbref: string, zone: string): Promise<EditDetailsResult> {
    return (
      this.editGate<EditDetailsResult>(sessionId, this.noDetails(dbref)) ?? this.game.setZone(dbref, zone)
    );
  }
  async editSetLock(
    sessionId: string,
    dbref: string,
    lockType: string,
    expr: string,
  ): Promise<EditDetailsResult> {
    return (
      this.editGate<EditDetailsResult>(sessionId, this.noDetails(dbref)) ??
      this.game.setLock(dbref, lockType, expr)
    );
  }
  async editSetHome(sessionId: string, dbref: string, room: string): Promise<EditDetailsResult> {
    return (
      this.editGate<EditDetailsResult>(sessionId, this.noDetails(dbref)) ?? this.game.setHome(dbref, room)
    );
  }
  async editSetDestination(sessionId: string, dbref: string, room: string): Promise<EditDetailsResult> {
    return (
      this.editGate<EditDetailsResult>(sessionId, this.noDetails(dbref)) ??
      this.game.setDestination(dbref, room)
    );
  }
  async editMove(sessionId: string, dbref: string, dest: string): Promise<EditDetailsResult> {
    return this.editGate<EditDetailsResult>(sessionId, this.noDetails(dbref)) ?? this.game.move(dbref, dest);
  }
  async editSetLockFlag(
    sessionId: string,
    dbref: string,
    t: string,
    flag: string,
    on: boolean,
  ): Promise<EditDetailsResult> {
    return (
      this.editGate<EditDetailsResult>(sessionId, this.noDetails(dbref)) ??
      this.game.setLockFlag(dbref, t, flag, on)
    );
  }
  async editTestLock(
    sessionId: string,
    dbref: string,
    t: string,
    target: string,
  ): Promise<EditTestLockResult> {
    return (
      this.editGate<EditTestLockResult>(sessionId, { result: 'unknown', raw: '' }) ??
      this.game.testLock(dbref, t, target)
    );
  }
  async editSetAttrLock(
    sessionId: string,
    dbref: string,
    attr: string,
    on: boolean,
  ): Promise<EditAttrLockResult> {
    return (
      this.editGate<EditAttrLockResult>(sessionId, { locked: 'unknown', reply: '' }) ??
      this.game.setAttrLock(dbref, attr, on)
    );
  }
  async editAttrChown(
    sessionId: string,
    dbref: string,
    attr: string,
    player: string,
  ): Promise<EditAttrOwnerResult> {
    return (
      this.editGate<EditAttrOwnerResult>(sessionId, { owner: '', reply: '' }) ??
      this.game.attrChown(dbref, attr, player)
    );
  }
  async editRenameAttr(sessionId: string, dbref: string, from: string, to: string): Promise<EditReplyResult> {
    return this.editGate<EditReplyResult>(sessionId, { reply: '' }) ?? this.game.renameAttr(dbref, from, to);
  }
  async editDeleteAttr(sessionId: string, dbref: string, attr: string): Promise<EditReplyResult> {
    return this.editGate<EditReplyResult>(sessionId, { reply: '' }) ?? this.game.deleteAttr(dbref, attr);
  }
  async editSetWarnings(sessionId: string, dbref: string, list: string): Promise<EditDetailsResult> {
    return (
      this.editGate<EditDetailsResult>(sessionId, this.noDetails(dbref)) ?? this.game.setWarnings(dbref, list)
    );
  }
  async editWCheck(sessionId: string, dbref: string): Promise<EditLinesResult> {
    return this.editGate<EditLinesResult>(sessionId, { lines: [] }) ?? this.game.wcheck(dbref);
  }
  async editExamine(sessionId: string, dbref: string, mode: string): Promise<EditExamineResult> {
    return this.editGate<EditExamineResult>(sessionId, { lines: [] }) ?? this.game.examine(dbref, mode);
  }
  async editSearchRooms(sessionId: string, query: string): Promise<EditSearchResult> {
    return (
      this.editGate<EditSearchResult>(sessionId, { items: [], restricted: false, truncated: false }) ??
      this.game.searchRooms(query)
    );
  }
  async editNearby(sessionId: string, dbref: string): Promise<EditNearbyResult> {
    return (
      this.editGate<EditNearbyResult>(sessionId, {
        room: { dbref: '', name: '', type: '', owner: '' },
        desc: '',
        exits: [],
        contents: [],
      }) ?? this.game.nearby(dbref)
    );
  }
  private noDetails(dbref: string): Omit<EditDetailsResult, keyof EditResult> {
    return {
      reply: '',
      details: {
        dbref,
        name: '',
        type: '',
        owner: '',
        parent: '',
        zone: '',
        location: '',
        home: '',
        destination: '',
        pennies: null,
        created: '',
        modified: '',
        flags: [],
        flagLetters: '',
        powers: [],
        locks: [],
        contents: [],
        exits: [],
        attrCount: -1,
        names: {},
        warnings: '',
        parentChain: [],
        extra: {},
      },
    };
  }
  /** What the next `pickFile` resolves with ('' = the user cancelled). Test/demo hook. */
  nextPick = '~/demo-script.mush';
  /** Files `readTextFile` knows (path -> text). Test/demo hook; see `setFile`. */
  private files = new Map<string, string>();
  setFile(path: string, text: string): void {
    this.files.set(path, text);
  }
  async pickFile(): Promise<string> {
    return this.nextPick;
  }
  async readTextFile(path: string): Promise<FileResult> {
    const p = path.trim();
    const name = p.split(/[\\/]/).pop() || p;
    const fail = (error: string): FileResult => ({
      ok: false,
      error,
      path: p,
      name,
      size: 0,
      encoding: '',
      text: '',
    });
    if (!p) return fail('no file given');
    if (!p.startsWith('/') && !p.startsWith('~/'))
      return fail(`use an absolute path (or ~/...): "${p}" is relative`);
    const text = this.files.get(p) ?? (/missing|nope/.test(p) ? null : MOCK_UPLOAD);
    if (text === null) return fail(`file not found: ${p}`);
    return { ok: true, path: p, name, size: new TextEncoder().encode(text).length, encoding: 'utf-8', text };
  }
  async ack(sessionId: string, seq: number): Promise<void> {
    const sd = this.must(sessionId);
    sd.acked = Math.max(sd.acked, seq);
    this.refreshUnread(sd);
    this.emit('session', this.snapshot(sd));
  }

  on<E extends EngineEventName>(event: E, cb: (payload: EngineEvents[E]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(cb as unknown as Listener);
    return () => set.delete(cb as unknown as Listener);
  }
}
