import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getBuffer, useSessions, useSettings, useUi } from '../../state/stores';
import { useRenderOptions, useRenderTheme } from '../../state/hooks';
import { INITIAL_PAUSE, isAtBottom, pauseReducer } from '../../lib/pause';
import type { PauseEvent, PauseState } from '../../lib/pause';
import type { HighlightRange } from '../../lib/runs';
import { LineRow } from './LineRow';
import { registerOutput } from './handle';
import { measureCells } from '../../lib/measure';
import { useSearchHighlights } from '../search/search-state';
import { useControllerRef } from '../../state/controller-context';

const OVERSCAN = 20;

export function OutputPane({ sessionId }: { sessionId: string }) {
  const controller = useControllerRef();
  const version = useSessions((s) => s.versions[sessionId] ?? 0);
  const timestamps = useSettings((s) => s.settings.timestamps);
  const pauseEnabled = useSettings((s) => s.settings.pauseOnScroll);
  const fontSize = useSettings((s) => s.settings.fontSize);
  const theme = useRenderTheme();
  const opts = useRenderOptions();
  const highlights = useSearchHighlights(sessionId);
  const buffer = getBuffer(sessionId);
  const lines = buffer.lines;
  const parentRef = useRef<HTMLDivElement>(null);
  const [pause, setPause] = useState<PauseState>(INITIAL_PAUSE);
  const pauseRef = useRef<PauseState>(INITIAL_PAUSE);
  const lastTop = useRef(0);
  const prevCount = useRef(lines.length);
  const prevDropped = useRef(buffer.droppedFront);
  const loadingOlder = useRef(false);
  const lineHeight = Math.round(fontSize * 1.4);

  const dispatch = useCallback(
    (e: PauseEvent) => {
      const next = pauseReducer(pauseRef.current, e);
      if (next === pauseRef.current) return;
      pauseRef.current = next;
      setPause(next);
      useSessions.getState().setPaused(sessionId, next);
    },
    [sessionId],
  );

  // New session shown: reset pause state.
  useEffect(() => {
    pauseRef.current = INITIAL_PAUSE;
    setPause(INITIAL_PAUSE);
    useSessions.getState().setPaused(sessionId, INITIAL_PAUSE);
    prevCount.current = getBuffer(sessionId).lines.length;
    prevDropped.current = getBuffer(sessionId).droppedFront;
  }, [sessionId]);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => lineHeight,
    overscan: OVERSCAN,
    getItemKey: (i) => lines[i]?.seq ?? i,
  });

  const scrollToBottom = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    if (lines.length) virtualizer.scrollToIndex(lines.length - 1, { align: 'end' });
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, [lines.length, virtualizer]);

  // Follow output unless paused; count unread while paused.
  useLayoutEffect(() => {
    const added = lines.length - prevCount.current + (buffer.droppedFront - prevDropped.current);
    prevCount.current = lines.length;
    prevDropped.current = buffer.droppedFront;
    if (pauseRef.current.paused) {
      if (added > 0) dispatch({ type: 'lines', count: added });
    } else {
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // Initial mount / session switch: start at the live end.
  useLayoutEffect(() => {
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const loadOlder = useCallback(async () => {
    if (!controller || loadingOlder.current || buffer.exhausted) return 0;
    loadingOlder.current = true;
    const oldFirst = buffer.first;
    try {
      const added = await controller.loadOlder(sessionId);
      if (added > 0) {
        const idx = getBuffer(sessionId).lines.findIndex((l) => l.seq >= oldFirst);
        if (idx > 0) requestAnimationFrame(() => virtualizer.scrollToIndex(idx, { align: 'start' }));
      }
      return added;
    } finally {
      loadingOlder.current = false;
    }
  }, [controller, buffer, sessionId, virtualizer]);

  const onScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const movedUp = el.scrollTop < lastTop.current - 1;
    lastTop.current = el.scrollTop;
    dispatch({ type: 'scroll', atBottom: isAtBottom(el, 6), movedUp, enabled: pauseEnabled });
    if (el.scrollTop < lineHeight * 30) void loadOlder();
  }, [dispatch, pauseEnabled, loadOlder, lineHeight]);

  useEffect(() => {
    registerOutput({
      pageUp: () => parentRef.current?.scrollBy({ top: -(parentRef.current.clientHeight * 0.9) }),
      pageDown: () => parentRef.current?.scrollBy({ top: parentRef.current.clientHeight * 0.9 }),
      jumpLive: () => {
        dispatch({ type: 'jump' });
        scrollToBottom();
      },
      scrollToSeq: async (seq: number) => {
        for (
          let guard = 0;
          guard < 50 && getBuffer(sessionId).first > seq && !getBuffer(sessionId).exhausted;
          guard++
        ) {
          if ((await loadOlder()) === 0) break;
        }
        const idx = getBuffer(sessionId).lines.findIndex((l) => l.seq >= seq);
        if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'center' });
      },
    });
    return () => registerOutput(null);
  }, [dispatch, scrollToBottom, loadOlder, sessionId, virtualizer]);

  // Tell the engine our size (NAWS), debounced.
  const engine = useUi((s) => s.engine);
  const fontFamily = useSettings((s) => s.settings.fontFamily);
  useEffect(() => {
    const el = parentRef.current;
    if (!el || !engine || typeof ResizeObserver === 'undefined') return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        const c = measureCells(el.clientWidth, el.clientHeight, fontFamily, fontSize, lineHeight);
        if (c) void engine.resize(sessionId, c.cols, c.rows).catch(() => undefined);
      }, 250);
    });
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [engine, sessionId, fontFamily, fontSize, lineHeight]);

  const items = virtualizer.getVirtualItems();
  const style = { height: `${virtualizer.getTotalSize()}px` };
  const empty: readonly HighlightRange[] | undefined = undefined;

  return (
    <div className="output-wrap">
      <div
        ref={parentRef}
        className="output"
        role="log"
        aria-label="Game output"
        aria-live="off"
        tabIndex={0}
        onScroll={onScroll}
        data-testid="output"
        style={{ lineHeight: `${lineHeight}px` }}
      >
        <div className="output-inner" style={style}>
          {items.map((vi) => {
            const line = lines[vi.index];
            if (!line) return null;
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                data-seq={line.seq}
                ref={virtualizer.measureElement}
                className={`row k-${line.kind}${line.prompt ? ' prompt' : ''}`}
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <LineRow
                  line={line}
                  theme={theme}
                  opts={opts}
                  timestamps={timestamps}
                  highlights={highlights?.get(line.seq) ?? empty}
                />
              </div>
            );
          })}
        </div>
      </div>
      {pause.paused && (
        <button type="button" className="jump-live" onClick={() => getOutputJump(dispatch, scrollToBottom)}>
          {pause.unread > 0 ? `${pause.unread} new line${pause.unread === 1 ? '' : 's'}` : 'Paused'} &middot;
          jump to live (End)
        </button>
      )}
    </div>
  );
}

function getOutputJump(dispatch: (e: PauseEvent) => void, scrollToBottom: () => void): void {
  dispatch({ type: 'jump' });
  scrollToBottom();
}
