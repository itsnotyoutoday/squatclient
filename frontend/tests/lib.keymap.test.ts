import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYMAP,
  applyCommand,
  handleKey,
  initialEdit,
  insertText,
  keyName,
  pasteToLines,
  pushHistory,
} from '../src/lib/keymap';
import type { EditState } from '../src/lib/keymap';

const st = (text: string, cursor = text.length): EditState => ({ ...initialEdit(text), cursor });
const press = (s: EditState, key: string, hist: string[] = []): EditState => {
  const r = handleKey(s, key, hist);
  if (!r) throw new Error(`unbound key ${key}`);
  return r.state;
};

describe('keyName', () => {
  it('normalises modifiers and arrows', () => {
    expect(keyName({ key: 'a', ctrlKey: true })).toBe('C-a');
    expect(keyName({ key: 'A', ctrlKey: true })).toBe('C-a');
    expect(keyName({ key: 'ArrowUp' })).toBe('Up');
    expect(keyName({ key: 'Enter', shiftKey: true })).toBe('S-Enter');
    expect(keyName({ key: 'b', altKey: true })).toBe('M-b');
    expect(keyName({ key: '∫', altKey: true, code: 'KeyB' })).toBe('M-b');
    expect(keyName({ key: 'B', shiftKey: true })).toBe('b');
  });
});

describe('editing keys', () => {
  it('C-a / C-e / Home / End', () => {
    expect(press(st('hello', 3), 'C-a').cursor).toBe(0);
    expect(press(st('hello', 3), 'C-e').cursor).toBe(5);
    expect(press(st('hello', 3), 'Home').cursor).toBe(0);
    expect(press(st('hello', 3), 'End').cursor).toBe(5);
  });
  it('C-a / C-e work per line in multi-line text', () => {
    expect(press(st('ab\ncde', 5), 'C-a').cursor).toBe(3);
    expect(press(st('ab\ncde', 1), 'C-e').cursor).toBe(2);
  });
  it('C-b / C-f move by character, clamped', () => {
    expect(press(st('abc', 2), 'C-b').cursor).toBe(1);
    expect(press(st('abc', 0), 'C-b').cursor).toBe(0);
    expect(press(st('abc', 1), 'C-f').cursor).toBe(2);
    expect(press(st('abc', 3), 'C-f').cursor).toBe(3);
  });
  it('moves over surrogate pairs and combining marks as one unit', () => {
    const t = 'a\u{1F600}éb';
    expect(press(st(t, 1), 'C-f').cursor).toBe(3);
    expect(press(st(t, 5), 'C-b').cursor).toBe(3);
    expect(press(st(t, 3), 'C-f').cursor).toBe(5);
  });
  it('M-b / M-f word motion', () => {
    expect(press(st('foo bar baz', 11), 'M-b').cursor).toBe(8);
    expect(press(st('foo bar baz', 8), 'M-b').cursor).toBe(4);
    expect(press(st('foo bar baz', 0), 'M-f').cursor).toBe(3);
    expect(press(st('foo bar baz', 3), 'M-f').cursor).toBe(7);
    expect(press(st('foo, bar', 8), 'M-b').cursor).toBe(5);
  });
  it('Backspace / Delete / C-d', () => {
    expect(press(st('abc', 2), 'Backspace')).toMatchObject({ text: 'ac', cursor: 1 });
    expect(press(st('abc', 0), 'Backspace')).toMatchObject({ text: 'abc', cursor: 0 });
    expect(press(st('abc', 1), 'Delete')).toMatchObject({ text: 'ac', cursor: 1 });
    expect(press(st('abc', 1), 'C-d')).toMatchObject({ text: 'ac', cursor: 1 });
    expect(press(st('abc', 3), 'C-d')).toMatchObject({ text: 'abc' });
  });
  it('C-w kills the previous whitespace-delimited word into the kill ring', () => {
    const s = press(st('say hello world'), 'C-w');
    expect(s).toMatchObject({ text: 'say hello ', cursor: 10, kill: 'world' });
    expect(press(st('say hello  ', 11), 'C-w')).toMatchObject({ text: 'say ', kill: 'hello  ' });
    expect(press(st('x', 0), 'C-w').text).toBe('x');
  });
  it('C-k kills to end of line, C-u kills the whole line', () => {
    expect(press(st('hello world', 5), 'C-k')).toMatchObject({ text: 'hello', cursor: 5, kill: ' world' });
    expect(press(st('hello', 5), 'C-k').kill).toBe('');
    expect(press(st('hello world', 5), 'C-u')).toMatchObject({ text: '', cursor: 0, kill: 'hello world' });
    expect(press(st('ab\ncd', 1), 'C-k')).toMatchObject({ text: 'a\ncd', kill: 'b' });
  });
  it('C-y yanks the kill ring at the cursor', () => {
    const s = press(st('foo bar'), 'C-w');
    expect(press({ ...s, cursor: 0 }, 'C-y')).toMatchObject({ text: 'barfoo ', cursor: 3 });
    expect(press(st('abc'), 'C-y').text).toBe('abc');
  });
  it('M-d kills word forward', () => {
    expect(press(st('foo bar', 0), 'M-d')).toMatchObject({ text: ' bar', kill: 'foo' });
  });
  it('C-t transposes characters', () => {
    expect(press(st('abc', 1), 'C-t')).toMatchObject({ text: 'bac', cursor: 2 });
    expect(press(st('abc', 2), 'C-t')).toMatchObject({ text: 'acb', cursor: 3 });
    expect(press(st('abc', 3), 'C-t')).toMatchObject({ text: 'acb', cursor: 3 });
    expect(press(st('a', 1), 'C-t').text).toBe('a');
  });
  it('Escape clears but keeps the kill ring', () => {
    const s = press({ ...st('abc'), kill: 'k' }, 'Escape');
    expect(s).toMatchObject({ text: '', cursor: 0, kill: 'k' });
  });
  it('Tab inserts a tab', () => {
    expect(press(st('ab', 1), 'Tab')).toMatchObject({ text: 'a\tb', cursor: 2 });
  });
  it('Enter submits and clears; Shift+Enter inserts a newline', () => {
    const r = handleKey(st('look'), 'Enter', []);
    expect(r?.submit).toBe('look');
    expect(r?.state.text).toBe('');
    expect(press(st('ab', 1), 'S-Enter')).toMatchObject({ text: 'a\nb', cursor: 2 });
  });
  it('unbound keys return null so the browser can insert text', () => {
    expect(handleKey(st(''), 'x', [])).toBeNull();
    expect(handleKey(st(''), 'C-q', [])).toBeNull();
  });
  it('the default keymap binds every documented key', () => {
    for (const k of [
      'C-a',
      'C-e',
      'C-b',
      'C-f',
      'M-b',
      'M-f',
      'C-w',
      'C-k',
      'C-u',
      'C-y',
      'C-d',
      'C-t',
      'C-p',
      'C-n',
      'Up',
      'Down',
      'Enter',
      'S-Enter',
      'Tab',
      'Escape',
      'Backspace',
      'Delete',
    ])
      expect(DEFAULT_KEYMAP[k], k).toBeDefined();
  });
  it('is rebindable', () => {
    const r = handleKey(st('abc', 3), 'C-q', [], { 'C-q': 'home' });
    expect(r?.state.cursor).toBe(0);
  });
  it('insertText and pasteToLines', () => {
    expect(insertText(st('ac', 1), 'b')).toMatchObject({ text: 'abc', cursor: 2 });
    const r = pasteToLines(st('x', 1), 'one\ntwo\r\nthree\n');
    expect(r.lines).toEqual(['xone', 'two', 'three']);
    expect(r.state.text).toBe('');
    expect(pasteToLines(st('', 0), 'a\n\nb').lines).toEqual(['a', '', 'b']);
  });
});

describe('history', () => {
  const hist = ['look', 'say hi', 'say bye', 'north'];
  it('Up/Down walk history and restore the draft', () => {
    let s = st('draft');
    s = press(s, 'C-p', hist.slice());
    // prefix search: nothing starts with "draft"
    expect(s.text).toBe('draft');
    s = st('');
    s = press(s, 'Up', hist);
    expect(s.text).toBe('north');
    s = press(s, 'Up', hist);
    expect(s.text).toBe('say bye');
    s = press(s, 'Down', hist);
    expect(s.text).toBe('north');
    s = press(s, 'Down', hist);
    expect(s.text).toBe('');
    expect(s.nav.index).toBe(-1);
  });
  it('restores the typed draft after navigating down past the newest entry', () => {
    let s = st('');
    s = press(s, 'C-p', hist);
    s = press(s, 'C-n', hist);
    expect(s.text).toBe('');
  });
  it('prefix search matches only entries starting with the typed prefix', () => {
    let s = st('say');
    s = press(s, 'Up', hist);
    expect(s.text).toBe('say bye');
    s = press(s, 'Up', hist);
    expect(s.text).toBe('say hi');
    s = press(s, 'Up', hist);
    expect(s.text).toBe('say hi'); // no older match: stays
    s = press(s, 'Down', hist);
    expect(s.text).toBe('say bye');
    s = press(s, 'Down', hist);
    expect(s.text).toBe('say');
  });
  it('Ctrl-N with no navigation does nothing', () => {
    expect(press(st('abc'), 'C-n', hist).text).toBe('abc');
  });
  it('editing resets navigation', () => {
    let s = press(st(''), 'Up', hist);
    s = press(s, 'Backspace', hist);
    expect(s.nav.index).toBe(-1);
  });
  it('Up/Down move between lines of multi-line input before touching history', () => {
    let s = st('ab\ncd', 4);
    s = press(s, 'Up', hist);
    expect(s).toMatchObject({ text: 'ab\ncd', cursor: 1 });
    s = press(s, 'Down', hist);
    expect(s.cursor).toBe(4);
  });
  it('pushHistory skips blanks and consecutive duplicates and caps', () => {
    expect(pushHistory(['a'], 'a')).toEqual(['a']);
    expect(pushHistory(['a'], '  ')).toEqual(['a']);
    expect(pushHistory(['a'], 'b')).toEqual(['a', 'b']);
    expect(pushHistory(['a', 'b'], 'c', 2)).toEqual(['b', 'c']);
  });
  it('applyCommand is pure', () => {
    const s = st('abc');
    applyCommand(s, 'kill-line');
    expect(s.text).toBe('abc');
  });
});
