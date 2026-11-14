import { describe, expect, it } from 'vitest';
import {
  BUILTIN_THEMES,
  applyTheme,
  dark,
  findTheme,
  light,
  parseTheme,
  parseThemeJson,
} from '../src/themes';
import { contrastRatio } from '../src/lib/palette';

describe('themes', () => {
  it('ships dark, light and high-contrast with full definitions', () => {
    expect(BUILTIN_THEMES.map((t) => t.id)).toEqual(['dark', 'light', 'high-contrast']);
    for (const t of BUILTIN_THEMES) {
      expect(t.ansi).toHaveLength(16);
      expect(() => parseTheme(JSON.parse(JSON.stringify(t)))).not.toThrow();
    }
  });
  it('high-contrast meets AAA for default text', () => {
    const hc = findTheme('high-contrast');
    expect(contrastRatio(hc.fg, hc.bg)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(dark.fg, dark.bg)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(light.fg, light.bg)).toBeGreaterThanOrEqual(7);
  });
  it('applies through CSS variables, instantly switchable', () => {
    const el = document.createElement('div');
    applyTheme(dark, el);
    expect(el.style.getPropertyValue('--bg')).toBe(dark.bg);
    expect(el.style.getPropertyValue('--ansi-1')).toBe(dark.ansi[1]);
    expect(el.style.getPropertyValue('--ansi-15')).toBe(dark.ansi[15]);
    expect(el.style.getPropertyValue('--ui-accent')).toBe(dark.chrome.accent);
    expect(el.dataset.theme).toBe('dark');
    applyTheme(light, el);
    expect(el.style.getPropertyValue('--bg')).toBe(light.bg);
    expect(el.dataset.theme).toBe('light');
  });
  it('falls back to dark for unknown ids', () => {
    expect(findTheme('nope').id).toBe('dark');
  });
  it('imports valid JSON themes and rejects malformed ones with clear errors', () => {
    const good = JSON.stringify({ ...dark, id: 'My Theme!', name: 'Mine' });
    expect(parseThemeJson(good).id).toBe('my-theme-');
    expect(() => parseThemeJson('{')).toThrow(/JSON/);
    expect(() => parseThemeJson(JSON.stringify({ ...dark, ansi: ['#000'] }))).toThrow(/16/);
    expect(() => parseThemeJson(JSON.stringify({ ...dark, fg: 'red' }))).toThrow(/fg/);
    expect(() => parseThemeJson(JSON.stringify({ ...dark, kind: 'x' }))).toThrow(/kind/);
    expect(() =>
      parseThemeJson(JSON.stringify({ ...dark, chrome: { ...dark.chrome, accent: 'x' } })),
    ).toThrow(/chrome.accent/);
    expect(() => parseTheme(null)).toThrow();
  });
});

describe('themes folder', () => {
  it('uses valid files, reports bad ones, and refuses ids that shadow built-ins', async () => {
    const { setFolderThemes, allThemes } = await import('../src/themes');
    const ok = JSON.stringify({ ...dark, id: 'night', name: 'Night' });
    const dup = JSON.stringify({ ...dark, id: 'dark', name: 'Again' });
    const problems = setFolderThemes([
      { id: 'night', file: 'night.json', json: ok, modified: 0 },
      { id: 'bad', file: 'bad/theme.json', json: '{nope', modified: 0 },
      { id: 'dup', file: 'dup.json', json: dup, modified: 0 },
    ]);
    expect(allThemes().map((t) => t.id)).toContain('night');
    expect(problems.map((p) => p.file)).toEqual(['bad/theme.json', 'dup.json']);
    setFolderThemes([]);
    expect(allThemes().map((t) => t.id)).not.toContain('night');
  });
});
