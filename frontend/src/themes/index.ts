import { BUILTIN_THEMES, dark } from './builtin';
import type { Theme } from './schema';

export * from './schema';
export { BUILTIN_THEMES, dark, light, highContrast } from './builtin';

const custom = new Map<string, Theme>();
const STORE_KEY = 'squat.customThemes';

export function registerTheme(t: Theme): void {
  custom.set(t.id, t);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...custom.values()]));
  } catch {
    /* storage unavailable: theme lasts for this session only */
  }
}

export function loadStoredThemes(parse: (v: unknown) => Theme): void {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    for (const v of JSON.parse(raw) as unknown[]) {
      try {
        const t = parse(v);
        custom.set(t.id, t);
      } catch {
        /* skip invalid stored theme */
      }
    }
  } catch {
    /* ignore */
  }
}

export const allThemes = (): Theme[] => [...BUILTIN_THEMES, ...custom.values()];
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
