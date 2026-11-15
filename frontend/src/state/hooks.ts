import { useMemo } from 'react';
import { findTheme, useSystemLook, useThemeVersion } from '../themes';
import type { Theme } from '../themes';
import type { RenderOptions, RenderTheme } from '../lib/runs';
import { useSettings } from './stores';

export function useTheme(): Theme {
  const id = useSettings((s) => s.settings.theme);
  const version = useThemeVersion((s) => s.version);
  const sysDark = useSystemLook((s) => s.dark);
  const sysContrast = useSystemLook((s) => s.highContrast);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => findTheme(id), [id, version, sysDark, sysContrast]);
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
