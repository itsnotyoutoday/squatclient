import { vi } from 'vitest';
import type { Line, Span } from '../src/api/types';

/** jsdom has no layout: give the output pane a 600px viewport and 20px rows. */
export function stubLayout(viewport = 600, row = 20): () => void {
  const sizeOf = (el: HTMLElement): { w: number; h: number } =>
    el.classList?.contains('output') ? { w: 800, h: viewport } : { w: 800, h: row };
  const spies = [
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return sizeOf(this).h;
    }),
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return sizeOf(this).w;
    }),
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return sizeOf(this).h;
    }),
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const { w, h } = sizeOf(this as HTMLElement);
      return { width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) };
    }),
  ];
  return () => spies.forEach((s) => s.mockRestore());
}

export const mkLine = (session: string, seq: number, spans: Span[] | string = `line ${seq}`): Line => ({
  session,
  seq,
  ts: 1_700_000_000_000 + seq,
  kind: 'game',
  spans: typeof spans === 'string' ? [{ s: spans }] : spans,
});

export const flushPromises = async (n = 5): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};
