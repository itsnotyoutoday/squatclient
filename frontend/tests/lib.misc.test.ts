import { describe, expect, it } from 'vitest';
import { INITIAL_PAUSE, isAtBottom, pauseReducer } from '../src/lib/pause';
import { findMatches } from '../src/lib/search';
import { humanizeReason } from '../src/lib/humanize';
import { LineBuffer } from '../src/state/buffer';
import type { Line } from '../src/api/types';

const line = (seq: number, text = `l${seq}`): Line => ({
  session: 's',
  seq,
  ts: 0,
  kind: 'game',
  spans: [{ s: text }],
});

describe('pause-on-scroll logic', () => {
  it('detects bottom within a threshold', () => {
    expect(isAtBottom({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 })).toBe(true);
    expect(isAtBottom({ scrollTop: 899, clientHeight: 100, scrollHeight: 1000 })).toBe(true);
    expect(isAtBottom({ scrollTop: 500, clientHeight: 100, scrollHeight: 1000 })).toBe(false);
  });
  it('pauses on upward scroll, counts unread, resumes at the bottom', () => {
    let s = pauseReducer(INITIAL_PAUSE, { type: 'scroll', atBottom: false, movedUp: true, enabled: true });
    expect(s).toEqual({ paused: true, unread: 0 });
    s = pauseReducer(s, { type: 'lines', count: 3 });
    s = pauseReducer(s, { type: 'lines', count: 2 });
    expect(s.unread).toBe(5);
    s = pauseReducer(s, { type: 'scroll', atBottom: false, movedUp: false, enabled: true });
    expect(s.paused).toBe(true);
    s = pauseReducer(s, { type: 'scroll', atBottom: true, movedUp: false, enabled: true });
    expect(s).toEqual(INITIAL_PAUSE);
  });
  it('does not pause when content merely grew (not moved up)', () => {
    expect(
      pauseReducer(INITIAL_PAUSE, { type: 'scroll', atBottom: false, movedUp: false, enabled: true }),
    ).toBe(INITIAL_PAUSE);
  });
  it('never pauses when disabled, and clears an existing pause', () => {
    expect(
      pauseReducer(INITIAL_PAUSE, { type: 'scroll', atBottom: false, movedUp: true, enabled: false }),
    ).toBe(INITIAL_PAUSE);
    expect(
      pauseReducer(
        { paused: true, unread: 4 },
        { type: 'scroll', atBottom: false, movedUp: true, enabled: false },
      ),
    ).toEqual(INITIAL_PAUSE);
  });
  it('ignores lines while following; jump resets', () => {
    expect(pauseReducer(INITIAL_PAUSE, { type: 'lines', count: 9 })).toBe(INITIAL_PAUSE);
    expect(pauseReducer({ paused: true, unread: 4 }, { type: 'jump' })).toEqual(INITIAL_PAUSE);
  });
});

describe('LineBuffer', () => {
  it('appends in order and de-duplicates by seq', () => {
    const b = new LineBuffer(1000);
    expect(b.merge([line(1), line(2)])).toBe(2);
    expect(b.merge([line(2), line(3)])).toBe(1);
    expect(b.merge([line(3)])).toBe(0);
    expect(b.lines.map((l) => l.seq)).toEqual([1, 2, 3]);
  });
  it('merges older history in front, sorted, without duplicates', () => {
    const b = new LineBuffer(1000);
    b.merge([line(5), line(6)]);
    expect(b.merge([line(3), line(4), line(5)])).toBe(2);
    expect(b.lines.map((l) => l.seq)).toEqual([3, 4, 5, 6]);
  });
  it('drops the oldest lines past the cap', () => {
    const b = new LineBuffer(100);
    b.merge(Array.from({ length: 300 }, (_, i) => line(i + 1)));
    expect(b.lines.length).toBeLessThanOrEqual(105);
    expect(b.last).toBe(300);
    expect(b.first).toBeGreaterThan(190);
    expect(b.droppedFront).toBe(300 - b.lines.length);
  });
  it('adds local lines with fractional seq after the newest line', () => {
    const b = new LineBuffer(1000);
    b.merge([line(1), line(2)]);
    const l = b.addLocal('s', 'notice');
    expect(l.seq).toBeGreaterThan(2);
    expect(l.seq).toBeLessThan(3);
    expect(b.merge([line(3)])).toBe(1);
  });
});

describe('search matching', () => {
  const lines = [line(1, 'Hello World'), line(2, 'hello again'), line(3, 'nothing')];
  it('is case-insensitive by default and literal (not regex)', () => {
    expect(findMatches(lines, 'hello', { regex: false, caseSensitive: false })).toHaveLength(2);
    expect(findMatches(lines, 'hello', { regex: false, caseSensitive: true })).toHaveLength(1);
    expect(findMatches([line(1, 'a.b')], '.', { regex: false, caseSensitive: false })).toHaveLength(1);
  });
  it('supports regex and tolerates invalid patterns', () => {
    expect(findMatches(lines, 'h.llo', { regex: true, caseSensitive: false })).toHaveLength(2);
    expect(findMatches(lines, '(', { regex: true, caseSensitive: false })).toEqual([]);
    expect(findMatches(lines, '', { regex: false, caseSensitive: false })).toEqual([]);
  });
  it('returns offsets', () => {
    expect(findMatches(lines, 'World', { regex: false, caseSensitive: true })).toEqual([
      { seq: 1, start: 6, end: 11 },
    ]);
  });
});

describe('humanizeReason', () => {
  it('humanises known and unknown reasons', () => {
    expect(humanizeReason('remote_closed')).toMatch(/server closed/i);
    expect(humanizeReason('tls_error')).toMatch(/TLS/);
    expect(humanizeReason('weird_thing')).toBe('Weird thing');
    expect(humanizeReason(undefined)).toMatch(/ended/i);
  });
});
