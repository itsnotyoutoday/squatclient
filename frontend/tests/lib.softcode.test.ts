import { describe, expect, it, vi } from 'vitest';
import { currentChunk, indentSelection, lineCol, prepareBlock } from '../src/lib/softcode';
import { sendBlock } from '../src/lib/blocksender';
import { clampInputHeight, heightBounds, lineHeightPx } from '../src/lib/inputsize';
import { matchRanges, preview, rowHeight, segments } from '../src/lib/historyview';

const on = { join: true, stripBlank: true };
const off = { join: false, stripBlank: false };

describe('prepareBlock', () => {
  it('empty and whitespace-only input sends nothing', () => {
    expect(prepareBlock('', on)).toEqual([]);
    expect(prepareBlock('  \n\t\n', on)).toEqual([]);
    expect(prepareBlock('  \n\n', off)).toEqual([]);
  });
  it('plain lines pass through', () => {
    expect(prepareBlock('look\nnorth', on)).toEqual(['look', 'north']);
  });
  it('joins indented continuation lines directly, stripping the indent', () => {
    expect(prepareBlock('&F obj=[add(1,\n  2)]\nsay hi', on)).toEqual(['&F obj=[add(1,2)]', 'say hi']);
    expect(prepareBlock('@set me=a\n    b\n\tc\n  d', on)).toEqual(['@set me=ab' + 'c' + 'd']);
  });
  it('no space is inserted: the author adds it if needed', () => {
    expect(prepareBlock('say one\n   two', on)).toEqual(['say onetwo']);
    expect(prepareBlock('say one \n  two', on)).toEqual(['say onetwo']); // trailing space is stripped too
  });
  it('without join, lines are sent as typed apart from trailing whitespace', () => {
    expect(prepareBlock('a  \n  b\t', { join: false, stripBlank: true })).toEqual(['a', '  b']);
  });
  it('blank lines: dropped when stripping, kept (and separating) when not', () => {
    expect(prepareBlock('a\n\n\nb', on)).toEqual(['a', 'b']);
    expect(prepareBlock('a\n\nb', { join: true, stripBlank: false })).toEqual(['a', '', 'b']);
    expect(prepareBlock('a\n\n  b', { join: true, stripBlank: false })).toEqual(['a', '', 'b']);
  });
  it('blank and comment lines do not interrupt a continuation when stripping', () => {
    expect(prepareBlock('&F o=x\n\n  @@ note\n  y', on)).toEqual(['&F o=xy']);
  });
  it('@@ comment-only lines are dropped (also indented); @@ after code is kept', () => {
    expect(prepareBlock('@@ hello\n  @@ more\nsay hi @@ not a comment line', on)).toEqual([
      'say hi @@ not a comment line',
    ]);
    expect(prepareBlock('@@ keep\nsay x', { join: true, stripBlank: false })).toEqual(['@@ keep', 'say x']);
  });
  it('handles CRLF and lone CR', () => {
    expect(prepareBlock('a\r\n  b\r\nc\rd', on)).toEqual(['ab', 'c', 'd']);
  });
  it('a leading indented first line has nothing to continue and is trimmed', () => {
    expect(prepareBlock('   first\nsecond', on)).toEqual(['first', 'second']);
  });
  it('indented whitespace-only lines count as blank, not continuations', () => {
    expect(prepareBlock('a\n   \n  b', { join: true, stripBlank: false })).toEqual(['a', '', 'b']);
  });
  it('unicode survives', () => {
    expect(prepareBlock('say héllo\n  wörld ✓', on)).toEqual(['say héllowörld ✓']);
  });
});

describe('currentChunk / lineCol / indentSelection', () => {
  const t = '&F o=a\n  b\n  c\nsay hi\n\nlook';
  it('selection wins', () => {
    expect(currentChunk(t, 1, 4, true)).toBe('F o');
  });
  it('current physical line without join', () => {
    expect(currentChunk(t, t.indexOf('b'), t.indexOf('b'), false)).toBe('  b');
  });
  it('with join the whole logical line is taken from any of its lines', () => {
    const want = '&F o=a\n  b\n  c';
    expect(currentChunk(t, 2, 2, true)).toBe(want);
    expect(currentChunk(t, t.indexOf('b'), t.indexOf('b'), true)).toBe(want);
    expect(currentChunk(t, t.indexOf('c'), t.indexOf('c'), true)).toBe(want);
    expect(currentChunk(t, t.indexOf('say'), t.indexOf('say'), true)).toBe('say hi');
    expect(currentChunk(t, t.length, t.length, true)).toBe('look');
  });
  it('lineCol is 1-based', () => {
    expect(lineCol('ab\ncd', 0)).toEqual({ line: 1, col: 1 });
    expect(lineCol('ab\ncd', 4)).toEqual({ line: 2, col: 2 });
    expect(lineCol('', 0)).toEqual({ line: 1, col: 1 });
  });
  it('Tab inserts two spaces; a selection indents every line; Shift+Tab outdents', () => {
    expect(indentSelection('ab', 1, 1, false)).toEqual({ text: 'a  b', start: 3, end: 3 });
    const r = indentSelection('a\nb\nc', 0, 3, false);
    expect(r?.text).toBe('  a\n  b\nc');
    const o = indentSelection('  a\n b\n  c', 0, 7, true);
    expect(o?.text).toBe('a\nb\n  c');
    expect(indentSelection('abc', 1, 1, true)).toBeNull();
    expect(indentSelection('  abc', 3, 3, true)?.text).toBe('abc');
  });
});

describe('sendBlock', () => {
  it('sends everything at once without a delay', async () => {
    const out: string[] = [];
    const b = sendBlock(['a', 'b', 'c'], 0, (l) => out.push(l));
    expect(out).toEqual(['a', 'b', 'c']);
    expect(await b.done).toEqual({ sent: 3, total: 3, cancelled: false });
  });
  it('paces lines and reports progress', async () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const prog: number[] = [];
    const b = sendBlock(
      ['a', 'b', 'c'],
      100,
      (l) => out.push(l),
      (p) => prog.push(p.sent),
    );
    expect(out).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(100);
    expect(out).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(100);
    expect(await b.done).toEqual({ sent: 3, total: 3, cancelled: false });
    expect(prog).toEqual([1, 2, 3]);
    vi.useRealTimers();
  });
  it('cancel stops the rest', async () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const b = sendBlock(['a', 'b', 'c'], 100, (l) => out.push(l));
    await vi.advanceTimersByTimeAsync(100);
    b.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(out).toEqual(['a', 'b']);
    expect(await b.done).toEqual({ sent: 2, total: 3, cancelled: true });
    vi.useRealTimers();
  });
  it('a failing send stops the block; empty input finishes at once', async () => {
    const b = sendBlock(['a', 'b'], 0, () => {
      throw new Error('x');
    });
    expect((await b.done).cancelled).toBe(true);
    expect(await sendBlock([], 50, () => undefined).done).toEqual({ sent: 0, total: 0, cancelled: false });
  });
});

describe('input sizing', () => {
  it('bounds: one line .. 70% of the window', () => {
    const lh = lineHeightPx(14);
    expect(heightBounds(1000, 14)).toEqual({ min: lh + 10, max: 700 });
    expect(heightBounds(10, 14).max).toBe(lh + 10); // never below the minimum
  });
  it('clamps both ways and tolerates junk', () => {
    expect(clampInputHeight(1, 1000, 14)).toBe(heightBounds(1000, 14).min);
    expect(clampInputHeight(99999, 1000, 14)).toBe(700);
    expect(clampInputHeight(300.4, 1000, 14)).toBe(300);
    expect(clampInputHeight(NaN, 1000, 14)).toBe(heightBounds(1000, 14).min);
  });
});

describe('history view helpers', () => {
  it('matchRanges: substring, case, regex, invalid regex', () => {
    expect(matchRanges('Look look', 'look', { regex: false, caseSensitive: false })).toEqual([
      [0, 4],
      [5, 9],
    ]);
    expect(matchRanges('Look look', 'look', { regex: false, caseSensitive: true })).toEqual([[5, 9]]);
    expect(matchRanges('a1 b22', '\\d+', { regex: true, caseSensitive: false })).toEqual([
      [1, 2],
      [4, 6],
    ]);
    expect(matchRanges('x', '(', { regex: true, caseSensitive: false })).toEqual([]);
    expect(matchRanges('x', '', { regex: false, caseSensitive: false })).toEqual([]);
  });
  it('segments split around hits', () => {
    expect(segments('say hello', 0, [[4, 9]])).toEqual([
      { text: 'say ', hit: false },
      { text: 'hello', hit: true },
    ]);
    expect(segments('b', 4, [[0, 3]])).toEqual([{ text: 'b', hit: false }]);
  });
  it('preview shows 3 lines, or starts at the first far-down match', () => {
    const text = ['a', 'b', 'c', 'd', 'needle', 'f'].join('\n');
    expect(preview(text, []).lines.map((l) => l.text)).toEqual(['a', 'b', 'c']);
    expect(preview(text, []).after).toBe(3);
    const r = matchRanges(text, 'needle', { regex: false, caseSensitive: false });
    const p = preview(text, r);
    expect(p.lines[0].text).toBe('needle');
    expect(p.before).toBe(4);
    expect(rowHeight('one')).toBeLessThan(rowHeight(text));
  });
});
