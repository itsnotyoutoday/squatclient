import type {
  ConnectTarget,
  EngineAPI,
  EngineEventName,
  EngineEvents,
  HistoryPage,
  HistoryQueryOpts,
  Settings,
  WorldConfig,
} from './types';

interface WailsApp {
  [method: string]: ((...args: unknown[]) => Promise<unknown>) | undefined;
}
interface WailsRuntime {
  EventsOn(event: string, cb: (...data: unknown[]) => void): () => void;
  BrowserOpenURL?(url: string): void;
}
interface WailsWindow {
  go?: { main?: { App?: WailsApp } };
  runtime?: WailsRuntime;
}

const w = (): WailsWindow => window as unknown as WailsWindow;

export function hasWails(): boolean {
  return !!(w().go?.main?.App && w().runtime?.EventsOn);
}

/** Open a URL externally through the Wails runtime when present, else window.open. */
export function openExternal(url: string): void {
  const rt = w().runtime;
  if (rt?.BrowserOpenURL) rt.BrowserOpenURL(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

/** Go marshals a nil slice as JSON null; the UI always wants a list. */
function list<T>(p: Promise<T[] | null | undefined>): Promise<T[]> {
  return p.then((v) => v ?? []);
}

function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const fn = w().go?.main?.App?.[method];
  if (!fn) return Promise.reject(new Error(`Wails binding App.${method} is not available`));
  return fn(...args) as Promise<T>;
}

/** EngineAPI backed by Wails-generated bindings (window.go.main.App.*) and runtime events. */
export class WailsEngine implements EngineAPI {
  listWorlds = () => list(call<WorldConfig[] | null>('ListWorlds'));
  saveWorld = (x: WorldConfig) => call<WorldConfig>('SaveWorld', x);
  deleteWorld = (id: string) => call<void>('DeleteWorld', id);
  setWorldPassword = (id: string, pw: string) => call<void>('SetWorldPassword', id, pw);
  getSettings = () => call<Settings>('GetSettings');
  saveSettings = (s: Settings) => call<void>('SaveSettings', s);
  listSquatters = () => list(call<Awaited<ReturnType<EngineAPI['listSquatters']>> | null>('ListSquatters'));
  pairSquatter = (host: string, port: number, name: string, code: string) =>
    call<{ id: string; fingerprint: string }>('PairSquatter', host, port, name, code);
  confirmSquatter = (id: string, accept: boolean) => call<void>('ConfirmSquatter', id, accept);
  removeSquatter = (id: string) => call<void>('RemoveSquatter', id);
  reconnectSquatter = (id: string) => call<void>('ReconnectSquatter', id);
  suspend = () => call<number>('Suspend');
  resume = () => call<void>('Resume');
  connect = (t: ConnectTarget) => call<Awaited<ReturnType<EngineAPI['connect']>>>('Connect', t);
  disconnect = (id: string) => call<void>('Disconnect', id);
  dismiss = (id: string) => call<void>('Dismiss', id);
  listSessions = () => list(call<Awaited<ReturnType<EngineAPI['listSessions']>> | null>('ListSessions'));
  foreground = (id: string) => call<void>('Foreground', id);
  input = (id: string, text: string) => call<void>('Input', id, text);
  resize = (id: string, cols: number, rows: number) => call<void>('Resize', id, cols, rows);
  scrollback = (id: string, opts: { beforeSeq?: number; limit: number }) =>
    list(call<Awaited<ReturnType<EngineAPI['scrollback']>> | null>('Scrollback', id, opts));
  search = (id: string, q: string, opts: { regex?: boolean; caseSensitive?: boolean }) =>
    list(call<Awaited<ReturnType<EngineAPI['search']>> | null>('Search', id, q, opts));
  ack = (id: string, seq: number) => call<void>('Ack', id, seq);
  recordHistory = (id: string, text: string) => call<void>('RecordHistory', id, text);
  history = (id: string, q: string, opts: HistoryQueryOpts) =>
    call<HistoryPage | null>('History', id, q, opts).then((p) => ({
      entries: p?.entries ?? [],
      total: p?.total ?? 0,
    }));
  deleteHistory = (id: string, entryId: number) => call<void>('DeleteHistory', id, entryId);
  clearHistory = (id: string) => call<void>('ClearHistory', id);

  on<E extends EngineEventName>(event: E, cb: (payload: EngineEvents[E]) => void): () => void {
    const rt = w().runtime;
    if (!rt) return () => undefined;
    return rt.EventsOn(event, (...data: unknown[]) => cb(data[0] as EngineEvents[E]));
  }
}
