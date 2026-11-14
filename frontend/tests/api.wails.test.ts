import { afterEach, describe, expect, it, vi } from 'vitest';
import { WailsEngine, hasWails } from '../src/api/wails';

type Fn = (...a: unknown[]) => Promise<unknown>;

function install(app: Record<string, Fn>, handlers: Map<string, (...d: unknown[]) => void>): void {
  (window as unknown as Record<string, unknown>).go = { main: { App: app } };
  (window as unknown as Record<string, unknown>).runtime = {
    EventsOn: (name: string, cb: (...d: unknown[]) => void) => {
      handlers.set(name, cb);
      return () => handlers.delete(name);
    },
  };
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).go;
  delete (window as unknown as Record<string, unknown>).runtime;
});

describe('WailsEngine adapter', () => {
  it('detects the Wails runtime', () => {
    expect(hasWails()).toBe(false);
    install({}, new Map());
    expect(hasWails()).toBe(true);
  });

  it('calls window.go.main.App.<Name> with positional arguments (UI-CONTRACT-NOTES 4)', async () => {
    const calls: [string, unknown[]][] = [];
    const app = new Proxy({} as Record<string, Fn>, {
      get:
        (_t, name: string) =>
        (...a: unknown[]) => {
          calls.push([name, a]);
          return Promise.resolve(undefined);
        },
    });
    install(app, new Map());
    const e = new WailsEngine();
    await e.connect({ worldId: 'w' });
    await e.input('s1', 'look');
    await e.resize('s1', 80, 24);
    await e.scrollback('s1', { beforeSeq: 9, limit: 50 });
    await e.search('s1', 'x', { regex: true });
    await e.ack('s1', 7);
    await e.recordHistory('s1', 'x');
    await e.history('s1', 'q', { regex: true, limit: 5 });
    await e.deleteHistory('s1', 3);
    await e.clearHistory('s1');
    await e.dismiss('s1');
    await e.reconnectSquatter('sq1');
    await e.pairSquatter('h', 10328, 'n', 'code', 'tf-squatterd');
    await e.pairSquatter('h', 10327, 'n', 'code');
    await e.setControl('s1', 'input', 'remote');
    await e.controlPreset('s1', 'copilot');
    await e.putTFWorld('sq1', { name: 'a', host: 'h', port: '1' });
    await e.sendGmcp('s1', 'Core.Hello', '{}');
    await e.suspend();
    await e.resume();
    expect(calls).toEqual([
      ['Connect', [{ worldId: 'w' }]],
      ['Input', ['s1', 'look']],
      ['Resize', ['s1', 80, 24]],
      ['Scrollback', ['s1', { beforeSeq: 9, limit: 50 }]],
      ['Search', ['s1', 'x', { regex: true }]],
      ['Ack', ['s1', 7]],
      ['RecordHistory', ['s1', 'x']],
      ['History', ['s1', 'q', { regex: true, limit: 5 }]],
      ['DeleteHistory', ['s1', 3]],
      ['ClearHistory', ['s1']],
      ['Dismiss', ['s1']],
      ['ReconnectSquatter', ['sq1']],
      ['PairSquatter', ['h', 10328, 'n', 'code', 'tf-squatterd']],
      ['PairSquatter', ['h', 10327, 'n', 'code', '']], // "" = squatterd: the Go side defaults it
      ['SetControl', ['s1', 'input', 'remote']],
      ['ControlPreset', ['s1', 'copilot']],
      ['PutTFWorld', ['sq1', { name: 'a', host: 'h', port: '1' }]],
      ['SendGmcp', ['s1', 'Core.Hello', '{}']],
      ['Suspend', []],
      ['Resume', []],
    ]);
  });

  it('rejects when a binding is missing', async () => {
    install({}, new Map());
    await expect(new WailsEngine().listWorlds()).rejects.toThrow(/ListWorlds/);
  });

  it('delivers runtime events (including the Go-side additions) to subscribers', () => {
    const handlers = new Map<string, (...d: unknown[]) => void>();
    install({}, handlers);
    const e = new WailsEngine();
    const seen: unknown[] = [];
    for (const name of ['line', 'session', 'session-removed', 'foreground', 'reset', 'menu'] as const) {
      e.on(name, (p) => seen.push([name, p]));
    }
    handlers.get('session-removed')?.({ id: 's2' });
    handlers.get('menu')?.({ action: 'settings' });
    expect(seen).toEqual([
      ['session-removed', { id: 's2' }],
      ['menu', { action: 'settings' }],
    ]);
    vi.restoreAllMocks();
  });
});
