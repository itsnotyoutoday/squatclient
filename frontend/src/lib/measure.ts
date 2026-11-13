/** Approximate terminal size (cols x rows) of an element for NAWS. Returns null when it cannot be measured. */
export function measureCells(
  width: number,
  height: number,
  fontFamily: string,
  fontSize: number,
  lineHeight: number,
): { cols: number; rows: number } | null {
  if (width <= 0 || height <= 0) return null;
  let cw = fontSize * 0.6;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.font = `${fontSize}px ${fontFamily}`;
      const w = ctx.measureText('M').width;
      if (w > 0) cw = w;
    }
  } catch {
    /* fall back to the estimate */
  }
  return { cols: Math.max(20, Math.floor(width / cw)), rows: Math.max(5, Math.floor(height / lineHeight)) };
}
