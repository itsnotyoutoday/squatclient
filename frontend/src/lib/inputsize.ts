/** Sizing rules of the resizable command window (pure). */
export const MAX_FRACTION = 0.7; // of the window height
export const INPUT_PAD = 10; // vertical padding + border of the text area, px

/** Pixel height of one text line for a font size. */
export const lineHeightPx = (fontSize: number): number => Math.round(fontSize * 1.4);

/** Smallest and largest height of the text area: one line .. ~70% of the window. */
export function heightBounds(windowH: number, fontSize: number): { min: number; max: number } {
  const min = lineHeightPx(fontSize) + INPUT_PAD;
  return { min, max: Math.max(min, Math.floor(windowH * MAX_FRACTION)) };
}

/** Clamp a requested height into the bounds; non-finite input gives the minimum. */
export function clampInputHeight(px: number, windowH: number, fontSize: number): number {
  const { min, max } = heightBounds(windowH, fontSize);
  if (!Number.isFinite(px)) return min;
  return Math.min(max, Math.max(min, Math.round(px)));
}
