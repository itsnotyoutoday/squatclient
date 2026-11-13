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
