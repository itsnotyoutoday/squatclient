import type { Rect4 } from './types';

/** The sensors console around a big text port, as in the themes' sens console: the viewscreen band on the left with the scan buttons
 * under it, the contact list in the middle, a modest radar dish on the right. c is the skin's content band (scene units). */
export function sensorsArrangement(c: Rect4): Record<string, Rect4> {
  const [x, y, w, h] = c;
  const vw = Math.round(w * 0.48);
  return {
    'viewscreen#0': [x, y + 6, vw, h - 52],
    'container-of:button#0': [x, y + h - 42, vw, 38],
    'table#0': [x + vw + 20, y + 6, Math.round(w * 0.29), h - 12],
    'radar#0': [x + vw + 20 + Math.round(w * 0.29) + 12, y + 6, w - vw - 32 - Math.round(w * 0.29), h - 12],
  };
}
