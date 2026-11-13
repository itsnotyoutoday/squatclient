import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { HistoryEntry } from '../../api/types';
import { formatAgo, formatTime } from '../../lib/humanize';
import { matchRanges, PLACEHOLDER_PX, preview, rowHeight, segments } from '../../lib/historyview';
import type { MatchOpts } from '../../lib/historyview';

export interface HistoryListProps {
  id: string;
  /** Entries loaded so far (newest first); `total` rows exist, the rest are placeholders. */
  entries: readonly HistoryEntry[];
  total: number;
  selected: number;
  query: string;
  match: MatchOpts;
  onSelect(i: number): void;
  onOpen(i: number): void;
  /** Called with the last visible index so more pages can be fetched. */
  onNeed(i: number): void;
}

export const optionId = (listId: string, i: number): string => `${listId}-o${i}`;

/** Virtualised newest-first list: smooth with tens of thousands of entries. */
export function HistoryList({
  id,
  entries,
  total,
  selected,
  query,
  match,
  onSelect,
  onOpen,
  onNeed,
}: HistoryListProps) {
  const parent = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: total,
    getScrollElement: () => parent.current,
    estimateSize: (i) => (entries[i] ? rowHeight(entries[i].text) : PLACEHOLDER_PX),
    overscan: 8,
    initialRect: { width: 600, height: 400 },
    getItemKey: (i) => entries[i]?.id ?? `p${i}`,
  });

  useEffect(() => v.measure(), [v, entries]);
  useEffect(() => {
    if (total > 0) v.scrollToIndex(Math.min(selected, total - 1), { align: 'auto' });
  }, [v, selected, total]);

  const items = v.getVirtualItems();
  const last = items.length ? items[items.length - 1].index : 0;
  useEffect(() => onNeed(last), [last, onNeed]);

  const now = Date.now();
  return (
    <div ref={parent} className="hlist" role="listbox" id={id} aria-label="Command history">
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {items.map((it) => {
          const e = entries[it.index];
          const sel = it.index === selected;
          const style = {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: it.size,
            transform: `translateY(${it.start}px)`,
          } as const;
          if (!e) {
            return (
              <div
                key={it.key}
                id={optionId(id, it.index)}
                role="option"
                aria-selected={sel}
                className="hrow loading"
                style={style}
              >
                Loading…
              </div>
            );
          }
          const ranges = matchRanges(e.text, query, match);
          const pv = preview(e.text, ranges);
          return (
            <div
              key={it.key}
              id={optionId(id, it.index)}
              role="option"
              aria-selected={sel}
              aria-posinset={it.index + 1}
              aria-setsize={total}
              className={`hrow${sel ? ' sel' : ''}`}
              style={style}
              onClick={() => onSelect(it.index)}
              onDoubleClick={() => onOpen(it.index)}
            >
              <span className="htime" title={new Date(e.ts).toLocaleString()}>
                <span>{formatAgo(e.ts, now)}</span>
                <span className="dim">{formatTime(e.ts, now)}</span>
              </span>
              <span className="hpreview">
                {pv.lines.map((l, k) => (
                  <span className="hline" key={k}>
                    {segments(l.text, l.base, ranges).map((s, j) =>
                      s.hit ? <mark key={j}>{s.text}</mark> : <span key={j}>{s.text}</span>,
                    )}
                  </span>
                ))}
                {(pv.before > 0 || pv.after > 0) && (
                  <span className="hline dim">
                    {pv.before > 0 ? `${pv.before} line${pv.before === 1 ? '' : 's'} above, ` : ''}
                    {pv.after > 0 ? `${pv.after} more line${pv.after === 1 ? '' : 's'}` : ''}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
