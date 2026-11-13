/** TF-style "more" pause logic: stop following output while the user is scrolled up. */

export interface PauseState {
  paused: boolean;
  unread: number; // lines that arrived while paused
}

export const INITIAL_PAUSE: PauseState = { paused: false, unread: 0 };

export interface ScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export const isAtBottom = (m: ScrollMetrics, threshold = 4): boolean =>
  m.scrollHeight - m.scrollTop - m.clientHeight <= threshold;

export type PauseEvent =
  | { type: 'scroll'; atBottom: boolean; movedUp: boolean; enabled: boolean }
  | { type: 'lines'; count: number }
  | { type: 'jump' };

export function pauseReducer(s: PauseState, e: PauseEvent): PauseState {
  switch (e.type) {
    case 'scroll':
      if (!e.enabled) return s.paused ? INITIAL_PAUSE : s;
      if (e.atBottom) return s.paused || s.unread ? INITIAL_PAUSE : s;
      // Content growth can make "not at bottom" momentarily true; only a real upward move pauses.
      if (e.movedUp && !s.paused) return { paused: true, unread: 0 };
      return s;
    case 'lines':
      return s.paused && e.count > 0 ? { ...s, unread: s.unread + e.count } : s;
    case 'jump':
      return INITIAL_PAUSE;
  }
}
