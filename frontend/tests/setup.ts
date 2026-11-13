import '@testing-library/jest-dom/vitest';

if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// jsdom has no scrolling APIs; the virtualised lists call them.
for (const m of ['scrollBy', 'scrollTo'] as const) {
  if (typeof Element.prototype[m] !== 'function') {
    (Element.prototype as unknown as Record<string, unknown>)[m] = function () {};
  }
}

// jsdom lacks the layout APIs CodeMirror measures with (the command window editor mode uses it).
{
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  const rects = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (typeof Range !== 'undefined') {
    if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => rect as DOMRect;
    if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => rects;
  }
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
}
