import type { EngineAPI, Line, SessionInfo } from '../api/types';
import { getBuffer, dropBuffer, setBufferCap, useSessions, useSettings, useUi } from './stores';

/** Sessions that need attention when the UI attaches: unread output or ended. */
export function awaySessions(list: readonly SessionInfo[]): SessionInfo[] {
  return list.filter((s) => s.unread > 0 || s.state === 'ended');
}

export interface Controller {
  dispose(): void;
  /** Flush batched lines now (tests). */
  flush(): void;
  switchTo(id: string): void;
  dismiss(id: string): Promise<void>;
  loadOlder(id: string, limit?: number): Promise<number>;
}

const INITIAL_LOAD = 2000;

/**
 * Wires an EngineAPI to the stores: loads settings/worlds/sessions, subscribes to engine events,
 * batches `line` events per animation frame, and acks what the user is looking at.
 */
export async function startController(
  engine: EngineAPI,
  opts: { raf?: (cb: () => void) => void } = {},
): Promise<Controller> {
  const raf = opts.raf ?? ((cb: () => void): void => void requestAnimationFrame(() => cb()));
  const ui = useUi.getState();
  ui.setEngine(engine);

  let disposed = false;
  let pending = new Map<string, Line[]>();
  let scheduled = false;
  const ackTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const ackLater = (id: string): void => {
    if (ackTimers.has(id)) return;
    ackTimers.set(
      id,
      setTimeout(() => {
        ackTimers.delete(id);
        const p = useSessions.getState().paused[id];
        if (disposed || p?.paused || useSessions.getState().fg !== id) return;
        const seq = Math.floor(getBuffer(id).last);
        if (seq > 0) void engine.ack(id, seq).catch(() => undefined);
      }, 250),
    );
  };

  const flush = (): void => {
    scheduled = false;
    if (pending.size === 0) return;
    const batch = pending;
    pending = new Map();
    const changed: string[] = [];
    for (const [id, lines] of batch) {
      if (getBuffer(id).merge(lines) > 0) changed.push(id);
    }
    if (changed.length) {
      useSessions.getState().bump(changed);
      const fg = useSessions.getState().fg;
      if (fg && changed.includes(fg)) ackLater(fg);
    }
  };

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    raf(flush);
  };

  const offs: (() => void)[] = [];
  offs.push(
    engine.on('line', (l) => {
      const arr = pending.get(l.session);
      if (arr) arr.push(l);
      else pending.set(l.session, [l]);
      schedule();
    }),
    engine.on('session', (info) => {
      useSessions.getState().upsert(info);
    }),
    engine.on('status', (p) => useSessions.getState().setStatus(p.session, p.fields)),
    engine.on('notice', (n) => {
      const target = n.session ?? useSessions.getState().fg;
      if (target && useSessions.getState().sessions[target]) {
        const b = getBuffer(target);
        b.addLocal(target, n.text);
        useSessions.getState().bump([target]);
      }
      if (n.level !== 'info' || !target) useUi.getState().toast(n.level, n.text);
    }),
    engine.on('bell', (b) => {
      const s = useSessions.getState();
      if (!useSettings.getState().settings.notifications || b.session === s.fg) return;
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(s.sessions[b.session]?.name ?? 'SquatClient', { body: 'Bell' });
        }
      } catch {
        /* notifications unavailable */
      }
    }),
  );

  const [settings, worlds, squatters, sessions] = await Promise.all([
    engine.getSettings(),
    engine.listWorlds(),
    engine.listSquatters(),
    engine.listSessions(),
  ]);
  useSettings.getState().set(settings);
  setBufferCap(settings.scrollbackLines);
  ui.setWorlds(worlds);
  ui.setSquatters(squatters);
  useSessions.getState().setAll(sessions);

  const away = awaySessions(sessions);
  const connected = sessions.find((s) => s.state === 'connected') ?? sessions[0];
  const fg = connected?.id ?? null;
  useSessions.getState().setFg(fg);
  if (fg) void engine.foreground(fg).catch(() => undefined);

  await Promise.all(
    sessions.map(async (s) => {
      const lines = await engine.scrollback(s.id, {
        limit: Math.min(INITIAL_LOAD, settings.scrollbackLines),
      });
      const b = getBuffer(s.id);
      b.merge(lines);
      if (lines.length < Math.min(INITIAL_LOAD, settings.scrollbackLines)) b.exhausted = true;
    }),
  );
  useSessions.getState().bump(sessions.map((s) => s.id));
  if (away.length) {
    useUi.getState().setAway(away.map((s) => s.id));
    useUi.getState().openDialog('away');
  }
  if (fg) ackLater(fg);

  const controller: Controller = {
    dispose() {
      disposed = true;
      offs.forEach((o) => o());
      ackTimers.forEach((t) => clearTimeout(t));
    },
    flush,
    switchTo(id) {
      const s = useSessions.getState();
      if (!s.sessions[id]) return;
      s.setFg(id);
      void engine.foreground(id).catch(() => undefined);
      if (!s.paused[id]?.paused) ackLater(id);
    },
    async dismiss(id) {
      await engine.dismiss(id);
      dropBuffer(id);
      useSessions.getState().remove(id);
      const fgNow = useSessions.getState().fg;
      if (fgNow) void engine.foreground(fgNow).catch(() => undefined);
    },
    async loadOlder(id, limit = 1000) {
      const b = getBuffer(id);
      if (b.exhausted || b.first <= 1) {
        b.exhausted = true;
        return 0;
      }
      const lines = await engine.scrollback(id, { beforeSeq: Math.ceil(b.first), limit });
      const added = b.merge(lines);
      if (lines.length < limit) b.exhausted = true;
      if (added) useSessions.getState().bump([id]);
      return added;
    },
  };
  return controller;
}
