import { create } from 'zustand';
import type {
  EditCatalogItem,
  EditCode,
  EditDetails,
  EditDetailsResult,
  EditPlace,
  EngineAPI,
} from '../api/types';
import { worldKey } from '../lib/worldkey';
import { loadRecent, pushRecent } from '../lib/editor/props';
import { announce, describeFailure, gameText, getObject, setAttrFlags, syncHeader } from './editorStore';
import { useSessions, useUi } from './stores';

/**
 * State of the Object details view (docs/EDIT-WORKSPACE.md section 9). Everything goes through the engine's
 * silent Edit* calls: the game's replies end up here (status strip, inline errors), never in the terminal
 * output or the command history. A control shows a spinner while its call runs, then the verified state;
 * a refused change shows the game's exact reply and the unchanged state.
 */

export interface DetailsFailure {
  /** a sentence for the user */
  text: string;
  /** the game's exact reply, when it gave one */
  reply: string;
  code?: EditCode;
}

export interface DetailsStatus {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

export interface DetailsEntry {
  data?: EditDetails;
  loading: boolean;
  /** the details could not be read at all */
  error?: string;
  errorCode?: EditCode;
  /** controls with a call in flight, by key (`flag:DARK`, `rename`, `lock:Basic`, ...) */
  busy: Record<string, boolean>;
  /** inline errors by control key */
  failed: Record<string, DetailsFailure>;
  status?: DetailsStatus;
}

export interface CatalogState {
  state: 'idle' | 'loading' | 'ready' | 'error';
  /** false: the game could not list them (the UI accepts typed names) */
  known: boolean;
  items: EditCatalogItem[];
  error?: string;
}

export type PlaceMode = 'move' | 'home' | 'destination';

export interface DetailsState {
  entries: Record<string, DetailsEntry>;
  flags: Record<string, CatalogState>;
  powers: Record<string, CatalogState>;
  /** the Move / Set home / Set destination dialog */
  place: { sid: string; dbref: string; mode: PlaceMode } | null;
  /** the owner / parent / zone picker */
  pick: { sid: string; dbref: string; field: 'owner' | 'parent' | 'zone' } | null;
  /** the attribute flags dialog */
  attrFlags: { sid: string; dbref: string; attr: string } | null;
}

export const useDetails = create<DetailsState>(() => ({
  entries: {},
  flags: {},
  powers: {},
  place: null,
  pick: null,
  attrFlags: null,
}));

export const detailsKey = (sid: string, dbref: string): string => `${sid}|${dbref}`;
export const getEntry = (sid: string, dbref: string): DetailsEntry | undefined =>
  useDetails.getState().entries[detailsKey(sid, dbref)];

const engine = (): EngineAPI | null => useUi.getState().engine;
const blank = (): DetailsEntry => ({ loading: false, busy: {}, failed: {} });

function patchEntry(sid: string, dbref: string, fn: (e: DetailsEntry) => DetailsEntry): void {
  const k = detailsKey(sid, dbref);
  useDetails.setState((s) => ({ entries: { ...s.entries, [k]: fn(s.entries[k] ?? blank()) } }));
}

let statusId = 0;
const status = (kind: 'ok' | 'error', text: string): DetailsStatus => ({ id: ++statusId, kind, text });

/** A sentence for a refused or failed change. */
export function describeMutation(r: {
  ok: boolean;
  error?: string;
  code?: EditCode;
  reply?: string;
}): string {
  const t = r.reply || gameText(r.error);
  switch (r.code) {
    case 'permission':
      return `Not allowed: ${t}`;
    case 'timeout':
      return 'The game did not answer in time. Check the current state and try again.';
    case 'no_session':
    case 'session_ended':
      return 'This world is not connected.';
    case 'mismatch':
      return `The game did not apply the change: ${t}`;
    case 'invalid':
      return t;
    default:
      return t || 'The game refused the change.';
  }
}

/** Read the details of an object (`quiet`: keep showing the current ones while reloading). */
export async function loadDetails(sid: string, dbref: string): Promise<void> {
  const eng = engine();
  if (!eng) return;
  patchEntry(sid, dbref, (e) => ({ ...e, loading: true, error: undefined, errorCode: undefined }));
  const r = await eng.editDetails(sid, dbref);
  if (r.ok) {
    patchEntry(sid, dbref, (e) => ({ ...e, loading: false, data: r.details }));
    syncFromDetails(sid, dbref, r.details);
  } else {
    patchEntry(sid, dbref, (e) => ({
      ...e,
      loading: false,
      error: describeFailure(r, dbref),
      errorCode: r.code,
    }));
  }
}

function syncFromDetails(sid: string, dbref: string, d: EditDetails): void {
  if (d.name) syncHeader(sid, dbref, { name: d.name, owner: d.owner, type: d.type, flags: d.flagLetters });
}

/**
 * Run one change. The control keyed `key` shows a spinner; on success the verified state replaces the
 * details and the game's reply goes to the status strip; on refusal the inline error carries the exact reply
 * and the state is the re-read (unchanged) one.
 */
export async function runChange(
  sid: string,
  dbref: string,
  key: string,
  label: string,
  call: (eng: EngineAPI) => Promise<EditDetailsResult>,
): Promise<boolean> {
  const eng = engine();
  if (!eng) return false;
  patchEntry(sid, dbref, (e) => {
    const { [key]: _gone, ...failed } = e.failed;
    void _gone;
    return { ...e, busy: { ...e.busy, [key]: true }, failed };
  });
  const r = await call(eng);
  const reread = r.details && r.details.name ? r.details : undefined;
  if (r.ok) {
    patchEntry(sid, dbref, (e) => ({
      ...e,
      busy: omit(e.busy, key),
      data: reread ?? e.data,
      status: status('ok', r.reply ? `${label}: ${r.reply}` : `${label}: done.`),
    }));
    if (reread) syncFromDetails(sid, dbref, reread);
    announce(r.reply ? `${label}: ${r.reply}` : `${label}: done.`);
    return true;
  }
  const text = describeMutation(r);
  patchEntry(sid, dbref, (e) => ({
    ...e,
    busy: omit(e.busy, key),
    data: reread ?? e.data,
    failed: { ...e.failed, [key]: { text, reply: r.reply || gameText(r.error), code: r.code } },
    status: status('error', `${label}: ${text}`),
  }));
  announce(`${label} failed. ${text}`, true);
  return false;
}

function omit(m: Record<string, boolean>, k: string): Record<string, boolean> {
  const { [k]: _x, ...rest } = m;
  void _x;
  return rest;
}

export function clearFailure(sid: string, dbref: string, key: string): void {
  patchEntry(sid, dbref, (e) => {
    const { [key]: _x, ...failed } = e.failed;
    void _x;
    return { ...e, failed };
  });
}

// ---------------------------------------------------------------- the individual changes

export const setFlag = (sid: string, dbref: string, flag: string, on: boolean): Promise<boolean> =>
  runChange(sid, dbref, `flag:${flag.toUpperCase()}`, `${on ? 'Set' : 'Clear'} ${flag.toUpperCase()}`, (e) =>
    e.editSetFlag(sid, dbref, flag, on),
  );
export const setPower = (sid: string, dbref: string, power: string, on: boolean): Promise<boolean> =>
  runChange(
    sid,
    dbref,
    `power:${power.toUpperCase()}`,
    `${on ? 'Grant' : 'Remove'} ${power.toUpperCase()}`,
    (e) => e.editSetPower(sid, dbref, power, on),
  );
export const rename = (sid: string, dbref: string, name: string): Promise<boolean> =>
  runChange(sid, dbref, 'rename', 'Rename', (e) => e.editRename(sid, dbref, name));
export const chown = (sid: string, dbref: string, owner: string): Promise<boolean> =>
  runChange(sid, dbref, 'owner', 'Change owner', (e) => e.editChown(sid, dbref, owner));
export const setParent = (sid: string, dbref: string, parent: string): Promise<boolean> =>
  runChange(sid, dbref, 'parent', parent ? 'Change parent' : 'Clear parent', (e) =>
    e.editSetParent(sid, dbref, parent),
  );
export const setZone = (sid: string, dbref: string, zone: string): Promise<boolean> =>
  runChange(sid, dbref, 'zone', zone ? 'Change zone' : 'Clear zone', (e) => e.editSetZone(sid, dbref, zone));
export const setLock = (sid: string, dbref: string, type: string, expr: string): Promise<boolean> =>
  runChange(sid, dbref, `lock:${type}`, expr ? `Set ${type} lock` : `Clear ${type} lock`, (e) =>
    e.editSetLock(sid, dbref, type, expr),
  );
export const setHome = (sid: string, dbref: string, room: string): Promise<boolean> =>
  runChange(sid, dbref, 'home', 'Set home', (e) => e.editSetHome(sid, dbref, room));
export const setDestination = (sid: string, dbref: string, room: string): Promise<boolean> =>
  runChange(sid, dbref, 'destination', 'Set destination', (e) => e.editSetDestination(sid, dbref, room));

/** Move an object (an exit: change its source room); remembers the target as recently used. */
export async function moveTo(sid: string, dbref: string, dest: EditPlace): Promise<boolean> {
  const ok = await runChange(sid, dbref, 'location', 'Move', (e) => e.editMove(sid, dbref, dest.dbref));
  if (ok) rememberPlace(sid, dest);
  return ok;
}

export function rememberPlace(sid: string, p: EditPlace): void {
  const s = useSessions.getState().sessions[sid];
  if (s) pushRecent(worldKey(s), p);
}
export function recentPlaces(sid: string): EditPlace[] {
  const s = useSessions.getState().sessions[sid];
  return s ? loadRecent(worldKey(s)) : [];
}

// ---------------------------------------------------------------- attribute flags

/** Toggle one attribute flag; the attribute list learns the verified flags. Returns the reply or error. */
export async function toggleAttrFlag(
  sid: string,
  dbref: string,
  attr: string,
  flag: string,
  on: boolean,
): Promise<{ ok: boolean; reply: string; text: string }> {
  const eng = engine();
  if (!eng) return { ok: false, reply: '', text: 'No engine' };
  const r = await eng.editSetAttrFlag(sid, dbref, attr, flag, on);
  if (r.known) setAttrFlags(sid, dbref, attr, r.flagNames);
  const text = r.ok ? r.reply || 'Done.' : describeMutation(r);
  announce(r.ok ? `${attr} ${flag}: ${text}` : `${attr} ${flag} failed. ${text}`, !r.ok);
  return { ok: r.ok, reply: r.reply, text };
}

/** Read the flags of one attribute into the attribute list (names, space separated). */
export async function loadAttrFlags(sid: string, dbref: string, attr: string): Promise<string | null> {
  const eng = engine();
  if (!eng) return null;
  const r = await eng.editAttrInfo(sid, dbref, attr);
  if (!r.ok || !r.known) return null;
  const names = r.flagNames || r.flags;
  setAttrFlags(sid, dbref, attr, names);
  return names;
}

// ---------------------------------------------------------------- catalogues

const idle = (): CatalogState => ({ state: 'idle', known: false, items: [] });

async function loadCatalog(sid: string, which: 'flags' | 'powers'): Promise<void> {
  const eng = engine();
  if (!eng) return;
  const cur = useDetails.getState()[which][sid];
  if (cur && (cur.state === 'loading' || cur.state === 'ready')) return;
  const set = (c: CatalogState): void => useDetails.setState((s) => ({ [which]: { ...s[which], [sid]: c } }));
  set({ ...idle(), state: 'loading' });
  const r = await (which === 'flags' ? eng.editListFlags(sid) : eng.editListPowers(sid));
  set(
    r.ok
      ? { state: 'ready', known: r.known, items: r.items }
      : { state: 'error', known: false, items: [], error: describeFailure(r, which) },
  );
}
export const loadFlagCatalog = (sid: string): Promise<void> => loadCatalog(sid, 'flags');
export const loadPowerCatalog = (sid: string): Promise<void> => loadCatalog(sid, 'powers');

// ---------------------------------------------------------------- dialogs

export const openPlaceDialog = (sid: string, dbref: string, mode: PlaceMode): void =>
  useDetails.setState({ place: { sid, dbref, mode } });
export const closePlaceDialog = (): void => useDetails.setState({ place: null });
export const openPickDialog = (sid: string, dbref: string, field: 'owner' | 'parent' | 'zone'): void =>
  useDetails.setState({ pick: { sid, dbref, field } });
export const closePickDialog = (): void => useDetails.setState({ pick: null });
export const openAttrFlags = (sid: string, dbref: string, attr: string): void => {
  if (getObject(sid, dbref)) useDetails.setState({ attrFlags: { sid, dbref, attr } });
};
export const closeAttrFlags = (): void => useDetails.setState({ attrFlags: null });

export function resetDetails(): void {
  useDetails.setState({ entries: {}, flags: {}, powers: {}, place: null, pick: null, attrFlags: null });
}
