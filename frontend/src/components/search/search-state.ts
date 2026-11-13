import { useMemo } from 'react';
import { create } from 'zustand';
import type { Match } from '../../lib/search';
import type { HighlightRange } from '../../lib/runs';

export interface SearchState {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  matches: Match[]; // loaded-buffer matches, ascending
  olderSeqs: number[]; // seqs of hits older than the loaded buffer (from engine.search)
  current: number; // index into [olderSeqs..., matches...]
  set(p: Partial<Omit<SearchState, 'set'>>): void;
}

export const useSearch = create<SearchState>((set) => ({
  query: '',
  regex: false,
  caseSensitive: false,
  matches: [],
  olderSeqs: [],
  current: 0,
  set: (p) => set(p),
}));

/** Highlight ranges per line seq for the output rows. */
export function useSearchHighlights(_sessionId: string): Map<number, HighlightRange[]> | undefined {
  const matches = useSearch((s) => s.matches);
  const current = useSearch((s) => s.current);
  const olderCount = useSearch((s) => s.olderSeqs.length);
  return useMemo(() => {
    if (matches.length === 0) return undefined;
    const map = new Map<number, HighlightRange[]>();
    matches.forEach((m, i) => {
      const arr = map.get(m.seq) ?? [];
      arr.push({ start: m.start, end: m.end, current: i + olderCount === current });
      map.set(m.seq, arr);
    });
    return map;
  }, [matches, current, olderCount]);
}
