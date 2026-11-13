import { create } from 'zustand';
import type { EditCode, EditResult, EngineAPI, Tri } from '../api/types';
import { initialMode, isDirty, pack, unpack, convert } from '../lib/editor/serialize';
import type { ViewMode } from '../lib/editor/serialize';
import { checkAttrName } from '../lib/editor/validate';
import { searchValues } from '../lib/editor/search';
import type { SearchHit, SearchOptions } from '../lib/editor/search';
import type { AttrRef } from '../lib/editor/refs';
import { loadPersisted, savePersisted } from '../lib/editor/persist';
import type { PersistedWorkspace } from '../lib/editor/persist';
import { worldKey } from '../lib/worldkey';
import { useSessions, useUi } from './stores';

// ------------------------------------------------------------------ types (docs/EDIT-WORKSPACE.md section 2)

export interface AttrEntry {
  name: string;
  flags?: string;
  /** false: the flags prove it is protected; 'unknown': the game decides on save */
  writable: boolean | 'unknown';
  /** created in the editor, not saved yet */
  isNew?: boolean;
}

export interface Buffer {
  /** raw stored value when opened / last saved (literal %r) */
  original: string;
  /** editor text (see ViewMode) */
  text: string;
  mode: ViewMode;
  /** the attribute exists in the game */
  exists: boolean;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  loadError?: string;
  /** the game's reply when a save was refused, or another save problem */
  lastError?: string;
  lastCode?: EditCode;
  notice?: { kind: 'saved' | 'mismatch' | 'reloaded'; text: string };
  /** somebody changed the attribute since it was opened: the dialog decides */
  conflict?: { theirs: string; theirsExists: boolean };
  /** unsaved text recovered from a previous session */
  restored?: boolean;
}

export interface SearchState {
  query: string;
  options: SearchOptions;
  running: boolean;
  fetched: number;
  total: number;
  hits: SearchHit[];
  error?: string;
}

export interface OpenObject {
  dbref: string;
  name?: string;
  owner?: string;
  flags?: string;
  type?: string;
  /** does the user control it (spec 4.2) */
  controls: boolean | 'unknown';
  attrs: AttrEntry[];
  attrsLoadedAt?: number;
  activeAttr: string | null;
  buffers: Record<string, Buffer>;
  /** raw values seen so far (search across attributes, go-to-definition) */
  cache: Record<string, string>;
  loading: boolean;
  error?: string;
  errorCode?: EditCode;
  search?: SearchState;
}

export interface Workspace {
  objects: OpenObject[];
  activeObject: string | null;
  /** persisted state has been applied */
  restored: boolean;
}

export interface Announcement {
  id: number;
  text: string;
  /** assertive for rejections */
  urgent: boolean;
}

export interface EditorState {
  ws: Record<string, Workspace>;
  announcement: Announcement | null;
}

export const useEditor = create<EditorState>(() => ({ ws: {}, announcement: null }));

// ------------------------------------------------------------------ helpers

const emptyWs = (): Workspace => ({ objects: [], activeObject: null, restored: false });

export const getWorkspace = (sid: string): Workspace => useEditor.getState().ws[sid] ?? emptyWs();
export const getObject = (sid: string, dbref: string): OpenObject | undefined =>
  getWorkspace(sid).objects.find((o) => o.dbref === dbref);
export const getBuffer = (sid: string, dbref: string, attr: string): Buffer | undefined =>
  getObject(sid, dbref)?.buffers[attr];

function patchWs(sid: string, fn: (w: Workspace) => Workspace): void {
  useEditor.setState((s) => ({ ws: { ...s.ws, [sid]: fn(s.ws[sid] ?? emptyWs()) } }));
}
function patchObject(sid: string, dbref: string, fn: (o: OpenObject) => OpenObject): void {
  patchWs(sid, (w) => ({ ...w, objects: w.objects.map((o) => (o.dbref === dbref ? fn(o) : o)) }));
}
function patchBuffer(sid: string, dbref: string, attr: string, fn: (b: Buffer) => Buffer): void {
  patchObject(sid, dbref, (o) => {
    const b = o.buffers[attr];
    return b ? { ...o, buffers: { ...o.buffers, [attr]: fn(b) } } : o;
  });
}

let announceId = 0;
export function announce(text: string, urgent = false): void {
  useEditor.setState({ announcement: { id: ++announceId, text, urgent } });
}

const engine = (): EngineAPI | null => useUi.getState().engine;

const triToControls = (t: Tri | undefined): boolean | 'unknown' =>
  t === 'true' ? true : t === 'false' ? false : 'unknown';

/** The game's own words: strips the engine's `engine: ...:` prefixes from an error. */
export function gameText(error?: string): string {
  if (!error) return 'Unknown error';
  return error.replace(/^engine: [^:]*: /, '').replace(/^engine: /, '');
}

/** A sentence for a failed open/load. */
export function describeFailure(r: EditResult, what: string): string {
  const t = gameText(r.error);
  switch (r.code) {
    case 'no_such_object':
      return `No such object: ${what}. (${t})`;
    case 'permission':
      return `You are not allowed to see ${what}. (${t})`;
    case 'ambiguous':
      return `More than one object matches ${what}: use its #dbref.`;
    case 'timeout':
      return `The game did not answer in time (${what}). Try again.`;
    case 'no_session':
    case 'session_ended':
      return 'This world is not connected.';
    default:
      return t;
  }
}

export const isReadOnlyObject = (o: OpenObject): boolean => o.controls === false;
export function isReadOnlyAttr(o: OpenObject, attr: string): boolean {
  return o.controls === false || o.attrs.find((a) => a.name === attr)?.writable === false;
}
export const dirtyAttrs = (o: OpenObject): string[] =>
  Object.keys(o.buffers).filter((k) => o.buffers[k].dirty);
export const dirtyCount = (sid: string): number =>
  getWorkspace(sid).objects.reduce((n, o) => n + dirtyAttrs(o).length, 0);

const freshObject = (dbref: string, name?: string): OpenObject => ({
  dbref,
  name,
  controls: 'unknown',
  attrs: [],
  activeAttr: null,
  buffers: {},
  cache: {},
  loading: true,
});

const sortAttrs = (a: AttrEntry[]): AttrEntry[] => [...a].sort((x, y) => x.name.localeCompare(y.name));

// ------------------------------------------------------------------ opening

export type OpenResult = { ok: true; dbref: string } | { ok: false; error: string };

/** `[+]` and `/edit X`: resolve X through the game, open (or focus) its tab, optionally an attribute. */
export async function openTarget(sid: string, target: string, attr?: string): Promise<OpenResult> {
  const eng = engine();
  if (!eng) return { ok: false, error: 'No engine' };
  const t = target.trim();
  announceBusy(true);
  const r = await eng.editResolve(sid, t);
  if (!r.ok) {
    announceBusy(false);
    return { ok: false, error: describeFailure(r, t) };
  }
  const existing = getObject(sid, r.dbref);
  patchWs(sid, (w) =>
    existing
      ? { ...w, activeObject: r.dbref }
      : { ...w, objects: [...w.objects, freshObject(r.dbref, r.name)], activeObject: r.dbref },
  );
  announceBusy(false);
  if (existing) {
    if (attr) await selectAttr(sid, r.dbref, attr, { create: true });
    return { ok: true, dbref: r.dbref };
  }
  await loadObject(sid, r.dbref, { select: attr });
  return { ok: true, dbref: r.dbref };
}

function announceBusy(_busy: boolean): void {
  /* reserved: a global busy indicator could hook here */
}

interface LoadOpts {
  /** attribute to select afterwards */
  select?: string;
  /** reload clean buffers from the game as well */
  refreshBuffers?: boolean;
  persisted?: PersistedWorkspace['objects'][number];
}

/** Fetch the object header, attribute names and permission; then select an attribute. */
export async function loadObject(sid: string, dbref: string, opts: LoadOpts = {}): Promise<void> {
  const eng = engine();
  if (!eng) return;
  patchObject(sid, dbref, (o) => ({ ...o, loading: true, error: undefined, errorCode: undefined }));
  const r = await eng.editFetchObject(sid, dbref);
  if (!getObject(sid, dbref)) return; // closed meanwhile
  if (!r.ok) {
    patchObject(sid, dbref, (o) => ({
      ...o,
      loading: false,
      error: describeFailure(r, dbref),
      errorCode: r.code,
    }));
    return;
  }
  const known = new Map((getObject(sid, dbref)?.attrs ?? []).map((a) => [a.name, a]));
  const fromGame = r.attrs.map<AttrEntry>((a) => ({
    name: a.name,
    writable: known.get(a.name)?.writable ?? 'unknown',
    flags: known.get(a.name)?.flags,
  }));
  // keep attributes that only exist in the editor (new, unsaved)
  const local = (getObject(sid, dbref)?.attrs ?? []).filter(
    (a) => a.isNew && !fromGame.some((g) => g.name === a.name),
  );
  patchObject(sid, dbref, (o) => ({
    ...o,
    name: r.name,
    owner: r.owner,
    flags: r.flags,
    type: r.type,
    attrs: sortAttrs([...fromGame, ...local]),
    attrsLoadedAt: Date.now(),
  }));
  const c = await eng.editControls(sid, dbref);
  patchObject(sid, dbref, (o) => ({
    ...o,
    controls: c.ok ? triToControls(c.controls) : 'unknown',
    loading: false,
  }));

  const p = opts.persisted;
  if (p) {
    for (const [attr, d] of Object.entries(p.drafts))
      await loadBuffer(sid, dbref, attr, { draft: d, mode: p.modes[attr] });
  }
  if (opts.refreshBuffers) {
    const o = getObject(sid, dbref);
    for (const [attr, b] of Object.entries(o?.buffers ?? {})) {
      if (!b.dirty && !b.saving) await loadBuffer(sid, dbref, attr, { force: true });
    }
  }
  const o = getObject(sid, dbref);
  const target = opts.select ?? o?.activeAttr ?? p?.activeAttr ?? o?.attrs[0]?.name ?? null;
  if (target) await selectAttr(sid, dbref, target, { create: !!opts.select, activate: false });
}

interface BufferLoad {
  force?: boolean;
  draft?: PersistedWorkspace['objects'][number]['drafts'][string];
  mode?: ViewMode;
}

/** Read an attribute into a buffer. A restored draft is applied on top of the fresh game value. */
async function loadBuffer(
  sid: string,
  dbref: string,
  attr: string,
  o: BufferLoad = {},
): Promise<Buffer | undefined> {
  const eng = engine();
  if (!eng) return;
  const cur = getBuffer(sid, dbref, attr);
  if (cur && !o.force) return cur;
  if (!cur) {
    patchObject(sid, dbref, (ob) => ({
      ...ob,
      buffers: {
        ...ob.buffers,
        [attr]: {
          original: '',
          text: '',
          mode: 'code',
          exists: false,
          dirty: false,
          saving: false,
          loading: true,
        },
      },
    }));
  }
  const r = await eng.editFetchAttr(sid, dbref, attr);
  if (!getObject(sid, dbref)) return;
  if (!r.ok) {
    patchObject(sid, dbref, (ob) => {
      const b = ob.buffers[attr];
      if (!b) return ob;
      return {
        ...ob,
        buffers: {
          ...ob.buffers,
          [attr]: { ...b, loading: false, loadError: describeFailure(r, `${dbref}/${attr}`) },
        },
      };
    });
    return;
  }
  const game = r.exists ? r.value : '';
  patchObject(sid, dbref, (ob) => {
    const prev = ob.buffers[attr];
    const mode: ViewMode =
      o.mode ?? (prev && !prev.loading && (prev.dirty || !o.force) ? prev.mode : initialMode(game));
    let b: Buffer;
    if (o.draft) {
      const m = o.draft.mode;
      const changed = o.draft.original !== game;
      b = {
        original: game,
        text: o.draft.text,
        mode: m,
        exists: r.exists,
        dirty: isDirty(m, o.draft.text, game),
        saving: false,
        loading: false,
        restored: true,
        conflict: changed ? { theirs: game, theirsExists: r.exists } : undefined,
        notice: undefined,
      };
    } else {
      b = {
        original: game,
        text: unpack(mode, game),
        mode,
        exists: r.exists,
        dirty: false,
        saving: false,
        loading: false,
      };
    }
    const attrs =
      !r.exists && !ob.attrs.some((a) => a.name === attr)
        ? sortAttrs([...ob.attrs, { name: attr, writable: 'unknown' as const, isNew: true }])
        : ob.attrs;
    return {
      ...ob,
      attrs,
      buffers: { ...ob.buffers, [attr]: b },
      cache: r.exists ? { ...ob.cache, [attr]: game } : ob.cache,
    };
  });
  return getBuffer(sid, dbref, attr);
}

/** Make `attr` the active attribute of an object, loading its value (and flags, best effort) first. */
export async function selectAttr(
  sid: string,
  dbref: string,
  attr: string,
  opts: { create?: boolean; activate?: boolean } = {},
): Promise<'ok' | 'missing' | 'error'> {
  const eng = engine();
  const ob = getObject(sid, dbref);
  if (!eng || !ob) return 'error';
  if (opts.activate !== false) patchWs(sid, (w) => ({ ...w, activeObject: dbref }));
  const had = !!ob.buffers[attr];
  if (!had) {
    const inList = ob.attrs.some((a) => a.name === attr);
    if (!inList && !opts.create) {
      // verify first: only create an editable new attribute on request
      const r = await eng.editFetchAttr(sid, dbref, attr);
      if (r.ok && !r.exists) {
        useUi.getState().toast('info', `${dbref} has no attribute ${attr}`);
        return 'missing';
      }
    }
    patchObject(sid, dbref, (o) => ({ ...o, activeAttr: attr }));
    await loadBuffer(sid, dbref, attr);
    void loadAttrInfo(sid, dbref, attr);
  } else {
    patchObject(sid, dbref, (o) => ({ ...o, activeAttr: attr }));
  }
  return getBuffer(sid, dbref, attr)?.loadError ? 'error' : 'ok';
}

async function loadAttrInfo(sid: string, dbref: string, attr: string): Promise<void> {
  const eng = engine();
  if (!eng) return;
  const r = await eng.editAttrInfo(sid, dbref, attr);
  if (!r.ok || !r.known) return;
  patchObject(sid, dbref, (o) => ({
    ...o,
    attrs: o.attrs.map((a) =>
      a.name === attr
        ? {
            ...a,
            flags: r.flagNames || r.flags || a.flags,
            writable: r.writable === 'false' ? false : a.writable,
          }
        : a,
    ),
  }));
}

export function selectObject(sid: string, dbref: string): void {
  const o = getObject(sid, dbref);
  if (!o) return;
  patchWs(sid, (w) => ({ ...w, activeObject: dbref }));
  if (o.activeAttr && !o.buffers[o.activeAttr]) void selectAttr(sid, dbref, o.activeAttr);
  else if (!o.activeAttr && o.attrs[0] && !o.loading) void selectAttr(sid, dbref, o.attrs[0].name);
}

/** Select the n-th (0-based) object tab. */
export function selectObjectIndex(sid: string, i: number): void {
  const o = getWorkspace(sid).objects[i];
  if (o) selectObject(sid, o.dbref);
}

export function moveObject(sid: string, from: number, to: number): void {
  patchWs(sid, (w) => {
    if (from === to || from < 0 || to < 0 || from >= w.objects.length || to >= w.objects.length) return w;
    const objects = [...w.objects];
    const [m] = objects.splice(from, 1);
    objects.splice(to, 0, m);
    return { ...w, objects };
  });
}

/** Close an object tab. With unsaved changes it refuses (returns the dirty attributes) unless `discard`. */
export function closeObject(
  sid: string,
  dbref: string,
  discard = false,
): { closed: boolean; dirty: string[] } {
  const o = getObject(sid, dbref);
  if (!o) return { closed: false, dirty: [] };
  const dirty = dirtyAttrs(o);
  if (dirty.length > 0 && !discard) return { closed: false, dirty };
  patchWs(sid, (w) => {
    const i = w.objects.findIndex((x) => x.dbref === dbref);
    const objects = w.objects.filter((x) => x.dbref !== dbref);
    const activeObject =
      w.activeObject === dbref ? (objects[Math.min(i, objects.length - 1)]?.dbref ?? null) : w.activeObject;
    return { ...w, objects, activeObject };
  });
  const next = getWorkspace(sid).activeObject;
  if (next) selectObject(sid, next);
  return { closed: true, dirty: [] };
}

// ------------------------------------------------------------------ editing

export function setText(sid: string, dbref: string, attr: string, text: string): void {
  patchBuffer(sid, dbref, attr, (b) => {
    if (b.text === text) return b;
    return {
      ...b,
      text,
      dirty: isDirty(b.mode, text, b.original),
      notice: b.notice?.kind === 'saved' ? undefined : b.notice,
    };
  });
}

export function revert(sid: string, dbref: string, attr: string): void {
  patchBuffer(sid, dbref, attr, (b) => ({
    ...b,
    text: unpack(b.mode, b.original),
    dirty: false,
    lastError: undefined,
    lastCode: undefined,
    notice: undefined,
    restored: false,
  }));
}

/** Switch between code view (raw %r) and line-break view without changing what would be stored. */
export function toggleMode(sid: string, dbref: string, attr: string): void {
  patchBuffer(sid, dbref, attr, (b) => {
    const to: ViewMode = b.mode === 'code' ? 'lines' : 'code';
    const c = convert(b.mode, to, b.text);
    if (!c.ok) return { ...b, lastError: c.error, lastCode: 'unsafe_value' };
    return { ...b, mode: to, text: c.text, dirty: isDirty(to, c.text, b.original), lastError: undefined };
  });
}

/** Add an attribute that does not exist yet; it is created by the first save. */
export function newAttribute(
  sid: string,
  dbref: string,
  rawName: string,
): { ok: true; attr: string } | { ok: false; error: string } {
  const name = rawName.trim().toUpperCase();
  const e = checkAttrName(name);
  if (e) return { ok: false, error: e };
  const o = getObject(sid, dbref);
  if (!o) return { ok: false, error: 'Object is not open' };
  if (o.controls === false) return { ok: false, error: `You do not control ${dbref}` };
  if (!o.attrs.some((a) => a.name === name)) {
    patchObject(sid, dbref, (ob) => ({
      ...ob,
      attrs: sortAttrs([...ob.attrs, { name, writable: 'unknown', isNew: true }]),
      buffers: {
        ...ob.buffers,
        [name]: {
          original: '',
          text: '',
          mode: 'code',
          exists: false,
          dirty: false,
          saving: false,
          loading: false,
        },
      },
      activeAttr: name,
    }));
  } else void selectAttr(sid, dbref, name);
  patchObject(sid, dbref, (ob) => ({ ...ob, activeAttr: name }));
  return { ok: true, attr: name };
}

// ------------------------------------------------------------------ saving (spec 4.3)

export type SaveOutcome = 'saved' | 'conflict' | 'rejected' | 'mismatch' | 'readonly' | 'error' | 'nothing';

export async function save(
  sid: string,
  dbref: string,
  attr: string,
  opts: { force?: boolean } = {},
): Promise<SaveOutcome> {
  const eng = engine();
  const ob = getObject(sid, dbref);
  const b = ob?.buffers[attr];
  if (!eng || !ob || !b) return 'error';
  if (b.saving) return 'nothing';
  if (isReadOnlyAttr(ob, attr)) return 'readonly';
  const p = pack(b.mode, b.text);
  if (!p.ok) {
    patchBuffer(sid, dbref, attr, (x) => ({ ...x, lastError: p.error, lastCode: 'unsafe_value' }));
    announce(`Cannot save ${attr}: ${p.error}`, true);
    return 'error';
  }
  const sentText = b.text;
  patchBuffer(sid, dbref, attr, (x) => ({
    ...x,
    saving: true,
    lastError: undefined,
    lastCode: undefined,
    notice: undefined,
    conflict: undefined,
  }));
  const finish = (fn: (x: Buffer) => Buffer): void =>
    patchBuffer(sid, dbref, attr, (x) => fn({ ...x, saving: false }));

  // 1. re-read: has somebody changed it since we opened it?
  if (!opts.force) {
    const cur = await eng.editFetchAttr(sid, dbref, attr);
    if (!cur.ok) {
      const msg = `Could not check ${attr} for changes before saving: ${gameText(cur.error)}`;
      finish((x) => ({ ...x, lastError: msg, lastCode: cur.code }));
      announce(msg, true);
      return 'error';
    }
    const theirs = cur.exists ? cur.value : '';
    if (theirs !== b.original || cur.exists !== b.exists) {
      finish((x) => ({ ...x, conflict: { theirs, theirsExists: cur.exists } }));
      announce(`${attr} was changed by someone else. Choose how to continue.`, true);
      return 'conflict';
    }
  }

  // 2. save (the engine verifies by reading back, step 3)
  const r = await eng.editSaveAttr(sid, dbref, attr, p.raw);
  if (!getBuffer(sid, dbref, attr)) return 'error';
  if (r.ok) {
    finish((x) => ({
      ...x,
      original: p.raw,
      exists: p.raw !== '' ? true : false,
      dirty: isDirty(x.mode, x.text, p.raw),
      restored: false,
      notice: { kind: 'saved', text: 'Saved' },
    }));
    patchObject(sid, dbref, (o) => ({
      ...o,
      attrs: o.attrs.map((a) => (a.name === attr ? { ...a, isNew: false } : a)),
      cache:
        p.raw === ''
          ? Object.fromEntries(Object.entries(o.cache).filter(([k]) => k !== attr))
          : { ...o.cache, [attr]: p.raw },
    }));
    announce(`Saved ${attr} on ${dbref}`);
    void sentText;
    return 'saved';
  }
  if (r.code === 'mismatch') {
    const again = await eng.editFetchAttr(sid, dbref, attr);
    const stored = again.ok ? (again.exists ? again.value : '') : undefined;
    const msg = `Saved, but the game stored something different. ${gameText(r.error)}`;
    finish((x) => ({
      ...x,
      original: stored ?? x.original,
      exists: again.ok ? again.exists : x.exists,
      dirty: true,
      lastError: msg,
      lastCode: 'mismatch',
      notice: { kind: 'mismatch', text: 'The game changed what you saved' },
    }));
    announce(`${attr}: the game stored a different value than you saved`, true);
    return 'mismatch';
  }
  const msg = gameText(r.error);
  finish((x) => ({ ...x, lastError: msg, lastCode: r.code }));
  announce(`${attr} was not saved: ${msg}`, true);
  return r.code === 'rejected' || r.code === 'permission' ? 'rejected' : 'error';
}

/** Save every dirty attribute of an object (sequentially: the game answers one thing at a time). */
export async function saveAll(sid: string, dbref: string): Promise<Record<string, SaveOutcome>> {
  const out: Record<string, SaveOutcome> = {};
  const o = getObject(sid, dbref);
  if (!o) return out;
  for (const attr of dirtyAttrs(o)) out[attr] = await save(sid, dbref, attr);
  return out;
}

export type ConflictChoice = 'overwrite' | 'reload' | 'keep';

export async function resolveConflict(
  sid: string,
  dbref: string,
  attr: string,
  choice: ConflictChoice,
): Promise<SaveOutcome | void> {
  const b = getBuffer(sid, dbref, attr);
  const c = b?.conflict;
  if (!b || !c) return;
  if (choice === 'overwrite') {
    patchBuffer(sid, dbref, attr, (x) => ({ ...x, conflict: undefined }));
    return save(sid, dbref, attr, { force: true });
  }
  if (choice === 'reload') {
    const mode = initialMode(c.theirs);
    patchBuffer(sid, dbref, attr, (x) => ({
      ...x,
      original: c.theirs,
      exists: c.theirsExists,
      mode,
      text: unpack(mode, c.theirs),
      dirty: false,
      conflict: undefined,
      lastError: undefined,
      restored: false,
      notice: { kind: 'reloaded', text: 'Reloaded the game’s version' },
    }));
    patchObject(sid, dbref, (o) => ({ ...o, cache: { ...o.cache, [attr]: c.theirs } }));
    return;
  }
  // keep editing: acknowledge their change; the next save overwrites without asking again
  patchBuffer(sid, dbref, attr, (x) => ({
    ...x,
    original: c.theirs,
    exists: c.theirsExists,
    dirty: isDirty(x.mode, x.text, c.theirs),
    conflict: undefined,
    restored: false,
  }));
}

/** Compare: fetch the game's current value (for the diff dialog). Null when it cannot be read. */
export async function fetchTheirs(
  sid: string,
  dbref: string,
  attr: string,
): Promise<{ value: string; exists: boolean } | null> {
  const eng = engine();
  if (!eng) return null;
  const r = await eng.editFetchAttr(sid, dbref, attr);
  return r.ok ? { value: r.exists ? r.value : '', exists: r.exists } : null;
}

// ------------------------------------------------------------------ refresh, search, go to definition

/** Re-read the object header, attribute list, permission and every clean buffer. */
export async function refresh(sid: string, dbref: string): Promise<void> {
  await loadObject(sid, dbref, { refreshBuffers: true });
}

let searchToken = 0;

/** Search every attribute of the object: values are fetched lazily (cached) and results fill in as they arrive. */
export async function searchAll(
  sid: string,
  dbref: string,
  query: string,
  options: SearchOptions = {},
): Promise<void> {
  const eng = engine();
  const token = ++searchToken;
  if (!eng || !getObject(sid, dbref)) return;
  if (query === '') {
    patchObject(sid, dbref, (o) => ({ ...o, search: undefined }));
    return;
  }
  const names =
    getObject(sid, dbref)
      ?.attrs.filter((a) => !a.isNew)
      .map((a) => a.name) ?? [];
  const values = (): Record<string, string> => {
    const o = getObject(sid, dbref);
    if (!o) return {};
    const v: Record<string, string> = { ...o.cache };
    for (const [k, b] of Object.entries(o.buffers)) if (b.exists) v[k] = b.original;
    return v;
  };
  const publish = (running: boolean, fetched: number, error?: string): void =>
    patchObject(sid, dbref, (o) => ({
      ...o,
      search: {
        query,
        options,
        running,
        fetched,
        total: names.length,
        hits: searchValues(values(), query, options),
        error,
      },
    }));
  publish(true, Object.keys(values()).length);
  for (const n of names) {
    if (token !== searchToken || !getObject(sid, dbref)) return;
    if (n in values()) continue;
    const r = await eng.editFetchAttr(sid, dbref, n);
    if (token !== searchToken) return;
    if (r.ok && r.exists) patchObject(sid, dbref, (o) => ({ ...o, cache: { ...o.cache, [n]: r.value } }));
    publish(true, Object.keys(values()).length);
  }
  if (token === searchToken) publish(false, Object.keys(values()).length);
}

export function clearSearch(sid: string, dbref: string): void {
  searchToken++;
  patchObject(sid, dbref, (o) => ({ ...o, search: undefined }));
}

/** Ctrl/Cmd-click or F12 on `u(#12/FN_X)`: open that attribute, loading the object when needed. */
export async function gotoRef(
  sid: string,
  fromDbref: string,
  ref: AttrRef,
): Promise<'ok' | 'missing' | 'error'> {
  const obj = ref.object;
  if (!obj || obj.toLowerCase() === 'me') return selectAttr(sid, fromDbref, ref.attr);
  const known = getWorkspace(sid).objects.find((o) => o.dbref === obj);
  if (known) return selectAttr(sid, known.dbref, ref.attr);
  const r = await openTarget(sid, obj);
  if (!r.ok) {
    useUi.getState().toast('warn', r.error);
    return 'error';
  }
  return selectAttr(sid, r.dbref, ref.attr);
}

// ------------------------------------------------------------------ persistence

/** Everything worth keeping for a world: tabs, active attribute, unsaved drafts, view modes. */
export function toPersisted(w: Workspace): PersistedWorkspace {
  return {
    v: 1,
    active: w.activeObject,
    objects: w.objects.map((o) => ({
      dbref: o.dbref,
      name: o.name,
      activeAttr: o.activeAttr,
      drafts: Object.fromEntries(
        Object.entries(o.buffers)
          .filter(([, b]) => b.dirty && !b.loadError)
          .map(([k, b]) => [k, { text: b.text, mode: b.mode, original: b.original }]),
      ),
      modes: Object.fromEntries(Object.entries(o.buffers).map(([k, b]) => [k, b.mode])),
    })),
  };
}

/**
 * Apply persisted tabs for the session's world once (when the editor view first needs them). The tab stubs
 * appear at once; the returned promise resolves when everything is loaded. Tabs already open are kept.
 */
export async function restoreWorkspace(sid: string): Promise<void> {
  const s = useSessions.getState().sessions[sid];
  if (!s || getWorkspace(sid).restored) return;
  patchWs(sid, (w) => ({ ...w, restored: true }));
  const p = loadPersisted(worldKey(s));
  if (!p || p.objects.length === 0) return;
  const missing = p.objects.filter((o) => !getObject(sid, o.dbref));
  patchWs(sid, (w) => ({
    ...w,
    objects: [...w.objects, ...missing.map((o) => freshObject(o.dbref, o.name))],
    activeObject:
      w.activeObject ??
      (p.active && p.objects.some((o) => o.dbref === p.active) ? p.active : p.objects[0].dbref),
  }));
  const active = getWorkspace(sid).activeObject;
  const order = [...missing].sort((a, b) => (a.dbref === active ? -1 : b.dbref === active ? 1 : 0));
  for (const po of order) {
    if (getObject(sid, po.dbref)) await loadObject(sid, po.dbref, { persisted: po });
  }
}

// ------------------------------------------------------------------ transient UI state of the view

export interface EditorUi {
  /** the `[+]` prompt is open */
  prompt: boolean;
  quickOpen: boolean;
  searchPanel: boolean;
  /** Compare dialog for this attribute */
  compare: { sid: string; dbref: string; attr: string } | null;
  /** closing these dirty attributes needs a decision */
  closeConfirm: { sid: string; dbref: string; dirty: string[] } | null;
  /** bumped to ask the active editor to take focus */
  focusTick: number;
  set(p: Partial<Omit<EditorUi, 'set'>>): void;
}

export const useEditorUi = create<EditorUi>((set) => ({
  prompt: false,
  quickOpen: false,
  searchPanel: false,
  compare: null,
  closeConfirm: null,
  focusTick: 0,
  set: (p) => set(p),
}));

/** Close a tab; a dirty one asks first (the view shows the confirmation). */
export function requestCloseObject(sid: string, dbref: string): void {
  const r = closeObject(sid, dbref);
  if (!r.closed && r.dirty.length > 0)
    useEditorUi.getState().set({ closeConfirm: { sid, dbref, dirty: r.dirty } });
}

let timer: ReturnType<typeof setTimeout> | undefined;
let persistOn = false;

/** Write workspaces to localStorage (debounced) whenever they change. Idempotent. */
export function startPersistence(delayMs = 300): () => void {
  if (persistOn) return () => undefined;
  persistOn = true;
  const flush = (): void => {
    const sessions = useSessions.getState().sessions;
    for (const [sid, w] of Object.entries(useEditor.getState().ws)) {
      const s = sessions[sid];
      // a workspace that never loaded must not wipe what was stored
      if (s && w.restored) savePersisted(worldKey(s), toPersisted(w));
    }
  };
  const unsub = useEditor.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  });
  return () => {
    unsub();
    clearTimeout(timer);
    flush();
    persistOn = false;
  };
}

export function resetEditor(): void {
  searchToken++;
  useEditor.setState({ ws: {}, announcement: null });
  useEditorUi.setState({
    prompt: false,
    quickOpen: false,
    searchPanel: false,
    compare: null,
    closeConfirm: null,
  });
}
