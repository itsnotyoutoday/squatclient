import * as components from './components';
import * as hooks from './hooks';

export * from './components';
export * from './hooks';
export { LayoutContext, useLayoutEnv } from './context';
export type { LayoutEnv } from './context';

/**
 * Everything a layout can use by name, with no imports: the components and hooks above. The loader
 * passes these to a compiled layout as in-scope names, and as the module `squat`.
 */
export const LAYOUT_API: Record<string, unknown> = { ...components, ...hooks };
