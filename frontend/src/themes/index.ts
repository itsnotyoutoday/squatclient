import { BUILTIN_THEMES, dark } from './builtin';
import type { Theme } from './schema';

export * from './schema';
export { BUILTIN_THEMES, dark, light, highContrast } from './builtin';

import { create } from 'zustand';
import type { ThemeFile } from '../api/types';
import { parseThemeJson } from './schema';

// Custom themes live in the themes folder (a "<id>.json" file, or "<id>/theme.json"); the app reads them
// through the engine and keeps the valid ones here.
let custom: Theme[] = [];

/** Bumped when the set of folder themes changes, so views showing the current theme re-read it. */
export const useThemeVersion = create<{ version: number }>(() => ({ version: 0 }));

export interface ThemeProblem {
  file: string;
  error: string;
}

/** Replace the folder themes with what the folder holds now. Themes that don't validate are reported, not used. */
export function setFolderThemes(files: ThemeFile[]): ThemeProblem[] {
  const next: Theme[] = [];
  const problems: ThemeProblem[] = [];
  const taken = new Set(BUILTIN_THEMES.map((t) => t.id));
  for (const f of files) {
    try {
      const t = parseThemeJson(f.json);
      if (taken.has(t.id)) throw new Error(`theme: id "${t.id}" is already used`);
      taken.add(t.id);
      next.push(t);
    } catch (e) {
      problems.push({ file: f.file, error: e instanceof Error ? e.message : String(e) });
    }
  }
  custom = next;
  useThemeVersion.setState((s) => ({ version: s.version + 1 }));
  return problems;
}

export const allThemes = (): Theme[] => [...BUILTIN_THEMES, ...custom];
export const findTheme = (id: string): Theme => allThemes().find((t) => t.id === id) ?? dark;

/** Apply a theme through CSS variables on `el` (default: <html>). Instant, no re-render needed for chrome. */
export function applyTheme(theme: Theme, el: HTMLElement = document.documentElement): void {
  const set = (k: string, v: string): void => el.style.setProperty(k, v);
  set('--fg', theme.fg);
  set('--bg', theme.bg);
  set('--cursor', theme.cursor);
  set('--selection', theme.selection);
  set('--link', theme.link);
  theme.ansi.forEach((c, i) => set(`--ansi-${i}`, c));
  const c = theme.chrome;
  set('--ui-panel', c.panel);
  set('--ui-panel-alt', c.panelAlt);
  set('--ui-border', c.border);
  set('--ui-text', c.text);
  set('--ui-text-dim', c.textDim);
  set('--ui-accent', c.accent);
  set('--ui-accent-text', c.accentText);
  set('--ui-danger', c.danger);
  set('--ui-warn', c.warn);
  set('--ui-ok', c.ok);
  el.dataset.theme = theme.id;
  el.style.colorScheme = theme.kind;
}
