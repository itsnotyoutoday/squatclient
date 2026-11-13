import {
  tokenize,
  classFor,
  styledRanges,
  isKnownFunction,
  FUNCTION_NAMES,
  FUNCTION_SOURCES,
} from '../src/lib/mushcode';
import type { TokenKind } from '../src/lib/mushcode';
import { rng, randomString, SOFTCODE_ALPHABET } from './mushcode.helpers';

const kinds = (code: string, skipText = true): string[] =>
  tokenize(code)
    .filter((t) => !skipText || t.kind !== 'text')
    .map((t) => `${t.kind}:${t.text}`);

describe('tokenize: classes', () => {
  it('functions: known vs unknown, case-insensitive, name only', () => {
    expect(kinds('add(1,2)')).toEqual([
      'function:add',
      'paren:(',
      'number:1',
      'comma:,',
      'number:2',
      'paren:)',
    ]);
    expect(kinds('ADD(1)')[0]).toBe('function:ADD');
    expect(kinds('myGlobalFn(x)')[0]).toBe('unknownFunction:myGlobalFn');
    // an identifier not directly before "(" is plain text
    expect(kinds('add (1)')).toEqual(['paren:(', 'number:1', 'paren:)']);
    expect(kinds('hello world')).toEqual([]);
  });
  it('custom isKnown', () => {
    const t = tokenize('foo(bar(1))', { isKnown: (n) => n === 'bar' });
    expect(t.filter((x) => x.kind.endsWith('unction')).map((x) => `${x.kind}:${x.text}`)).toEqual([
      'unknownFunction:foo',
      'function:bar',
    ]);
  });
  it('brackets, braces, parens, commas, semicolons', () => {
    expect(kinds('[a]{b}(c),;')).toEqual([
      'bracket:[',
      'bracket:]',
      'brace:{',
      'brace:}',
      'paren:(',
      'paren:)',
      'comma:,',
      'semicolon:;',
    ]);
  });
  it.each([
    ['%0', '%0'],
    ['%9', '%9'],
    ['%#', '%#'],
    ['%!', '%!'],
    ['%@', '%@'],
    ['%N', '%N'],
    ['%n', '%n'],
    ['%L', '%L'],
    ['%l', '%l'],
    ['%c', '%c'],
    ['%C', '%C'],
    ['%q0', '%q0'],
    ['%qz', '%qz'],
    ['%qA', '%qA'],
    ['%q<my var>', '%q<my var>'],
    ['%r', '%r'],
    ['%b', '%b'],
    ['%t', '%t'],
    ['%s', '%s'],
    ['%|', '%|'],
    ['%=<attr>', '%=<attr>'],
    ['%va', '%va'],
    ['%vz', '%vz'],
    ['%%', '%%'],
    ['%+', '%+'],
    ['%$', '%$'],
    ['%i0', '%i0'],
    ['%xr', '%xr'],
    ['%x<red>', '%x<red>'],
    ['##', '##'],
    ['#@', '#@'],
    ['#$', '#$'],
  ])('substitution %s', (src, text) => {
    const t = tokenize(`a ${src} b`).find((x) => x.kind === 'substitution');
    expect(t?.text).toBe(text);
  });
  it('substitution then text keeps the rest as text', () => {
    expect(kinds('%0abc')).toEqual(['substitution:%0']);
    expect(kinds('%q0x')).toEqual(['substitution:%q0']);
  });
  it('escapes: backslash and %-escaped structure', () => {
    expect(kinds('\\(\\)\\[\\{\\,\\\\')).toEqual([
      'escape:\\(',
      'escape:\\)',
      'escape:\\[',
      'escape:\\{',
      'escape:\\,',
      'escape:\\\\',
    ]);
    expect(kinds('%(%)%[%]%{%}%,%;')).toEqual([
      'escape:%(',
      'escape:%)',
      'escape:%[',
      'escape:%]',
      'escape:%{',
      'escape:%}',
      'escape:%,',
      'escape:%;',
    ]);
    // a trailing backslash is an escape of length 1
    expect(kinds('a\\')).toEqual(['escape:\\']);
  });
  it('numbers', () => {
    expect(kinds('12 -3 4.5 -0.25')).toEqual(['number:12', 'number:-3', 'number:4.5', 'number:-0.25']);
    expect(kinds('1d6 abc123 x9')).toEqual([]);
  });
  it('dbrefs', () => {
    expect(kinds('#123 #-1 #0 #lambda')).toEqual(['dbref:#123', 'dbref:#-1', 'dbref:#0', 'dbref:#lambda']);
    expect(kinds('#12abc')).toEqual([]);
  });
  it('attribute definitions at line start', () => {
    expect(kinds('&MY_ATTR obj=value')).toEqual(['attrdef:&MY_ATTR']);
    expect(kinds('say a & b')).toEqual([]);
  });
  it('@commands at command positions, with switches', () => {
    expect(kinds('@set me=x')).toEqual(['command:@set']);
    expect(kinds('@trigger/quiet me/go')).toEqual(['command:@trigger/quiet']);
    expect(kinds('@switch %0=1,@pemit me=hi;@create thing')).toEqual([
      'command:@switch',
      'substitution:%0',
      'number:1',
      'comma:,',
      'command:@pemit',
      'semicolon:;',
      'command:@create',
    ]);
    expect(kinds('{@pemit me=x}')).toEqual(['brace:{', 'command:@pemit', 'brace:}']);
    // an @ inside prose is not a command
    expect(kinds('mail bob@example.com now')).toEqual([]);
    expect(kinds('say meet @home')).toEqual([]);
  });
  it('$-command and ^-listen patterns up to the unescaped colon', () => {
    expect(kinds('&C me=$+go *:@pemit %#=x')).toEqual([
      'attrdef:&C',
      'pattern:$+go *:',
      'command:@pemit',
      'substitution:%#',
    ]);
    expect(kinds('^* says *:think hi')[0]).toBe('pattern:^* says *:');
    expect(kinds('$a\\:b:go')[0]).toBe('pattern:$a\\:b:');
    // no colon: not a pattern
    expect(kinds('$5.00 please')).toEqual(['number:5.00']);
  });
  it('@@ comments run to the end of the line', () => {
    const t = tokenize('@@ note (unbalanced\nadd(1,2)');
    expect(t[0]).toMatchObject({ kind: 'comment', text: '@@ note (unbalanced' });
    expect(t.some((x) => x.kind === 'function' && x.text === 'add')).toBe(true);
  });
  it('nesting', () => {
    expect(kinds('[add(mul(2,3),sub(9,%0))]').filter((k) => k.startsWith('function'))).toEqual([
      'function:add',
      'function:mul',
      'function:sub',
    ]);
  });
  it('word boundary after a substitution', () => {
    expect(kinds('%bfoo(1)')[1]).toBe('unknownFunction:foo');
  });
  it('every kind has a class mapping; text has none', () => {
    const all: TokenKind[] = [
      'text',
      'function',
      'unknownFunction',
      'bracket',
      'brace',
      'paren',
      'comma',
      'semicolon',
      'substitution',
      'escape',
      'number',
      'dbref',
      'attrdef',
      'command',
      'pattern',
      'comment',
    ];
    expect(classFor('text')).toBe('');
    for (const k of all.filter((x) => x !== 'text')) expect(classFor(k)).toMatch(/^mc-/);
    expect(styledRanges(tokenize('add(1)')).map((r) => r.className)).toEqual([
      'mc-function',
      'mc-paren',
      'mc-number',
      'mc-paren',
    ]);
  });
});

describe('tokenize: robustness', () => {
  const check = (s: string): void => {
    const toks = tokenize(s);
    let pos = 0;
    let ok = true;
    for (const t of toks) {
      if (t.start !== pos || t.end <= t.start || t.text !== s.slice(t.start, t.end)) ok = false;
      pos = t.end;
    }
    if (pos !== s.length) ok = false;
    // plain assertion only on failure keeps the fuzz loops fast
    if (!ok) expect({ input: s, tokens: toks }).toBe('tokens must be contiguous and cover the input');
  };
  it('empty input', () => expect(tokenize('')).toEqual([]));
  it.each([
    '(((',
    ')))',
    '{[(',
    '\\',
    '%',
    '%q<',
    '%=<',
    '$',
    '$:',
    '#',
    '#-',
    '@',
    '@@',
    '&',
    '-',
    '1.',
    '\n\n',
    '\r\n',
  ])('malformed %j', (s) => check(s));
  it('fuzz: random strings never throw and cover the input', () => {
    const r = rng(12345);
    for (let i = 0; i < 4000; i++) check(randomString(r, SOFTCODE_ALPHABET, 60));
  });
  it('fuzz: arbitrary unicode and control characters', () => {
    const r = rng(99);
    for (let i = 0; i < 1000; i++) {
      let s = '';
      for (let j = 0, n = Math.floor(r() * 40); j < n; j++)
        s += String.fromCharCode(Math.floor(r() * 0x2fff));
      check(s);
    }
  });
});

describe('function list', () => {
  it('is generated, sorted, deduplicated and lowercase', () => {
    expect(FUNCTION_NAMES.length).toBeGreaterThan(300);
    expect([...FUNCTION_NAMES]).toEqual([...new Set(FUNCTION_NAMES)].sort());
    expect(FUNCTION_NAMES.every((n) => n === n.toLowerCase() && /^[a-z_][a-z0-9_]*$/.test(n))).toBe(true);
    expect(FUNCTION_SOURCES).toContain('cobra_func.hlp');
  });
  it('knows the classics, case-insensitively', () => {
    for (const n of ['add', 'iter', 'strcat', 'switch', 'u', 'get', 'setq', 'lnum', 'ADD', 'Iter']) {
      expect(isKnownFunction(n)).toBe(true);
    }
    expect(isKnownFunction('definitelynotafunction')).toBe(false);
  });
});
