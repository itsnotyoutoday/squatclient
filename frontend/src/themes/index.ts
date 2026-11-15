import { BUILTIN_THEMES, dark, highContrast, light } from './builtin';
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

/** The theme id that means "do what the operating system does": light or dark by its colour scheme, high contrast when it asks for it. */
export const SYSTEM_THEME = 'system';

/** What the operating system asks for right now. */
export interface SystemLook {
  dark: boolean;
  highContrast: boolean;
}
/** What the Linux desktop's settings portal said (it wins over the web view's own reading, which does not always follow it). */
let portal: SystemLook | null = null;
/** Linux: the desktop told us its colour scheme and contrast preference. */
export function setPortalLook(l: { dark: boolean; highContrast: boolean }): void {
  portal = { dark: l.dark, highContrast: l.highContrast };
  useSystemLook.setState(portal);
}
const readSystem = (): SystemLook => {
  if (portal) return portal;
  const q = (s: string): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(s).matches;
  return {
    dark: q('(prefers-color-scheme: dark)') || !q('(prefers-color-scheme: light)'),
    highContrast: q('(forced-colors: active)') || q('(prefers-contrast: more)'),
  };
};
/** Bumped when the operating system's colour scheme or contrast preference changes. */
export const useSystemLook = create<SystemLook>(() => readSystem());
/** Follow the system live: call once at start; returns the unsubscribe. */
export function watchSystemLook(): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const qs = [
    '(prefers-color-scheme: dark)',
    '(prefers-color-scheme: light)',
    '(forced-colors: active)',
    '(prefers-contrast: more)',
  ].map((q) => window.matchMedia(q));
  const on = (): void => useSystemLook.setState(readSystem());
  qs.forEach((m) => m.addEventListener?.('change', on));
  on();
  return () => qs.forEach((m) => m.removeEventListener?.('change', on));
}

export const findTheme = (id: string): Theme => {
  if (id === SYSTEM_THEME) {
    const s = useSystemLook.getState();
    return s.highContrast ? highContrast : s.dark ? dark : light;
  }
  return allThemes().find((t) => t.id === id) ?? dark;
};

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
