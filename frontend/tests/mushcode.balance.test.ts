import { checkBalance, matchBracketAt } from '../src/lib/mushcode';
import { rng, randomString, SOFTCODE_ALPHABET } from './mushcode.helpers';

const summary = (code: string, mode?: 'code' | 'lenient'): string[] =>
  checkBalance(code, { mode }).map((i) => `${i.kind}@${i.index}${i.expected ? ' want ' + i.expected : ''}`);

describe('checkBalance (code mode)', () => {
  it.each([
    ['', []],
    ['add(1,2)', []],
    ['[add(1,2)]', []],
    ['{a,[b(c)]}', []],
    ['plain text', []],
    ['add(1,2', ['unclosed@3 want )']],
    ['[add(1,2)', ['unclosed@0 want ]']],
    ['{a', ['unclosed@0 want }']],
    ['add(1,2))', ['unmatched@8']],
    ['a]', ['unmatched@1']],
    ['}', ['unmatched@0']],
    ['[add(1,2]', ['mismatch@8 want )']],
    ['(]', ['unclosed@0 want )', 'unmatched@1']],
    ['[(]', ['mismatch@2 want )']],
    ['{[}]', ['mismatch@2 want ]', 'unmatched@3']],
    ['f(a,g(b', ['unclosed@1 want )', 'unclosed@5 want )']],
  ])('%j', (code, want) => {
    expect(summary(code)).toEqual(want);
  });
  it('honours backslash escapes', () => {
    expect(summary('add(1\\),2)')).toEqual([]);
    expect(summary('\\(')).toEqual([]);
    expect(summary('\\\\(')).toEqual(['unclosed@2 want )']);
    expect(summary('a\\]')).toEqual([]);
  });
  it('honours %-escapes', () => {
    expect(summary('say %(hi%)')).toEqual([]);
    expect(summary('add(1,2%))')).toEqual([]);
    expect(summary('%[x')).toEqual([]);
    expect(summary('%{')).toEqual([]);
  });
  it('ignores brackets in patterns and comments', () => {
    expect(summary('&C me=$go (*:say hi')).toEqual([]);
    expect(summary('@@ this (is not closed\nadd(1,2)')).toEqual([]);
  });
  it('reports 1-based line and column', () => {
    const issues = checkBalance('add(1,\n  mul(2,3)\nfoo(');
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ kind: 'unclosed', index: 3, line: 1, col: 4 });
    expect(issues[1]).toMatchObject({ kind: 'unclosed', line: 3, col: 4 });
    expect(issues[1].message).toMatch(/Unclosed '\('/);
  });
  it('never throws on random input', () => {
    const r = rng(7);
    for (let i = 0; i < 3000; i++) {
      const s = randomString(r, SOFTCODE_ALPHABET, 50);
      expect(Array.isArray(checkBalance(s))).toBe(true);
      expect(Array.isArray(checkBalance(s, { mode: 'lenient' }))).toBe(true);
    }
  });
});

describe('checkBalance (lenient mode)', () => {
  it('tolerates smileys and prose parens', () => {
    expect(summary('say hello :)', 'lenient')).toEqual([]);
    expect(summary('say hello :(', 'lenient')).toEqual([]);
    expect(summary('say (see below) ok', 'lenient')).toEqual([]);
    expect(summary('emote grins :) and waves :)', 'lenient')).toEqual([]);
  });
  it('still reports real code problems', () => {
    expect(summary('say [add(1,2]', 'lenient')).toEqual(['mismatch@12 want )']);
    expect(summary('say add(1,2', 'lenient')).toEqual(['unclosed@7 want )']);
    expect(summary('say [add(1,2))]', 'lenient')).toEqual(['unmatched@13']);
    expect(summary('say {oops', 'lenient')).toEqual(['unclosed@4 want }']);
  });
  it('code mode flags the same smiley', () => {
    expect(summary('say hello :)', 'code')).toEqual(['unmatched@11']);
  });
});

describe('matchBracketAt', () => {
  const code = 'a[add(1,{x})]b';
  it('matches from the char after the cursor', () => {
    expect(matchBracketAt(code, 1)).toEqual({ open: 1, close: 12 });
    expect(matchBracketAt(code, 5)).toEqual({ open: 5, close: 11 });
    expect(matchBracketAt(code, 8)).toEqual({ open: 8, close: 10 });
  });
  it('falls back to the char before the cursor', () => {
    expect(matchBracketAt(code, 13)).toEqual({ open: 1, close: 12 });
    expect(matchBracketAt(code, 11)).toEqual({ open: 5, close: 11 });
  });
  it('returns null for non-brackets, unmatched and mismatched brackets, bad indexes', () => {
    expect(matchBracketAt(code, 0)).toBeNull();
    expect(matchBracketAt('add(1', 3)).toBeNull();
    expect(matchBracketAt('(]', 0)).toBeNull();
    expect(matchBracketAt(code, -5)).toBeNull();
    expect(matchBracketAt(code, 99)).toBeNull();
    expect(matchBracketAt('', 0)).toBeNull();
  });
  it('ignores escaped brackets', () => {
    expect(matchBracketAt('a\\(b)', 2)).toBeNull();
    expect(matchBracketAt('(a\\)', 0)).toBeNull();
  });
});
