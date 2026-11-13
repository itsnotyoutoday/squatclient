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
  EditDetails,
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

/** Calls an Edit* binding; a rejected promise becomes `{ok:false, code:'error'}` merged over `empty`. */
function editCall<T extends EditResult>(
  method: string,
  empty: Omit<T, keyof EditResult>,
  ...args: unknown[]
): Promise<T> {
  return call<T>(method, ...args).catch(
    (e: unknown) =>
      ({ ...empty, ok: false, code: 'error', error: e instanceof Error ? e.message : String(e) }) as T,
  );
}

const emptyDetails = (dbref: string): EditDetails => ({
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
});

/** Go encodes nil slices as null in some paths: make every list an array. */
function normDetails(r: EditDetailsResult): EditDetailsResult {
  const d = { ...emptyDetails(r.details?.dbref ?? ''), ...(r.details ?? {}) };
  d.flags ??= [];
  d.powers ??= [];
  d.locks ??= [];
  d.contents ??= [];
  d.exits ??= [];
  d.names ??= {};
  d.parentChain ??= [];
  d.extra ??= {};
  d.locks = d.locks.map((l) => ({ ...l, flags: l.flags ?? [] }));
  return { ...r, reply: r.reply ?? '', details: d };
}
const normCatalog = (r: EditCatalogResult): EditCatalogResult => ({ ...r, items: r.items ?? [] });

const mut = (method: string, dbref: string, ...args: unknown[]): Promise<EditDetailsResult> =>
  editCall<EditDetailsResult>(method, { reply: '', details: emptyDetails(dbref) }, ...args).then(normDetails);

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
  nudgeSquatters = () => call<number>('NudgeSquatters');
  setGameType = (id: string, t: string) => call<void>('SetGameType', id, t);
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
  // The Edit* calls never reject on game errors, but a missing binding or a transport failure
  // must still become a result value so the editor can show it.
  editFetchObject = (id: string, dbref: string) =>
    editCall<EditObjectResult>(
      'EditFetchObject',
      { dbref, name: '', type: '', owner: '', flags: '', location: '', attrs: [] },
      id,
      dbref,
    ).then((r) => ({ ...r, attrs: r.attrs ?? [] }));
  editFetchAttr = (id: string, dbref: string, attr: string) =>
    editCall<EditAttrResult>(
      'EditFetchAttr',
      { dbref, name: attr, exists: false, value: '', editable: '' },
      id,
      dbref,
      attr,
    );
  editSaveAttr = (id: string, dbref: string, attr: string, value: string) =>
    editCall<EditResult>('EditSaveAttr', {}, id, dbref, attr, value);
  editResolve = (id: string, target: string) =>
    editCall<EditResolveResult>('EditResolve', { dbref: '', name: '' }, id, target);
  editControls = (id: string, dbref: string) =>
    editCall<EditControlsResult>('EditControls', { controls: 'unknown' }, id, dbref);
  editAttrInfo = (id: string, dbref: string, attr: string) =>
    editCall<EditAttrInfoResult>(
      'EditAttrInfo',
      { known: false, flags: '', flagNames: '', owner: '', writable: 'unknown' },
      id,
      dbref,
      attr,
    );
  // ---- object details (docs/EDIT.md section 11)
  editDetails = (id: string, dbref: string) =>
    editCall<EditDetailsResult>('EditDetails', { reply: '', details: emptyDetails(dbref) }, id, dbref).then(
      normDetails,
    );
  editListFlags = (id: string) =>
    editCall<EditCatalogResult>('EditListFlags', { known: false, items: [] }, id).then(normCatalog);
  editListPowers = (id: string) =>
    editCall<EditCatalogResult>('EditListPowers', { known: false, items: [] }, id).then(normCatalog);
  editSetFlag = (id: string, dbref: string, flag: string, on: boolean) =>
    mut('EditSetFlag', dbref, id, dbref, flag, on);
  editSetPower = (id: string, dbref: string, power: string, on: boolean) =>
    mut('EditSetPower', dbref, id, dbref, power, on);
  editSetAttrFlag = (id: string, dbref: string, attr: string, flag: string, on: boolean) =>
    editCall<EditAttrFlagResult>(
      'EditSetAttrFlag',
      { reply: '', known: false, flags: '', flagNames: '' },
      id,
      dbref,
      attr,
      flag,
      on,
    );
  editRename = (id: string, dbref: string, name: string) => mut('EditRename', dbref, id, dbref, name);
  editChown = (id: string, dbref: string, owner: string) => mut('EditChown', dbref, id, dbref, owner);
  editSetParent = (id: string, dbref: string, parent: string) =>
    mut('EditSetParent', dbref, id, dbref, parent);
  editSetZone = (id: string, dbref: string, zone: string) => mut('EditSetZone', dbref, id, dbref, zone);
  editSetLock = (id: string, dbref: string, lockType: string, expr: string) =>
    mut('EditSetLock', dbref, id, dbref, lockType, expr);
  editSetHome = (id: string, dbref: string, room: string) => mut('EditSetHome', dbref, id, dbref, room);
  editSetDestination = (id: string, dbref: string, room: string) =>
    mut('EditSetDestination', dbref, id, dbref, room);
  editMove = (id: string, dbref: string, dest: string) => mut('EditMove', dbref, id, dbref, dest);
  editSetLockFlag = (id: string, dbref: string, lockType: string, flag: string, on: boolean) =>
    mut('EditSetLockFlag', dbref, id, dbref, lockType, flag, on);
  editTestLock = (id: string, dbref: string, lockType: string, target: string) =>
    editCall<EditTestLockResult>('EditTestLock', { result: 'unknown', raw: '' }, id, dbref, lockType, target);
  editSetAttrLock = (id: string, dbref: string, attr: string, on: boolean) =>
    editCall<EditAttrLockResult>('EditSetAttrLock', { locked: 'unknown', reply: '' }, id, dbref, attr, on);
  editAttrChown = (id: string, dbref: string, attr: string, player: string) =>
    editCall<EditAttrOwnerResult>('EditAttrChown', { owner: '', reply: '' }, id, dbref, attr, player);
  editRenameAttr = (id: string, dbref: string, from: string, to: string) =>
    editCall<EditReplyResult>('EditRenameAttr', { reply: '' }, id, dbref, from, to);
  editDeleteAttr = (id: string, dbref: string, attr: string) =>
    editCall<EditReplyResult>('EditDeleteAttr', { reply: '' }, id, dbref, attr);
  editSetWarnings = (id: string, dbref: string, list: string) =>
    mut('EditSetWarnings', dbref, id, dbref, list);
  editWCheck = (id: string, dbref: string) =>
    editCall<EditLinesResult>('EditWCheck', { lines: [] }, id, dbref).then((r) => ({
      ...r,
      lines: r.lines ?? [],
    }));
  editExamine = (id: string, dbref: string, mode: string) =>
    editCall<EditExamineResult>('EditExamine', { lines: [] }, id, dbref, mode).then((r) => ({
      ...r,
      lines: r.lines ?? [],
    }));
  editSearchRooms = (id: string, query: string) =>
    editCall<EditSearchResult>(
      'EditSearchRooms',
      { items: [], restricted: false, truncated: false },
      id,
      query,
    ).then((r) => ({ ...r, items: r.items ?? [] }));
  editNearby = (id: string, dbref: string) =>
    editCall<EditNearbyResult>(
      'EditNearby',
      { room: { dbref: '', name: '', type: '', owner: '' }, desc: '', exits: [], contents: [] },
      id,
      dbref,
    ).then((r) => ({ ...r, exits: r.exits ?? [], contents: r.contents ?? [] }));
  pickFile = (title: string) => call<string>('PickFile', title).then((p) => p ?? '');
  readTextFile = (path: string) => call<FileResult>('ReadTextFile', path);

  on<E extends EngineEventName>(event: E, cb: (payload: EngineEvents[E]) => void): () => void {
    const rt = w().runtime;
    if (!rt) return () => undefined;
    return rt.EventsOn(event, (...data: unknown[]) => cb(data[0] as EngineEvents[E]));
  }
}
