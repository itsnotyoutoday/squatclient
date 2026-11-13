import type { EngineAPI } from './types';
import { MockEngine } from './mock';
import { WailsEngine, hasWails } from './wails';

export * from './types';
export { MockEngine } from './mock';
export { WailsEngine, hasWails, openExternal } from './wails';

/** Wails runtime present -> WailsEngine; otherwise (or ?mock=1) MockEngine. */
export function createEngine(search: string = window.location.search): EngineAPI {
  const forceMock = new URLSearchParams(search).get('mock') === '1';
  if (!forceMock && hasWails()) return new WailsEngine();
  return new MockEngine({ stream: true, streamIntervalMs: 1100, connectDelayMs: 500 });
}
