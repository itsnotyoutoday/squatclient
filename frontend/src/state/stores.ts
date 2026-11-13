import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '../api/types';
import type {
  EngineAPI,
  SessionInfo,
  Settings,
  StatusField,
  WorldConfig,
  SquatterConfig,
} from '../api/types';
import { LineBuffer } from './buffer';

// ---------------------------------------------------------------- line buffers (outside React state)

const buffers = new Map<string, LineBuffer>();
let bufferCap = DEFAULT_SETTINGS.scrollbackLines;

export function getBuffer(id: string): LineBuffer {
  let b = buffers.get(id);
  if (!b) buffers.set(id, (b = new LineBuffer(bufferCap)));
  return b;
}
export function dropBuffer(id: string): void {
  buffers.delete(id);
}
export function setBufferCap(cap: number): void {
  bufferCap = cap;
  for (const b of buffers.values()) b.setCap(cap);
}
export function resetBuffers(): void {
  buffers.clear();
}

// ---------------------------------------------------------------- sessions

export interface SessionsState {
  sessions: Record<string, SessionInfo>;
  order: string[];
  fg: string | null;
  /** buffer version per session: bumped when lines change so views re-render */
  versions: Record<string, number>;
  status: Record<string, StatusField[]>;
  paused: Record<string, { paused: boolean; unread: number }>;
  upsert(info: SessionInfo): void;
  setAll(list: SessionInfo[]): void;
  remove(id: string): void;
  setFg(id: string | null): void;
  bump(ids: string[]): void;
  setStatus(id: string, fields: StatusField[]): void;
  setPaused(id: string, p: { paused: boolean; unread: number }): void;
}

export const useSessions = create<SessionsState>((set) => ({
  sessions: {},
  order: [],
  fg: null,
  versions: {},
  status: {},
  paused: {},
  upsert: (info) =>
    set((s) => ({
      sessions: { ...s.sessions, [info.id]: info },
      order: s.order.includes(info.id) ? s.order : [...s.order, info.id],
      fg: s.fg ?? info.id,
    })),
  setAll: (list) =>
    set(() => ({
      sessions: Object.fromEntries(list.map((i) => [i.id, i])),
      order: list.map((i) => i.id),
    })),
  remove: (id) =>
    set((s) => {
      const { [id]: _gone, ...sessions } = s.sessions;
      const order = s.order.filter((x) => x !== id);
      const fg = s.fg === id ? (order[Math.max(0, s.order.indexOf(id) - 1)] ?? order[0] ?? null) : s.fg;
      return { sessions, order, fg };
    }),
  setFg: (id) => set({ fg: id }),
  bump: (ids) =>
    set((s) => {
      const versions = { ...s.versions };
      for (const id of ids) versions[id] = getBuffer(id).version;
      return { versions };
    }),
  setStatus: (id, fields) => set((s) => ({ status: { ...s.status, [id]: fields } })),
  setPaused: (id, p) => set((s) => ({ paused: { ...s.paused, [id]: p } })),
}));

// ---------------------------------------------------------------- settings

export interface SettingsState {
  settings: Settings;
  loaded: boolean;
  set(s: Settings): void;
}
export const useSettings = create<SettingsState>((set) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
  set: (settings) => set({ settings, loaded: true }),
}));

// ---------------------------------------------------------------- ui

export type DialogId = 'worlds' | 'quick' | 'settings' | 'squatters' | 'help' | 'away' | null;

export interface Toast {
  id: number;
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface UiState {
  engine: EngineAPI | null;
  dialog: DialogId;
  searchOpen: boolean;
  worlds: WorldConfig[];
  squatters: SquatterConfig[];
  suspended: boolean;
  awayIds: string[];
  toasts: Toast[];
  now: number;
  setEngine(e: EngineAPI): void;
  openDialog(d: DialogId): void;
  setSearch(open: boolean): void;
  setWorlds(w: WorldConfig[]): void;
  setSquatters(s: SquatterConfig[]): void;
  patchSquatter(p: Partial<SquatterConfig> & { id: string }): void;
  setSuspended(v: boolean): void;
  setAway(ids: string[]): void;
  toast(level: Toast['level'], text: string): void;
  dismissToast(id: number): void;
  tick(): void;
}

let toastId = 0;
export const useUi = create<UiState>((set) => ({
  engine: null,
  dialog: null,
  searchOpen: false,
  worlds: [],
  squatters: [],
  suspended: false,
  awayIds: [],
  toasts: [],
  now: Date.now(),
  setEngine: (engine) => set({ engine }),
  openDialog: (dialog) => set({ dialog }),
  setSearch: (searchOpen) => set({ searchOpen }),
  setWorlds: (worlds) => set({ worlds }),
  setSquatters: (squatters) => set({ squatters }),
  patchSquatter: (p) =>
    set((s) => ({ squatters: s.squatters.map((q) => (q.id === p.id ? { ...q, ...p } : q)) })),
  setSuspended: (suspended) => set({ suspended }),
  setAway: (awayIds) => set({ awayIds }),
  toast: (level, text) => set((s) => ({ toasts: [...s.toasts.slice(-3), { id: ++toastId, level, text }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  tick: () => set({ now: Date.now() }),
}));

export function resetStores(): void {
  resetBuffers();
  useSessions.setState({ sessions: {}, order: [], fg: null, versions: {}, status: {}, paused: {} });
  useUi.setState({
    dialog: null,
    searchOpen: false,
    awayIds: [],
    toasts: [],
    worlds: [],
    squatters: [],
    suspended: false,
  });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: false });
}
