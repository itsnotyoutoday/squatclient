import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';
import type { SessionInfo } from '../api/types';
import { useSettings, useUi } from '../state/stores';
import { Classic, findBuiltin } from './builtin';
import { LayoutContext } from './context';
import type { LayoutEnv } from './context';

class Guard extends Component<{ onError(e: Error): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Which layout a session uses: its world's, else the setting's, else the classic one. */
export function useLayoutId(session: SessionInfo): string {
  const world = useUi((s) => s.worlds.find((w) => w.id === session.worldId));
  const dflt = useSettings((s) => s.settings.layout);
  return world?.layout || dflt || 'classic';
}

/**
 * Draws the area between the tab bar and the status bar with the session's layout. The shell never
 * trusts a layout: it must contain exactly one <Mush /> and one <InputBar />, and if it fails to load,
 * fails that check or throws while drawing, the classic layout is shown with a notice saying why.
 */
export function LayoutHost({
  session,
  layoutId,
  Custom,
}: {
  session: SessionInfo;
  layoutId?: string;
  Custom?: ComponentType;
}) {
  const engine = useUi((s) => s.engine);
  const chosen = useLayoutId(session);
  const id = layoutId ?? chosen;
  const builtin = findBuiltin(id);
  const Chosen: ComponentType | undefined = Custom ?? builtin?.component;
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const failed = problem?.id === id;
  const counts = useRef({ mush: 0, input: 0 });
  const sessionId = session.id;
  const scope = session.worldId || session.id;

  const send = useCallback(
    (text: string) => {
      void engine?.input(sessionId, text).catch(() => undefined);
    },
    [engine, sessionId],
  );
  const register = useCallback((kind: 'mush' | 'input') => {
    counts.current[kind]++;
    return () => {
      counts.current[kind]--;
    };
  }, []);
  // the first problem found for a layout is the one reported (a crash must not be hidden by the check)
  const report = useCallback(
    (text: string) => setProblem((p) => (p && p.id === id ? p : { id, text })),
    [id],
  );
  const env = useMemo<LayoutEnv>(
    () => ({ sessionId, scope, send, register }),
    [sessionId, scope, send, register],
  );

  // children register in their layout effects, which run before this one: check what is there
  useLayoutEffect(() => {
    if (!Chosen || failed || id === 'classic') return;
    const { mush, input } = counts.current;
    if (mush !== 1 || input !== 1) {
      report(`a layout must contain exactly one <Mush /> and one <InputBar /> (found ${mush} and ${input})`);
    }
  }, [Chosen, failed, id, report]);

  useEffect(() => {
    setProblem((p) => (p && p.id !== id ? null : p));
  }, [id]);

  const Layout = !Chosen || failed ? Classic : Chosen;
  const reason = failed ? problem?.text : !Chosen ? `no layout named "${id}"` : undefined;
  return (
    <LayoutContext.Provider value={env}>
      {reason && (
        <div className="lay-notice" role="alert">
          Layout "{id}" is not used: {reason}. Showing the classic layout.
        </div>
      )}
      <Guard key={`${id}:${failed}`} onError={(e) => report(e.message)}>
        <Layout />
      </Guard>
    </LayoutContext.Provider>
  );
}
