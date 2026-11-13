import { describe, expect, it } from 'vitest';
import vectors from './fixtures/ansi-vectors.json';
import { applyHighlights, resolveStyle, spansToRuns } from '../src/lib/runs';
import type { RenderOptions, RenderTheme } from '../src/lib/runs';
import type { Span } from '../src/api/types';
import { dark } from '../src/themes';

const theme: RenderTheme = { fg: dark.fg, bg: dark.bg, ansi: dark.ansi };
const opts: RenderOptions = { boldAsBright: false, minContrast: 0, linkify: true };

describe('attribute rendering', () => {
  it('resolves 0-15 via theme, 16-255 via xterm, truecolor exactly', () => {
    expect(resolveStyle({ s: 'x', fg: 1 }, theme, opts).fg).toBe(dark.ansi[1]);
    expect(resolveStyle({ s: 'x', fg: 196, bg: 232 }, theme, opts)).toMatchObject({
      fg: '#ff0000',
      bg: '#080808',
    });
    expect(resolveStyle({ s: 'x', fg: '#123456', bg: '#fedcba' }, theme, opts)).toMatchObject({
      fg: '#123456',
      bg: '#fedcba',
    });
  });

  it('carries every attribute flag', () => {
    const r = resolveStyle(
      { s: 'x', b: true, dim: true, i: true, u: true, st: true, blink: true },
      theme,
      opts,
    );
    expect(r).toMatchObject({ b: true, dim: true, i: true, u: true, st: true, blink: true });
  });

  it('reverse swaps fg and bg including defaults', () => {
    expect(resolveStyle({ s: 'x', rev: true }, theme, opts)).toMatchObject({ fg: theme.bg, bg: theme.fg });
    expect(resolveStyle({ s: 'x', rev: true, fg: 1 }, theme, opts)).toMatchObject({
      fg: theme.bg,
      bg: dark.ansi[1],
    });
    expect(resolveStyle({ s: 'x', rev: true, fg: 1, bg: 4 }, theme, opts)).toMatchObject({
      fg: dark.ansi[4],
      bg: dark.ansi[1],
    });
  });

  it('boldAsBright brightens only 0-7 and drops the bold weight for them', () => {
    const on = { ...opts, boldAsBright: true };
    expect(resolveStyle({ s: 'x', b: true, fg: 1 }, theme, on)).toMatchObject({ fg: dark.ansi[9] });
    expect(resolveStyle({ s: 'x', b: true, fg: 1 }, theme, on).b).toBeUndefined();
    expect(resolveStyle({ s: 'x', b: true, fg: 9 }, theme, on).fg).toBe(dark.ansi[9]);
    expect(resolveStyle({ s: 'x', b: true, fg: 200 }, theme, on).fg).toBe('#ff00d7');
    expect(resolveStyle({ s: 'x', b: true }, theme, on).b).toBe(true);
    expect(resolveStyle({ s: 'x', fg: 1 }, theme, on).fg).toBe(dark.ansi[1]);
    expect(resolveStyle({ s: 'x', b: true, fg: 1 }, theme, opts)).toMatchObject({
      fg: dark.ansi[1],
      b: true,
    });
  });

  it('minContrast adjusts unreadable colours only', () => {
    const lo = resolveStyle({ s: 'x', fg: '#16181c' }, theme, { ...opts, minContrast: 4.5 });
    expect(lo.fg).not.toBe('#16181c');
    const ok = resolveStyle({ s: 'x', fg: '#ffffff' }, theme, { ...opts, minContrast: 4.5 });
    expect(ok.fg).toBe('#ffffff');
    expect(resolveStyle({ s: 'x', fg: '#16181c' }, theme, opts).fg).toBe('#16181c');
  });
});

describe('span merging', () => {
  it('merges adjacent spans with the same resolved style', () => {
    const spans: Span[] = [
      { s: 'a', fg: 1 },
      { s: 'b', fg: 1 },
      { s: 'c' },
      { s: 'd' },
      { s: 'e', fg: '#aa0000' },
    ];
    const runs = spansToRuns(spans, theme, opts);
    expect(runs.map((r) => r.text)).toEqual(['ab', 'cd', 'e']);
  });

  it('merges different spans that resolve to the same colour (index 9 vs bright via boldAsBright)', () => {
    const runs = spansToRuns(
      [
        { s: 'a', fg: 9 },
        { s: 'b', fg: 1, b: true },
      ],
      theme,
      { ...opts, boldAsBright: true },
    );
    expect(runs).toHaveLength(1);
  });

  it('does not merge across different attributes', () => {
    expect(spansToRuns([{ s: 'a' }, { s: 'b', u: true }], theme, opts)).toHaveLength(2);
  });

  it('preserves all text of the shared ANSI vectors', () => {
    const cases = (vectors as { cases: { name: string; spans: Span[][] }[] }).cases;
    let n = 0;
    for (const c of cases) {
      for (const line of c.spans) {
        const runs = spansToRuns(line, theme, { ...opts, linkify: false });
        expect(runs.map((r) => r.text).join(''), c.name).toBe(line.map((s) => s.s).join(''));
        n++;
      }
    }
    expect(n).toBeGreaterThan(5);
  });

  it('resolves every colour in the vectors to #rrggbb', () => {
    const cases = (vectors as { cases: { spans: Span[][] }[] }).cases;
    for (const c of cases)
      for (const line of c.spans)
        for (const r of spansToRuns(line, theme, opts)) {
          if (r.fg) expect(r.fg).toMatch(/^#[0-9a-f]{6}$/);
          if (r.bg) expect(r.bg).toMatch(/^#[0-9a-f]{6}$/);
        }
  });

  it('keeps UTF-8 (emoji, CJK, combining) intact', () => {
    const t = 'café \u{1F600} 日本 é';
    expect(spansToRuns([{ s: t }], theme, opts)[0].text).toBe(t);
  });
});

describe('links in runs', () => {
  it('autolinkifies bare URLs when enabled and not when disabled', () => {
    const on = spansToRuns([{ s: 'see https://a.example/x now' }], theme, opts);
    expect(on.map((r) => r.link)).toEqual([undefined, 'https://a.example/x', undefined]);
    const off = spansToRuns([{ s: 'see https://a.example/x now' }], theme, { ...opts, linkify: false });
    expect(off).toHaveLength(1);
  });
  it('drops unsafe OSC 8 link targets', () => {
    const r = spansToRuns([{ s: 'x', link: 'javascript:alert(1)' }], theme, { ...opts, linkify: false });
    expect(r[0].link).toBeUndefined();
    const ok = spansToRuns([{ s: 'x', link: 'https://ok.example' }], theme, { ...opts, linkify: false });
    expect(ok[0].link).toBe('https://ok.example');
  });
});

describe('highlights', () => {
  it('splits runs at match boundaries', () => {
    const runs = spansToRuns([{ s: 'hello ' }, { s: 'world', fg: 1 }], theme, opts);
    const h = applyHighlights(runs, [{ start: 3, end: 8, current: true }]);
    expect(h.map((r) => [r.text, r.hl])).toEqual([
      ['hel', undefined],
      ['lo ', 'current'],
      ['wo', 'current'],
      ['rld', undefined],
    ]);
  });
});
