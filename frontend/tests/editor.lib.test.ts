import { describe, expect, it } from 'vitest';
import { AmbiguousEscapeError, compressEscapes, expandEscapes } from '../src/lib/editor/escapes';
import { convert, initialMode, isDirty, pack, unpack } from '../src/lib/editor/serialize';
import { countChanges, diffLines, sideBySide, toLines } from '../src/lib/editor/diff';
import { findRefs, refAt } from '../src/lib/editor/refs';
import { fuzzyFilter, fuzzyScore } from '../src/lib/editor/fuzzy';
import { compileQuery, searchValues } from '../src/lib/editor/search';
import { parseEditCommand } from '../src/lib/editor/command';
import { checkAttrName, checkObject } from '../src/lib/editor/validate';
import { parsePersisted } from '../src/lib/editor/persist';
import { expand } from '../src/lib/mushcode';

describe('escapes (mirror of the engine)', () => {
  it('expands %r and %t, keeps %% and everything else', () => {
    expect(expandEscapes('a%rb%tc')).toBe('a\nb\tc');
    expect(expandEscapes('%%r stays')).toBe('%%r stays');
    expect(expandEscapes('%b %R %q0 %s 100%')).toBe('%b %R %q0 %s 100%');
  });
  it('compresses newlines (also CRLF / CR) and tabs', () => {
    expect(compressEscapes('a\nb\tc')).toBe('a%rb%tc');
    expect(compressEscapes('a\r\nb\rc')).toBe('a%rb%rc');
    expect(compressEscapes('plain')).toBe('plain');
  });
  it('refuses a lone % before a newline, accepts an escaped one', () => {
    expect(() => compressEscapes('100%\nx')).toThrow(AmbiguousEscapeError);
    expect(compressEscapes('100%%\nx')).toBe('100%%%rx');
  });
  it('round-trips every string without raw newlines or tabs', () => {
    let seed = 7;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const alphabet = ['%', 'r', 't', 'a', ' ', '(', ')', '%%', '%r', '%t', 'b'];
    for (let n = 0; n < 2000; n++) {
      let x = '';
      for (let i = rnd() * 12; i > 0; i--) x += alphabet[Math.floor(rnd() * alphabet.length)];
      // only strings the editor could have produced: expand(x) must compress back to x
      expect(compressEscapes(expandEscapes(x))).toBe(x);
    }
  });
});

describe('serialize (the send rule)', () => {
  it('code mode sends the collapsed form', () => {
    expect(pack('code', 'a(\n  b,\n  c\n)')).toEqual({ ok: true, raw: 'a(b,c)' });
  });
  it('lines mode turns newlines into %r', () => {
    expect(pack('lines', 'a\nb')).toEqual({ ok: true, raw: 'a%rb' });
    expect(pack('lines', '100%\nx').ok).toBe(false);
  });
  it('mode conversion keeps what would be stored', () => {
    const c = convert('code', 'lines', 'one%rtwo%tthree');
    expect(c).toEqual({ ok: true, text: 'one\ntwo\tthree' });
    expect(convert('lines', 'code', 'one\ntwo\tthree')).toEqual({ ok: true, text: 'one%rtwo%tthree' });
    expect(convert('lines', 'lines', 'x')).toEqual({ ok: true, text: 'x' });
    expect(convert('lines', 'code', '1%\n2').ok).toBe(false);
  });
  it('dirty ignores formatting, sees real edits', () => {
    const raw = expand('add(mul(1,2),mul(3,4),mul(5,6),mul(7,8),mul(9,10),mul(11,12))');
    expect(raw).toContain('\n');
    const original = 'add(mul(1,2),mul(3,4),mul(5,6),mul(7,8),mul(9,10),mul(11,12))';
    expect(isDirty('code', raw, original)).toBe(false);
    expect(isDirty('code', raw + 'x', original)).toBe(true);
    expect(isDirty('lines', '1%\n2', 'whatever')).toBe(true); // unpackable text counts as changed
  });
  it('picks line mode only for values with real newlines', () => {
    expect(initialMode('a%rb')).toBe('code');
    expect(initialMode('a\nb')).toBe('lines');
    expect(unpack('lines', 'a%rb')).toBe('a\nb');
  });
});

describe('line diff', () => {
  const ops = (a: string, b: string) =>
    diffLines(toLines(a), toLines(b)).map(
      (o) => (o.kind === 'eq' ? ' ' : o.kind === 'add' ? '+' : '-') + o.text,
    );
  it('handles equal, empty and one-sided inputs', () => {
    expect(ops('a\nb', 'a\nb')).toEqual([' a', ' b']);
    expect(ops('', '')).toEqual([]);
    expect(ops('', 'x\ny')).toEqual(['+x', '+y']);
    expect(ops('x\ny', '')).toEqual(['-x', '-y']);
  });
  it('finds inserts, deletes and replacements', () => {
    expect(ops('a\nb\nc', 'a\nX\nc')).toEqual([' a', '-b', '+X', ' c']);
    expect(ops('a\nc', 'a\nb\nc')).toEqual([' a', '+b', ' c']);
    expect(ops('a\nb\nc', 'a\nc')).toEqual([' a', '-b', ' c']);
  });
  it('reconstructs both sides for random inputs', () => {
    let seed = 3;
    const rnd = (n: number): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) % n;
    for (let t = 0; t < 300; t++) {
      const a = Array.from({ length: rnd(9) }, () => 'l' + rnd(4));
      const b = Array.from({ length: rnd(9) }, () => 'l' + rnd(4));
      const d = diffLines(a, b);
      expect(d.filter((o) => o.kind !== 'add').map((o) => o.text)).toEqual(a);
      expect(d.filter((o) => o.kind !== 'del').map((o) => o.text)).toEqual(b);
    }
  });
  it('pairs replaced lines side by side with numbers', () => {
    const rows = sideBySide('a\nb\nc', 'a\nB\nc\nd');
    expect(rows.map((r) => r.kind)).toEqual(['same', 'changed', 'same', 'right']);
    expect(rows[1]).toMatchObject({ left: { n: 2, text: 'b' }, right: { n: 2, text: 'B' } });
    expect(countChanges(rows)).toBe(2);
    expect(countChanges(sideBySide('x', 'x'))).toBe(0);
  });
});

describe('go-to-definition references', () => {
  it('finds object/attribute references of the common functions', () => {
    const t = 'u(#12/FN_X,1) ufun(me/FN_Y) get(#13/DESC) xget(#14,LOG) v(POWER) u(FN_Z) hasattr(here,FOO)';
    expect(findRefs(t).map((r) => [r.fn, r.object, r.attr])).toEqual([
      ['u', '#12', 'FN_X'],
      ['ufun', 'me', 'FN_Y'],
      ['get', '#13', 'DESC'],
      ['xget', '#14', 'LOG'],
      ['v', undefined, 'POWER'],
      ['u', undefined, 'FN_Z'],
      ['hasattr', 'here', 'FOO'],
    ]);
  });
  it('ignores dynamic and malformed references', () => {
    expect(findRefs('u(%0/FN) u([x]/FN) get(ATTR) v(1) v(a) u(#12/) xget(%0,LOG) u(#12/A B)')).toEqual([]);
    expect(findRefs('foo(#12/BAR) iter(a,b)')).toEqual([]);
    // the dynamic outer call is skipped, the literal reference inside it is still found
    expect(findRefs('u([get(me/X)]/FN)').map((r) => r.attr)).toEqual(['X']);
  });
  it('handles nesting and multi-line calls, case-insensitively', () => {
    const t = 'if(gt(1,2),\n  U(#12/fn_x,add(1,2)),\n  0)';
    const r = findRefs(t);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ fn: 'u', object: '#12', attr: 'FN_X' });
  });
  it('refAt finds the reference under the cursor', () => {
    const t = 'x u(#12/FN_X,1) y';
    const at = t.indexOf('FN_X') + 2;
    expect(refAt(t, at)?.attr).toBe('FN_X');
    expect(refAt(t, t.indexOf('u(') + 1)?.attr).toBe('FN_X');
    expect(refAt(t, 0)).toBeNull();
    expect(refAt(t, t.length)).toBeNull();
  });
  it('names with spaces resolve through the game', () => {
    expect(findRefs('u(Nav Console/FN_ROUTE)')[0]).toMatchObject({ object: 'Nav Console', attr: 'FN_ROUTE' });
  });
});

describe('fuzzy quick-open', () => {
  it('requires the characters in order and ranks sensibly', () => {
    expect(fuzzyScore('xyz', 'abc')).toBeNull();
    expect(fuzzyScore('ce', 'CMD_ENGAGE')).not.toBeNull();
    const names = ['FN_CHECKPOWER', 'CMD_ENGAGE', 'DO_ENGAGE', 'POWER', 'NOTES'];
    expect(fuzzyFilter('eng', names, (x) => x)).toEqual(['DO_ENGAGE', 'CMD_ENGAGE']);
    expect(fuzzyFilter('pow', names, (x) => x)[0]).toBe('POWER');
    expect(fuzzyFilter('', names, (x) => x)).toEqual(names);
    expect(fuzzyFilter('cp', names, (x) => x)).toEqual(['FN_CHECKPOWER']);
  });
});

describe('search values', () => {
  const values = { A: 'hello%rworld', B: 'Hello again', C: 'nothing' };
  it('finds hits by line, case-insensitively by default', () => {
    expect(searchValues(values, 'hello').map((h) => [h.attr, h.line])).toEqual([
      ['A', 1],
      ['B', 1],
    ]);
    expect(searchValues(values, 'world')[0]).toMatchObject({ attr: 'A', line: 2, col: 1 });
  });
  it('supports case-sensitive, regex and limits', () => {
    expect(searchValues(values, 'Hello', { caseSensitive: true }).map((h) => h.attr)).toEqual(['B']);
    expect(searchValues(values, 'h.llo', { regex: true })).toHaveLength(2);
    expect(searchValues(values, 'o', { limit: 2 })).toHaveLength(2);
    expect(searchValues(values, '')).toEqual([]);
  });
  it('treats special characters literally unless regex is on and survives a bad regex', () => {
    expect(searchValues({ X: 'a(b)' }, '(b)')).toHaveLength(1);
    expect(typeof compileQuery('(', { regex: true })).toBe('string');
    expect(searchValues({ X: 'a' }, '(', { regex: true })).toEqual([]);
  });
});

describe('/edit command parsing', () => {
  it('recognises the variants', () => {
    expect(parseEditCommand('/edit')).toEqual({ kind: 'open' });
    expect(parseEditCommand('  /EDIT  ')).toEqual({ kind: 'open' });
    expect(parseEditCommand('/edit #12')).toEqual({ kind: 'open', target: '#12' });
    expect(parseEditCommand('/edit #12/CMD')).toEqual({ kind: 'open', target: '#12', attr: 'CMD' });
    expect(parseEditCommand('/edit #12/cmd_engage')).toEqual({
      kind: 'open',
      target: '#12',
      attr: 'CMD_ENGAGE',
    });
    expect(parseEditCommand('/edit me')).toEqual({ kind: 'open', target: 'me' });
    expect(parseEditCommand('/edit here/DESCRIBE')).toEqual({
      kind: 'open',
      target: 'here',
      attr: 'DESCRIBE',
    });
    expect(parseEditCommand('/edit Nav Console')).toEqual({ kind: 'open', target: 'Nav Console' });
    expect(parseEditCommand('/edit Nav Console/FN_ROUTE')).toEqual({
      kind: 'open',
      target: 'Nav Console',
      attr: 'FN_ROUTE',
    });
  });
  it('rejects bad input with a message', () => {
    for (const bad of [
      '/edit #12/',
      '/edit #12/a b',
      '/edit a;b',
      '/edit #x',
      '/edit #12/A=B',
      '/edit [x]',
      '/edit %0',
    ]) {
      expect(parseEditCommand(bad), bad).toMatchObject({ kind: 'bad' });
    }
  });
  it('ignores everything else', () => {
    for (const no of ['/editor', 'edit #12', 'say /edit', '/ed', '/editx #1', '']) {
      expect(parseEditCommand(no), no).toBeNull();
    }
  });
});

describe('validation mirrors the engine', () => {
  it('objects', () => {
    for (const ok of ['#12', '#-1', 'me', 'here', '*Player', 'Nav Console'])
      expect(checkObject(ok), ok).toBeNull();
    for (const bad of [
      '',
      '#x',
      '#12x',
      ' a',
      'a ',
      'a,b',
      'a;b',
      'a(b)',
      'a=b',
      'a%b',
      'a\\b',
      'a|b',
      'a^b',
      'a\nb',
    ])
      expect(checkObject(bad), JSON.stringify(bad)).not.toBeNull();
  });
  it('attributes', () => {
    for (const ok of ['A', 'FN_X', 'a.b-c~d`e', 'X9']) expect(checkAttrName(ok)).toBeNull();
    for (const bad of ['', 'A B', 'A/B', 'A;', 'A=', 'A(', 'x'.repeat(129)])
      expect(checkAttrName(bad)).not.toBeNull();
  });
});

describe('persisted workspace parsing', () => {
  it('accepts a good document and drops junk', () => {
    const json = JSON.stringify({
      v: 1,
      active: '#12',
      objects: [
        {
          dbref: '#12',
          name: 'Console',
          activeAttr: 'A',
          drafts: { A: { text: 't', mode: 'code', original: 'o' }, B: { text: 1 } },
          modes: { A: 'lines', B: 'x' },
        },
        { dbref: 'nope' },
        null,
      ],
    });
    const p = parsePersisted(json)!;
    expect(p.objects).toHaveLength(1);
    expect(p.objects[0].drafts).toEqual({ A: { text: 't', mode: 'code', original: 'o' } });
    expect(p.objects[0].modes).toEqual({ A: 'lines' });
  });
  it('never throws on garbage', () => {
    for (const g of [null, '', '{', '[]', '{"v":2}', '{"v":1}', '{"v":1,"objects":5}'])
      expect(parsePersisted(g)).toBeNull();
  });
});
