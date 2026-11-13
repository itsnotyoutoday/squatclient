import { collapse, expand, joinContinuations, scanBalance, tokenize } from '../src/lib/mushcode';
import { randomSoftcode, randomString, rng, SOFTCODE_ALPHABET } from './mushcode.helpers';

describe('collapse', () => {
  it('removes every newline and the whitespace after it', () => {
    expect(collapse('add(\n  1,\n\t2\n)')).toBe('add(1,2)');
    expect(collapse('a\r\n   b')).toBe('ab');
    expect(collapse('a\n\nb')).toBe('ab');
  });
  it('is the identity on single-line text', () => {
    for (const s of ['', 'add(1, 2)', '  lead', 'trail  ', 'a\tb']) expect(collapse(s)).toBe(s);
  });
});

describe('joinContinuations', () => {
  it('appends whitespace-led lines to the previous line', () => {
    expect(joinContinuations('&A me=add(\n  1,\n  2\n)')).toBe('&A me=add(1,2\n)');
    expect(joinContinuations('a\n  b\n    c\nd')).toBe('abc\nd');
  });
  it('keeps separate commands separate, and blank lines', () => {
    expect(joinContinuations('@set a=1\n@set b=2\n\n@set c=3')).toBe('@set a=1\n@set b=2\n\n@set c=3');
  });
  it('keeps a leading-whitespace first line, keeps trailing whitespace', () => {
    expect(joinContinuations('  a\n  b')).toBe('  ab');
    expect(joinContinuations('a, \n  b')).toBe('a, b');
  });
  it('a whitespace-only line is swallowed into the previous line', () => {
    expect(joinContinuations('a\n   \nb')).toBe('a\nb');
  });
});

describe('expand', () => {
  const x = 'think [iter(lnum(1,10),if(gt(%i0,5),mul(%i0,2),add(%i0,1)),,|)] done';
  it('breaks long calls after ( and commas, closing ) on its own line', () => {
    expect(expand(x, { maxInline: 30 })).toBe(
      [
        'think [iter(',
        '    lnum(1,10),',
        '    if(',
        '      gt(%i0,5),',
        '      mul(%i0,2),',
        '      add(%i0,1)',
        '    ),,',
        '    |',
        '  )] done',
      ].join('\n'),
    );
  });
  it('leaves short code alone', () => {
    expect(expand('add(1,2)')).toBe('add(1,2)');
    expect(expand(x, { maxInline: 500 })).toBe(x);
  });
  it('honours the indent option', () => {
    const out = expand('f(aaaa,g(bbbb,cccc))', { maxInline: 8, indent: 4 });
    expect(out).toBe('f(\n        aaaa,\n        g(\n            bbbb,\n            cccc\n        )\n    )');
    expect(expand('f(aaaa,bbbb)', { maxInline: 4, indent: 0 })).toMatch(/\n {1,}aaaa/);
  });
  it('keeps a space that followed a comma (before the break) so collapse is exact', () => {
    const src = 'strcat(aaaaaaaaaa, bbbbbbbbbb, cccccccccc)';
    const e = expand(src, { maxInline: 10 });
    expect(e).toBe('strcat(\n    aaaaaaaaaa, \n    bbbbbbbbbb, \n    cccccccccc\n  )');
    expect(collapse(e)).toBe(src);
  });
  it('never opens a braced literal', () => {
    const src = 'add({aaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbb,cccccccccccc(1,2)},2)';
    const e = expand(src, { maxInline: 10 });
    expect(e).toContain('{aaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbb,cccccccccccc(1,2)}');
    expect(e.split('\n').length).toBe(4);
  });
  it('does not split escapes or substitutions', () => {
    const src = 'f(aaaaaaaa\\,bbbbbbbb,%q<name,with>,cccc%,dddd)';
    const e = expand(src, { maxInline: 10 });
    expect(e).toContain('aaaaaaaa\\,bbbbbbbb,');
    expect(e).toContain('%q<name,with>');
    expect(e).toContain('cccc%,dddd');
    expect(collapse(e)).toBe(src);
  });
  it('does not break inside patterns or comments', () => {
    const p = '&C me=$go add(aaaaaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbbbbbbbb,cccccccccccccccccc):think hi';
    expect(expand(p, { maxInline: 10 })).toBe(p);
    const c = '@@ add(aaaaaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbbbbbbbb,cccccccccccccccccc)';
    expect(expand(c, { maxInline: 10 })).toBe(c);
  });
  it('does not touch unbalanced code', () => {
    const s = 'add(aaaaaaaaaaaaaa,bbbbbbbbbbbbbbbbbbb';
    expect(expand(s, { maxInline: 10 })).toBe(s);
  });
  it('expands each logical line separately and keeps commands apart', () => {
    const src = '@set a=add(aaaaaaaaaa,bbbbbbbbbb)\n@set b=2';
    const e = expand(src, { maxInline: 10 });
    expect(e.split('\n')[0]).toBe('@set a=add(');
    expect(e.endsWith('\n@set b=2')).toBe(true);
    expect(joinContinuations(e).split('\n')).toEqual(['@set a=add(aaaaaaaaaa,bbbbbbbbbb)', '@set b=2']);
  });
  it('re-expanding already expanded (continuation) text is stable', () => {
    const e = expand(x, { maxInline: 30 });
    expect(expand(e, { maxInline: 30 })).toBe(e);
  });
  it('every continuation line starts with whitespace (send-side join restores the code)', () => {
    const e = expand(x, { maxInline: 20 });
    for (const l of e.split('\n').slice(1)) expect(l[0]).toBe(' ');
    expect(joinContinuations(e)).toBe(x);
  });
});

describe('expand/collapse properties (random softcode)', () => {
  it('collapse(expand(x)) === x and expand is idempotent', () => {
    const r = rng(2024);
    let broke = 0;
    for (let i = 0; i < 4000; i++) {
      const x = randomSoftcode(r);
      const maxInline = [0, 5, 12, 25, 60][Math.floor(r() * 5)];
      const indent = 1 + Math.floor(r() * 4);
      const e = expand(x, { maxInline, indent });
      if (e !== x) broke++;
      if (
        collapse(e) !== x ||
        expand(e, { maxInline, indent }) !== e ||
        expand(collapse(e), { maxInline, indent }) !== e
      ) {
        expect({ x, e, maxInline, indent }).toBe('round trip / idempotency violated');
      }
      if (collapse(x) !== x) expect(x).toBe('generator produced a newline');
    }
    expect(broke).toBeGreaterThan(500); // the generator really exercises expansion
  });

  it('collapse(expand(x)) === x for arbitrary single-line strings too', () => {
    const r = rng(77);
    const alphabet = SOFTCODE_ALPHABET.filter((a) => !/[\n\r]/.test(a));
    for (let i = 0; i < 4000; i++) {
      const x = randomString(r, alphabet, 70);
      const e = expand(x, { maxInline: 6 });
      if (collapse(e) !== x) expect({ x, e }).toBe('round trip violated');
    }
  });

  it('only whitespace is inserted, never inside braces, after a backslash, or inside a substitution', () => {
    const r = rng(31337);
    for (let i = 0; i < 3000; i++) {
      const x = randomSoftcode(r);
      const e = expand(x, { maxInline: 8 });
      if (e === x) continue;
      // align e with x: whatever in e is not matched by x is an insertion ("\n" + spaces)
      const spots: number[] = [];
      let xi = 0;
      for (let ei = 0; ei < e.length;) {
        if (xi < x.length && e[ei] === x[xi]) {
          ei++;
          xi++;
        } else {
          if (e[ei] !== '\n') expect({ x, e }).toBe('inserted something other than a newline');
          spots.push(xi);
          ei++;
          while (e[ei] === ' ') ei++;
        }
      }
      const toks = tokenize(x);
      const { pairs } = scanBalance(x, 'code', toks);
      for (const p of spots) {
        for (const [o, c] of pairs) {
          if (x[o] === '{' && c > o && o < p && p <= c) expect({ x, e, p }).toBe('inserted inside braces');
        }
        for (const t of toks) {
          if ((t.kind === 'substitution' || t.kind === 'escape') && t.start < p && p < t.end) {
            expect({ x, e, p }).toBe('inserted inside a substitution/escape');
          }
        }
        if (x[p - 1] === '\\') {
          const esc = toks.find((t) => t.kind === 'escape' && t.start === p - 1);
          if (esc) expect({ x, e, p }).toBe('inserted after a backslash');
        }
      }
    }
  });

  it('expand never throws on random multi-line input and keeps the joined content', () => {
    const r = rng(5);
    // a lone CR is not a line break here (documented limit); CRLF is
    const alphabet = [...SOFTCODE_ALPHABET.filter((a) => a !== '\r'), '\n', '\r\n  ', '\n\t'];
    for (let i = 0; i < 2000; i++) {
      const x = randomString(r, alphabet, 60);
      const e = expand(x, { maxInline: 6 });
      if (joinContinuations(e) !== joinContinuations(x)) expect({ x, e }).toBe('joined content changed');
      if (expand(e, { maxInline: 6 }) !== e) expect({ x, e }).toBe('not idempotent');
    }
  });
});
