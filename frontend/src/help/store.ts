import { create } from 'zustand';
import { HOME_ID } from './home';

export type HelpView =
  { kind: 'topic'; id: string; anchor?: string; term?: string } | { kind: 'search'; query: string };

export interface HelpState {
  stack: HelpView[];
  pos: number;
  /** a `/help ...` request waiting for the browser to resolve it */
  pending: string | null;
  go(v: HelpView): void;
  setSearch(q: string): void;
  back(): void;
  forward(): void;
  request(q: string): void;
  takePending(): string | null;
}

const HOME: HelpView = { kind: 'topic', id: HOME_ID };

const sameView = (a: HelpView, b: HelpView): boolean =>
  a.kind === 'topic' && b.kind === 'topic'
    ? a.id === b.id && a.anchor === b.anchor && a.term === b.term
    : a.kind === 'search' && b.kind === 'search' && a.query === b.query;

export const useHelp = create<HelpState>((set, get) => ({
  stack: [HOME],
  pos: 0,
  pending: null,
  go: (v) =>
    set((s) => {
      if (sameView(s.stack[s.pos], v)) return s;
      const stack = [...s.stack.slice(0, s.pos + 1), v];
      return { stack, pos: stack.length - 1 };
    }),
  setSearch: (q) =>
    set((s) => {
      const cur = s.stack[s.pos];
      if (q.trim()) {
        if (cur.kind === 'search') {
          const stack = [...s.stack];
          stack[s.pos] = { kind: 'search', query: q };
          return { stack };
        }
        const stack = [...s.stack.slice(0, s.pos + 1), { kind: 'search', query: q } as HelpView];
        return { stack, pos: stack.length - 1 };
      }
      if (cur.kind !== 'search') return s;
      const stack = [...s.stack.slice(0, s.pos), ...s.stack.slice(s.pos + 1)];
      return stack.length === 0 ? { stack: [HOME], pos: 0 } : { stack, pos: Math.max(0, s.pos - 1) };
    }),
  back: () => set((s) => (s.pos > 0 ? { pos: s.pos - 1 } : s)),
  forward: () => set((s) => (s.pos < s.stack.length - 1 ? { pos: s.pos + 1 } : s)),
  request: (q) => set({ pending: q }),
  takePending: () => {
    const p = get().pending;
    if (p !== null) set({ pending: null });
    return p;
  },
}));

export const currentView = (s: HelpState): HelpView => s.stack[s.pos];

/** Id of the most recent topic page in the history up to the current position (search views do not count). */
export function lastTopicId(s: HelpState): string {
  for (let i = s.pos; i >= 0; i--) {
    const v = s.stack[i];
    if (v.kind === 'topic') return v.id;
  }
  return HOME_ID;
}

export function resetHelp(): void {
  useHelp.setState({ stack: [HOME], pos: 0, pending: null });
}
