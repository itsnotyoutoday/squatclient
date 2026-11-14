import * as React from 'react';
import type { ComponentType } from 'react';
import { LAYOUT_API } from './index';

/**
 * Run a compiled layout. The compiler (Go, esbuild) emits CommonJS that `require`s only "react" and
 * "squat" and exports the layout component as the default export. Every name of the layout API
 * (components and hooks) is also in scope without an import, so `<Gauge .../>` and `useVar(...)` work
 * straight away. Nothing else is available through `require`.
 */
export function evaluateLayout(code: string): ComponentType {
  const names = Object.keys(LAYOUT_API);
  const module: { exports: Record<string, unknown> } = { exports: {} };
  const require = (id: string): unknown => {
    if (id === 'react') return React;
    if (id === 'squat') return LAYOUT_API;
    throw new Error(`a layout cannot import "${id}"`);
  };
  const fn = new Function(
    'React',
    'require',
    'module',
    'exports',
    ...names,
    `${code}\n//# sourceURL=layout.js`,
  );
  fn(React, require, module, module.exports, ...names.map((n) => LAYOUT_API[n]));
  const def = (module.exports.default ?? module.exports.Layout) as unknown;
  if (typeof def !== 'function') throw new Error('the layout must export a component as its default export');
  return def as ComponentType;
}
