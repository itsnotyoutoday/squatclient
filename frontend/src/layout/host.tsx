import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';
import type { SessionInfo } from '../api/types';
import { useSettings, useUi } from '../state/stores';
import { Classic, findBuiltin } from './builtin';
import { LayoutConsent } from './consent';
import { LayoutContext } from './context';
import { useUserLayout } from './loader';
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
  // a user layout: compiled by the engine, run only once the user allowed it
  const [skipped, setSkipped] = useState<string | null>(null);
  const user = useUserLayout(id, !Custom && !builtin && skipped !== id);
  const Chosen: ComponentType | undefined =
    Custom ?? builtin?.component ?? (user.status === 'ready' ? user.Component : undefined);
  const css = user.status === 'ready' ? user.bundle.css : undefined;
  useEffect(() => {
    if (!css) return;
    const el = document.createElement('style');
    el.dataset.layout = id;
    el.textContent = css;
    document.head.appendChild(el);
    return () => el.remove();
  }, [css, id]);
  // the layout's <lua> block runs in the engine for as long as this layout is shown
  const lua = user.status === 'ready' ? user.bundle.lua : undefined;
  useEffect(() => {
    if (!engine || !lua) return;
    void engine.setLayoutLua(id, lua).catch((e: unknown) => {
      useUi.getState().toast('warn', `Layout "${id}" Lua: ${e instanceof Error ? e.message : String(e)}`);
    });
    return () => {
      void engine.setLayoutLua('', '').catch(() => undefined);
    };
  }, [engine, id, lua]);
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
  const waiting =
    !Custom && !builtin && (user.status === 'loading' || user.status === 'consent' || skipped === id);
  const reason = failed
    ? problem?.text
    : user.status === 'error' && !builtin && !Custom
      ? user.message
      : !Chosen && !waiting && !builtin && user.status === 'off'
        ? `no layout named "${id}"`
        : undefined;
  return (
    <LayoutContext.Provider value={env}>
      {reason && (
        <div className="lay-notice" role="alert">
          Layout "{id}" is not used: {reason}. Showing the classic layout.
        </div>
      )}
      {user.status === 'consent' && !builtin && !Custom && skipped !== id && (
        <LayoutConsent bundle={user.bundle} onUseClassic={() => setSkipped(id)} />
      )}
      <Guard key={`${id}:${failed}`} onError={(e) => report(e.message)}>
        <Layout />
      </Guard>
    </LayoutContext.Provider>
  );
}
