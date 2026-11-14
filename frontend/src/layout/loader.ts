import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { LayoutBundle } from '../api/types';
import { useUi } from '../state/stores';
import { evaluateLayout } from './runtime';

export type UserLayoutState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; Component: ComponentType; bundle: LayoutBundle }
  | { status: 'consent'; bundle: LayoutBundle }
  | { status: 'error'; message: string };

const evaluated = new Map<string, ComponentType>(); // by id + content hash: switching back is instant

/**
 * Loads a user layout: asks the engine to compile it, waits for the user's consent if it was never
 * allowed (or changed), then evaluates the code. It reloads by itself when the layout files change.
 */
export function useUserLayout(id: string, enabled: boolean): UserLayoutState {
  const engine = useUi((s) => s.engine);
  const [state, setState] = useState<UserLayoutState>({ status: enabled ? 'loading' : 'off' });
  const [tick, setTick] = useState(0);

  useEffect(() => (engine ? engine.on('layouts-changed', () => setTick((t) => t + 1)) : undefined), [engine]);

  useEffect(() => {
    if (!enabled || !engine) {
      setState({ status: 'off' });
      return;
    }
    let live = true;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    engine
      .loadLayout(id)
      .then((b) => {
        if (!live) return;
        if (b.error) return setState({ status: 'error', message: b.error });
        if (b.needsConsent) return setState({ status: 'consent', bundle: b });
        const key = `${id}:${b.hash}`;
        try {
          let Component = evaluated.get(key);
          if (!Component) {
            Component = evaluateLayout(b.code ?? '');
            evaluated.set(key, Component);
          }
          setState({ status: 'ready', Component, bundle: b });
        } catch (e) {
          setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
        }
      })
      .catch((e: unknown) => {
        if (live) setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [engine, id, enabled, tick]);

  return state;
}
