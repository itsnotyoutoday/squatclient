import { useEffect, useRef } from 'react';
import { getBuffer, useSessions, useUi } from '../../state/stores';
import { findMatches } from '../../lib/search';
import { getOutput } from '../output/handle';
import { useSearch } from './search-state';

export function SearchBar({ sessionId }: { sessionId: string }) {
  const engine = useUi((s) => s.engine);
  const setOpen = useUi((s) => s.setSearch);
  const { query, regex, caseSensitive, matches, olderSeqs, current, set } = useSearch();
  const version = useSessions((s) => s.versions[sessionId] ?? 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const total = olderSeqs.length + matches.length;

  useEffect(() => inputRef.current?.select(), []);

  // Recompute matches over the loaded buffer whenever the query or buffer changes.
  useEffect(() => {
    const buf = getBuffer(sessionId);
    const found = findMatches(buf.lines, query, { regex, caseSensitive });
    set({
      matches: found,
      current: Math.min(useSearch.getState().current, olderSeqs.length + found.length - 1),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, regex, caseSensitive, version, sessionId]);

  // Ask the engine about older history (beyond what is loaded).
  useEffect(() => {
    if (!engine || !query) {
      set({ olderSeqs: [] });
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      engine
        .search(sessionId, query, { regex, caseSensitive })
        .then((hits) => {
          if (!live) return;
          const first = getBuffer(sessionId).first;
          set({ olderSeqs: hits.filter((h) => h.seq < first).map((h) => h.seq) });
        })
        .catch(() => live && set({ olderSeqs: [] }));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, query, regex, caseSensitive, sessionId]);

  const go = (idx: number): void => {
    if (total === 0) return;
    const n = ((idx % total) + total) % total;
    set({ current: n });
    const seq = n < olderSeqs.length ? olderSeqs[n] : matches[n - olderSeqs.length]?.seq;
    if (seq !== undefined) void getOutput()?.scrollToSeq(seq);
  };

  const close = (): void => {
    set({ query: '', matches: [], olderSeqs: [], current: 0 });
    setOpen(false);
  };

  return (
    <div className="searchbar" role="search" aria-label="Search output">
      <input
        ref={inputRef}
        type="search"
        aria-label="Search text"
        placeholder="Search scrollback"
        value={query}
        autoFocus
        onChange={(e) => set({ query: e.target.value, current: 0 })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            go(current + (e.shiftKey ? -1 : 1));
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      />
      <label>
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(e) => set({ caseSensitive: e.target.checked })}
        />{' '}
        Aa
      </label>
      <label>
        <input type="checkbox" checked={regex} onChange={(e) => set({ regex: e.target.checked })} /> .*
      </label>
      <span className="count" aria-live="polite">
        {query ? (total ? `${Math.min(current + 1, total)} / ${total}` : 'No results') : ''}
      </span>
      <button type="button" aria-label="Previous match" onClick={() => go(current - 1)} disabled={!total}>
        &uarr;
      </button>
      <button type="button" aria-label="Next match" onClick={() => go(current + 1)} disabled={!total}>
        &darr;
      </button>
      <button type="button" aria-label="Close search" onClick={close}>
        &times;
      </button>
    </div>
  );
}
