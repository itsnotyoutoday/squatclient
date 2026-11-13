import type { Color } from '../api/types';

/** xterm 6x6x6 colour cube component levels. */
export const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');
export const rgbToHex = (r: number, g: number, b: number): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Exact xterm colour for indices 16-255. Throws on anything else. */
export function xtermHex(index: number): string {
  if (!Number.isInteger(index) || index < 16 || index > 255)
    throw new RangeError(`xterm index out of range: ${index}`);
  if (index >= 232) {
    const v = 8 + 10 * (index - 232);
    return rgbToHex(v, v, v);
  }
  const n = index - 16;
  return rgbToHex(CUBE_LEVELS[Math.floor(n / 36)], CUBE_LEVELS[Math.floor(n / 6) % 6], CUBE_LEVELS[n % 6]);
}

/**
 * Resolve a protocol Color to "#rrggbb". 0-15 come from the theme's ansi table, 16-255 from the
 * xterm palette, strings are truecolor and returned verbatim (lower-cased), never quantised.
 */
export function colorToHex(c: Color, ansi16: readonly string[]): string {
  if (typeof c === 'string') return c.toLowerCase();
  if (c >= 0 && c < 16) return ansi16[c];
  return xtermHex(c);
}

// ---- contrast maths (WCAG 2.x relative luminance)

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Return `fg` unchanged if it already has at least `min` contrast against `bg`; otherwise blend it
 * toward white or black (whichever reaches more contrast) just far enough to reach `min`
 * (or as close as possible). `min <= 0` disables.
 */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (min <= 0 || contrastRatio(fg, bg) >= min) return fg;
  const target = contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg) ? [255, 255, 255] : [0, 0, 0];
  const [r, g, b] = hexToRgb(fg);
  let best = fg;
  for (let i = 1; i <= 100; i++) {
    const t = i / 100;
    const cand = rgbToHex(
      Math.round(r + (target[0] - r) * t),
      Math.round(g + (target[1] - g) * t),
      Math.round(b + (target[2] - b) * t),
    );
    best = cand;
    if (contrastRatio(cand, bg) >= min) break;
  }
  return best;
}
