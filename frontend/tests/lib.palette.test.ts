import { describe, expect, it } from 'vitest';
import golden from './fixtures/xterm256.json';
import { colorToHex, contrastRatio, ensureContrast, xtermHex } from '../src/lib/palette';
import { dark, light } from '../src/themes';

describe('xterm palette golden', () => {
  it('has the expected literal anchors', () => {
    expect(xtermHex(16)).toBe('#000000');
    expect(xtermHex(17)).toBe('#00005f');
    expect(xtermHex(21)).toBe('#0000ff');
    expect(xtermHex(196)).toBe('#ff0000');
    expect(xtermHex(231)).toBe('#ffffff');
    expect(xtermHex(232)).toBe('#080808');
    expect(xtermHex(255)).toBe('#eeeeee');
  });

  it('maps all indices 16-255 to the golden table', () => {
    const g = golden as Record<string, string>;
    expect(Object.keys(g)).toHaveLength(240);
    for (let i = 16; i < 256; i++) expect(xtermHex(i), `index ${i}`).toBe(g[String(i)]);
  });

  it('maps indices 0-15 through the theme, for every theme', () => {
    for (const theme of [dark, light]) {
      for (let i = 0; i < 16; i++) expect(colorToHex(i, theme.ansi)).toBe(theme.ansi[i]);
    }
    expect(colorToHex(1, dark.ansi)).not.toBe(colorToHex(1, light.ansi));
  });

  it('covers all 256 indices via colorToHex', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 256; i++) seen.add(colorToHex(i, dark.ansi));
    expect(seen.size).toBeGreaterThan(200);
  });

  it('rejects out-of-range indices', () => {
    expect(() => xtermHex(15)).toThrow();
    expect(() => xtermHex(256)).toThrow();
  });

  it('renders truecolor exactly, with no quantisation', () => {
    for (const c of ['#010203', '#fe01fd', '#123456', '#ABCDEF'])
      expect(colorToHex(c, dark.ansi)).toBe(c.toLowerCase());
  });
});

describe('contrast maths', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });
  it('leaves sufficiently contrasting colours alone', () => {
    expect(ensureContrast('#ffffff', '#000000', 4.5)).toBe('#ffffff');
  });
  it('raises contrast to the minimum, preferring the better direction', () => {
    const out = ensureContrast('#222222', '#14161a', 4.5);
    expect(contrastRatio(out, '#14161a')).toBeGreaterThanOrEqual(4.5);
    const out2 = ensureContrast('#dddddd', '#fbfbfa', 4.5);
    expect(contrastRatio(out2, '#fbfbfa')).toBeGreaterThanOrEqual(4.5);
  });
  it('is disabled at 0', () => {
    expect(ensureContrast('#222222', '#14161a', 0)).toBe('#222222');
  });
});
