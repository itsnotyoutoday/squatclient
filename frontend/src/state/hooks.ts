import { useMemo } from 'react';
import { findTheme } from '../themes';
import type { Theme } from '../themes';
import type { RenderOptions, RenderTheme } from '../lib/runs';
import { useSettings } from './stores';

export function useTheme(): Theme {
  const id = useSettings((s) => s.settings.theme);
  return useMemo(() => findTheme(id), [id]);
}

export function useRenderTheme(): RenderTheme {
  const t = useTheme();
  return useMemo(() => ({ fg: t.fg, bg: t.bg, ansi: t.ansi }), [t]);
}

export function useRenderOptions(): RenderOptions {
  const boldAsBright = useSettings((s) => s.settings.boldAsBright);
  const minContrast = useSettings((s) => s.settings.minContrast);
  const linkify = useSettings((s) => s.settings.linkify);
  return useMemo(() => ({ boldAsBright, minContrast, linkify }), [boldAsBright, minContrast, linkify]);
}
