import { create } from 'zustand';
import { getIn, pkgKey, toText } from './paths';
import type { GmcpEntry, GmcpMap } from './paths';

/** An item of the character's inventory or of a room (Char.Items.*). */
export interface ItemRec {
  id: string;
  name: string;
  attrib?: string;
  [k: string]: unknown;
}

export interface ChatMessage {
  id: number;
  channel: string;
  talker: string;
  text: string;
  at: number;
}

/** What the window knows of one session's out-of-band data. */
export interface SessionData {
  gmcp: GmcpMap;
  msdp: Record<string, unknown>;
  items: Record<string, ItemRec[]>;
  chat: ChatMessage[];
}

const EMPTY: SessionData = { gmcp: {}, msdp: {}, items: {}, chat: [] };
const CHAT_MAX = 500;

/** Packages games send as partial updates: their keys are merged into what is known. */
const MERGED = new Set([
  'char.status',
  'char.vitals',
  'char.base',
  'char.maxstats',
  'char.stats',
  'char.worth',
]);

let chatId = 0;

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function asItems(v: unknown): ItemRec[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((o) => ({ ...o, id: toText(o.id), name: toText(o.name) }));
}

/** Char.Items.List/Add/Remove/Update keep one list per location ("inv", "room", "rep123"). */
function applyItems(items: Record<string, ItemRec[]>, pkg: string, data: unknown): Record<string, ItemRec[]> {
  if (!isObj(data)) return items;
  const loc = toText(data.location) || 'inv';
  const cur = items[loc] ?? [];
  switch (pkg) {
    case 'char.items.list':
      return { ...items, [loc]: asItems(data.items) };
    case 'char.items.add':
    case 'char.items.update': {
      const [it] = asItems([data.item]);
      if (!it) return items;
      const i = cur.findIndex((x) => x.id === it.id);
      const next = i >= 0 ? cur.map((x, j) => (j === i ? it : x)) : [...cur, it];
      return { ...items, [loc]: next };
    }
    case 'char.items.remove': {
      const id = isObj(data.item) ? toText(data.item.id) : toText(data.item);
      return { ...items, [loc]: cur.filter((x) => x.id !== id) };
    }
  }
  return items;
}

/** Comm.Channel.Text (`{channel, talker, text}`) and Aardwolf's comm.channel (`{chan, player, msg}`). */
function chatFrom(pkg: string, data: unknown): Omit<ChatMessage, 'id' | 'at'> | undefined {
  if (!isObj(data)) return undefined;
  if (pkg === 'comm.channel.text' || pkg === 'comm.channel') {
    const text = toText(data.text ?? data.msg ?? data.message);
    if (!text) return undefined;
    return {
      channel: toText(data.channel ?? data.chan) || 'chat',
      talker: toText(data.talker ?? data.player ?? data.name),
      text,
    };
  }
  return undefined;
}

interface LayoutDataState {
  sessions: Record<string, SessionData>;
  /** Script variables, by scope: the world id (or the session id for a quick connect). */
  vars: Record<string, Record<string, unknown>>;
  /** The engine's Lua variables (squat.var): shared by Lua scripts and every layout, whatever the world. */
  lua: Record<string, unknown>;
  /** Set variables (undefined deletes). */
  setLua(values: Record<string, unknown>): void;
  ingestGmcp(session: string, pkg: string, data: unknown, at?: number): void;
  ingestMsdp(session: string, vars: Record<string, unknown>): void;
  /** A snapshot (after attaching): replaces what is known. */
  ingestSnapshot(
    session: string,
    gmcp?: Record<string, unknown>,
    msdp?: Record<string, unknown>,
    at?: number,
  ): void;
  setVar(scope: string, name: string, value: unknown): void;
  setVars(scope: string, values: Record<string, unknown>): void;
  drop(session: string): void;
}

export const useLayoutData = create<LayoutDataState>((set) => ({
  sessions: {},
  vars: {},
  lua: {},
  setLua: (values) =>
    set((s) => {
      const lua = { ...s.lua };
      for (const [k, v] of Object.entries(values)) {
        if (v === undefined || v === null) delete lua[k];
        else lua[k] = v;
      }
      return { lua };
    }),
  ingestGmcp: (session, pkg, data, at = Date.now()) =>
    set((s) => {
      const cur = s.sessions[session] ?? EMPTY;
      const key = pkgKey(pkg);
      const prev = cur.gmcp[key];
      const merged = MERGED.has(key) && isObj(prev?.data) && isObj(data) ? { ...prev.data, ...data } : data;
      const entry: GmcpEntry = { name: prev?.name ?? pkg, data: merged, at };
      const next: SessionData = { ...cur, gmcp: { ...cur.gmcp, [key]: entry } };
      if (key.startsWith('char.items.')) next.items = applyItems(cur.items, key, data);
      const msg = chatFrom(key, data);
      if (msg) next.chat = [...cur.chat, { ...msg, id: ++chatId, at }].slice(-CHAT_MAX);
      return { sessions: { ...s.sessions, [session]: next } };
    }),
  ingestMsdp: (session, vars) =>
    set((s) => {
      const cur = s.sessions[session] ?? EMPTY;
      return { sessions: { ...s.sessions, [session]: { ...cur, msdp: { ...cur.msdp, ...vars } } } };
    }),
  ingestSnapshot: (session, gmcp, msdp, at = Date.now()) =>
    set((s) => {
      const cur = s.sessions[session] ?? EMPTY;
      const map: GmcpMap = {};
      for (const [name, data] of Object.entries(gmcp ?? {})) map[pkgKey(name)] = { name, data, at };
      let items = cur.items;
      for (const [k, e] of Object.entries(map))
        if (k.startsWith('char.items.')) items = applyItems(items, k, e.data);
      return {
        sessions: { ...s.sessions, [session]: { ...cur, gmcp: map, msdp: { ...(msdp ?? {}) }, items } },
      };
    }),
  setVar: (scope, name, value) =>
    set((s) => {
      const cur = { ...(s.vars[scope] ?? {}) };
      if (value === undefined) delete cur[name];
      else cur[name] = value;
      return { vars: { ...s.vars, [scope]: cur } };
    }),
  setVars: (scope, values) =>
    set((s) => ({ vars: { ...s.vars, [scope]: { ...(s.vars[scope] ?? {}), ...values } } })),
  drop: (session) =>
    set((s) => {
      const sessions = { ...s.sessions };
      delete sessions[session];
      return { sessions };
    }),
}));

export const sessionData = (id: string | undefined): SessionData =>
  (id ? useLayoutData.getState().sessions[id] : undefined) ?? EMPTY;

export { getIn };
export function resetLayoutData(): void {
  useLayoutData.setState({ sessions: {}, vars: {}, lua: {} });
}
