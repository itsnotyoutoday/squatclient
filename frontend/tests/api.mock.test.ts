import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockEngine } from '../src/api/mock';
import { DEFAULT_SETTINGS } from '../src/api/types';
import type { EngineAPI, EngineEvents, Line, SessionInfo, WorldConfig } from '../src/api/types';
import { createEngine } from '../src/api';

const engines: MockEngine[] = [];
const make = (o: ConstructorParameters<typeof MockEngine>[0] = {}): MockEngine => {
  const e = new MockEngine({ scenario: 'demo', ...o });
  engines.push(e);
  return e;
};
afterEach(() => engines.splice(0).forEach((e) => e.dispose()));

const API_METHODS: (keyof EngineAPI)[] = [
  'listWorlds',
  'saveWorld',
  'deleteWorld',
  'setWorldPassword',
  'getSettings',
  'saveSettings',
  'listSquatters',
  'pairSquatter',
  'confirmSquatter',
  'removeSquatter',
  'connect',
  'disconnect',
  'dismiss',
  'listSessions',
  'foreground',
  'input',
  'resize',
  'scrollback',
  'search',
  'ack',
  'on',
];

describe('MockEngine implements the EngineAPI contract', () => {
  it('has every method', () => {
    const e = make();
    for (const m of API_METHODS) expect(typeof e[m], m).toBe('function');
  });

  it('worlds: list / save (new + update) / delete / password', async () => {
    const e = make();
    const worlds = await e.listWorlds();
    expect(worlds.length).toBeGreaterThan(2);
    const w: WorldConfig = {
      id: '',
      name: 'New',
      host: 'h',
      port: 1,
      tls: false,
      tlsVerify: 'strict',
      encoding: 'utf-8',
      via: 'direct',
    };
    const saved = await e.saveWorld(w);
    expect(saved.id).not.toBe('');
    expect((await e.listWorlds()).some((x) => x.id === saved.id)).toBe(true);
    await e.saveWorld({ ...saved, name: 'Renamed' });
    expect((await e.listWorlds()).find((x) => x.id === saved.id)?.name).toBe('Renamed');
    await e.setWorldPassword(saved.id, 'secret');
    expect((await e.listWorlds()).find((x) => x.id === saved.id)?.login?.hasPassword).toBe(true);
    await e.deleteWorld(saved.id);
    expect((await e.listWorlds()).some((x) => x.id === saved.id)).toBe(false);
    await expect(e.setWorldPassword('nope', 'x')).rejects.toThrow();
  });

  it('settings round-trip', async () => {
    const e = make();
    expect(await e.getSettings()).toEqual(DEFAULT_SETTINGS);
    await e.saveSettings({ ...DEFAULT_SETTINGS, fontSize: 18, theme: 'light' });
    expect(await e.getSettings()).toMatchObject({ fontSize: 18, theme: 'light' });
  });

  it('squatters: pair -> fingerprint -> confirm accept/reject -> remove', async () => {
    const e = make();
    const before = (await e.listSquatters()).length;
    const p = await e.pairSquatter('h', 7443, 'Box', 'ABC-123');
    expect(p.fingerprint).toMatch(/^SHA256:/);
    expect((await e.listSquatters()).length).toBe(before);
    await e.confirmSquatter(p.id, true);
    const after = await e.listSquatters();
    expect(after.find((s) => s.id === p.id)).toMatchObject({ paired: true, name: 'Box' });
    await e.removeSquatter(p.id);
    expect((await e.listSquatters()).length).toBe(before);
    const q = await e.pairSquatter('h', 1, 'X', 'code');
    await e.confirmSquatter(q.id, false);
    expect((await e.listSquatters()).length).toBe(before);
    await expect(e.pairSquatter('h', 1, 'X', '')).rejects.toThrow();
    await expect(e.confirmSquatter('zzz', true)).rejects.toThrow();
  });

  it('sessions: connect by world and by host, states, events', async () => {
    const e = make();
    const events: SessionInfo[] = [];
    e.on('session', (s) => events.push({ ...s }));
    const s1 = await e.connect({ worldId: 'w-hogwarts' });
    expect(s1.state).toBe('connecting');
    await Promise.resolve();
    await Promise.resolve();
    expect((await e.listSessions()).find((s) => s.id === s1.id)?.state).toBe('connected');
    expect(events.some((s) => s.state === 'connected')).toBe(true);
    const s2 = await e.connect({ host: 'x.example', port: 23, tls: true });
    expect(s2).toMatchObject({ host: 'x.example', port: 23, tls: true });
    await expect(e.connect({ worldId: 'missing' })).rejects.toThrow();
  });

  it('demo scenario seeds away-state: unread, an ended session, a password prompt', async () => {
    const e = make();
    const list = await e.listSessions();
    expect(list.some((s) => s.state === 'ended' && s.endReason === 'remote_closed' && s.lastText)).toBe(true);
    expect(list.some((s) => s.unread > 0 && s.state === 'connected')).toBe(true);
    expect(list.some((s) => s.remoteEcho)).toBe(true);
  });

  it('input: echoes, replies, rejects ended sessions, clears remoteEcho after password', async () => {
    const e = make();
    const list = await e.listSessions();
    const live = list.find((s) => s.state === 'connected' && !s.remoteEcho) as SessionInfo;
    const got: Line[] = [];
    e.on('line', (l) => got.push(l));
    await e.input(live.id, 'look');
    expect(got[0]).toMatchObject({ kind: 'echo' });
    expect(got.length).toBeGreaterThan(1);
    expect(e.sent).toContainEqual({ session: live.id, text: 'look' });
    const ended = list.find((s) => s.state === 'ended') as SessionInfo;
    await expect(e.input(ended.id, 'x')).rejects.toThrow();
    const pw = list.find((s) => s.remoteEcho) as SessionInfo;
    await e.input(pw.id, 'hunter2');
    expect((await e.listSessions()).find((s) => s.id === pw.id)?.remoteEcho).toBe(false);
  });

  it('disconnect ends with client_quit; dismiss only works on ended sessions', async () => {
    const e = make();
    const list = await e.listSessions();
    const live = list.find((s) => s.state === 'connected') as SessionInfo;
    await expect(e.dismiss(live.id)).rejects.toThrow();
    await e.disconnect(live.id);
    const after = (await e.listSessions()).find((s) => s.id === live.id);
    expect(after).toMatchObject({ state: 'ended', endReason: 'client_quit' });
    await e.dismiss(live.id);
    expect((await e.listSessions()).some((s) => s.id === live.id)).toBe(false);
  });

  it('scrollback returns the most recent `limit` lines before beforeSeq', async () => {
    const e = make();
    const s = (await e.listSessions())[0];
    const last = await e.scrollback(s.id, { limit: 10 });
    expect(last).toHaveLength(10);
    expect(last[9].seq).toBe(s.lastSeq);
    const older = await e.scrollback(s.id, { beforeSeq: last[0].seq, limit: 5 });
    expect(older).toHaveLength(5);
    expect(older[4].seq).toBe(last[0].seq - 1);
    expect(older.every((l, i) => i === 0 || l.seq === older[i - 1].seq + 1)).toBe(true);
    expect(await e.scrollback(s.id, { beforeSeq: 1, limit: 5 })).toEqual([]);
  });

  it('search finds text (plain, regex, case)', async () => {
    const e = make();
    const s = (await e.listSessions())[0];
    const plain = await e.search(s.id, 'grand atrium', {});
    expect(plain.length).toBeGreaterThan(0);
    expect(await e.search(s.id, 'grand atrium', { caseSensitive: true })).toHaveLength(0);
    expect((await e.search(s.id, 'Atri.m', { regex: true })).length).toBe(plain.length);
    expect(await e.search(s.id, '', {})).toEqual([]);
  });

  it('ack lowers unread; foreground/resize resolve', async () => {
    const e = make();
    const s = (await e.listSessions()).find((x) => x.unread > 0 && x.state === 'connected') as SessionInfo;
    await e.ack(s.id, s.lastSeq);
    expect((await e.listSessions()).find((x) => x.id === s.id)?.unread).toBe(0);
    await e.foreground(s.id);
    await e.resize(s.id, 80, 24);
  });

  it('streams coloured lines on a timer when enabled', async () => {
    vi.useFakeTimers();
    try {
      const e = make({ stream: true, streamIntervalMs: 100 });
      const got: Line[] = [];
      e.on('line', (l) => got.push(l));
      vi.advanceTimersByTime(1000);
      expect(got.length).toBeGreaterThan(5);
      const all = got.flatMap((l) => l.spans);
      expect(all.some((s) => typeof s.fg === 'string' && s.fg.startsWith('#'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('delivers events to subscribers and supports unsubscribe', async () => {
    const e = make({ scenario: 'empty' });
    const seen: EngineEvents['notice'][] = [];
    const off = e.on('notice', (n) => seen.push(n));
    expect(typeof off).toBe('function');
    off();
    expect(seen).toEqual([]);
  });

  it('sample output covers every attribute, link, emoji/CJK and 256/truecolor', async () => {
    const e = make();
    const s = (await e.listSessions())[0];
    const lines = await e.scrollback(s.id, { limit: 500 });
    const spans = lines.flatMap((l) => l.spans);
    for (const k of ['b', 'dim', 'i', 'u', 'st', 'blink', 'rev', 'link'] as const)
      expect(
        spans.some((x) => x[k]),
        k,
      ).toBe(true);
    expect(spans.some((x) => typeof x.fg === 'number' && x.fg >= 0 && x.fg < 16)).toBe(true);
    expect(spans.some((x) => typeof x.bg === 'number' && x.bg >= 16)).toBe(true);
    expect(spans.some((x) => typeof x.fg === 'string')).toBe(true);
    const text = spans.map((x) => x.s).join('');
    expect(text).toMatch(/\p{Extended_Pictographic}/u);
    expect(text).toMatch(/[぀-ヿ一-鿿]/);
  });
});

describe('createEngine', () => {
  it('uses the mock without the Wails runtime and with ?mock=1', () => {
    expect(createEngine('')).toBeInstanceOf(MockEngine);
    expect(createEngine('?mock=1')).toBeInstanceOf(MockEngine);
  });
  it('uses WailsEngine when the runtime is present and not forced to mock', async () => {
    const w = window as unknown as Record<string, unknown>;
    const calls: unknown[][] = [];
    w.go = {
      main: {
        App: {
          Connect: (...a: unknown[]) => (calls.push(a), Promise.resolve({ id: 's' })),
          ListWorlds: () => Promise.resolve([]),
        },
      },
    };
    w.runtime = { EventsOn: () => () => undefined };
    try {
      const e = createEngine('');
      expect(e).not.toBeInstanceOf(MockEngine);
      await e.connect({ worldId: 'w' });
      expect(calls[0]).toEqual([{ worldId: 'w' }]);
      await expect(e.getSettings()).rejects.toThrow(/GetSettings/);
      expect(createEngine('?mock=1')).toBeInstanceOf(MockEngine);
    } finally {
      delete w.go;
      delete w.runtime;
    }
  });
});
