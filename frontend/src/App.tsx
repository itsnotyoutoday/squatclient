import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { EngineAPI } from './api/types';
import { startController } from './state/controller';
import type { Controller } from './state/controller';
import { ControllerContext } from './state/controller-context';
import { useSessions, useSettings, useUi } from './state/stores';
import { useTheme } from './state/hooks';
import { applyTheme } from './themes';
import { LiveRegion } from './components/output/LiveRegion';
import { getOutput } from './components/output/handle';
import { LayoutHost } from './layout/host';
import { StatusBar } from './components/statusbar/StatusBar';
import { TabBar } from './components/tabs/TabBar';
import { MenuBar } from './components/menu/MenuBar';
import { detectPlatform } from './lib/platform';
import { QuickConnect } from './components/dialogs/QuickConnect';
import { SettingsDialog } from './components/dialogs/SettingsDialog';
import { WorldManager } from './components/dialogs/WorldManager';
import { SessionSettings } from './components/dialogs/SessionSettings';
import { AboutDialog } from './components/dialogs/AboutDialog';
import { LayoutsDialog } from './components/dialogs/LayoutsDialog';
import { SquattersDialog } from './components/dialogs/SquattersDialog';
import { TFWorldsDialog } from './components/dialogs/TFWorldsDialog';
import { TFScriptsDialog } from './components/dialogs/TFScriptsDialog';
import { AwayDialog } from './components/dialogs/AwayDialog';
import HistoryBrowser from './components/history/HistoryBrowser';
import { UploadHost } from './components/upload/UploadDialog';
import { useGlobalKeys } from './global-keys';
import './styles/app.css';

// The help browser and its content load on first use, keeping the main bundle small.
const HelpBrowser = lazy(() => import('./components/help/HelpBrowser'));
// The editor workspace (/edit) loads on first use as well.
const EditorWorkspace = lazy(() => import('./components/editor/EditorWorkspace'));

function Dialogs() {
  const d = useUi((s) => s.dialog);
  switch (d) {
    case 'worlds':
      return <WorldManager />;
    case 'quick':
      return <QuickConnect />;
    case 'settings':
      return <SettingsDialog />;
    case 'squatters':
      return <SquattersDialog />;
    case 'tfworlds':
      return <TFWorldsDialog />;
    case 'tfscripts':
      return <TFScriptsDialog />;
    case 'help':
      return (
        <Suspense fallback={null}>
          <HelpBrowser />
        </Suspense>
      );
    case 'away':
      return <AwayDialog />;
    case 'history':
      return <HistoryBrowser />;
    case 'session':
      return <SessionSettings />;
    case 'about':
      return <AboutDialog />;
    case 'layouts':
      return <LayoutsDialog />;
    default:
      return null;
  }
}

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => useUi.getState().dismissToast(toasts[0].id), 6000);
    return () => clearTimeout(t);
  }, [toasts]);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`}>
          {t.text}
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => useUi.getState().dismissToast(t.id)}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}

function Workspace() {
  const fg = useSessions((s) => s.fg);
  const session = useSessions((s) => (s.fg ? s.sessions[s.fg] : undefined));

  if (!fg || !session) {
    return (
      <main className="empty" aria-label="No session">
        <h1>SquatClient</h1>
        <p>A graphical MU* client. Open a world to get started.</p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => useUi.getState().openDialog('worlds')}>
            Worlds
          </button>
          <button type="button" onClick={() => useUi.getState().openDialog('quick')}>
            Quick connect
          </button>
        </div>
      </main>
    );
  }
  return <LayoutHost session={session} />;
}

export function App({ engine }: { engine: EngineAPI }) {
  const [controller, setController] = useState<Controller | null>(null);
  const [error, setError] = useState('');
  const theme = useTheme();
  const view = useUi((s) => s.view);
  const fontFamily = useSettings((s) => s.settings.fontFamily);
  const fontSize = useSettings((s) => s.settings.fontSize);
  const unread = useSessions((s) =>
    Object.values(s.sessions).reduce((n, x) => n + (x.id === s.fg ? 0 : x.unread), 0),
  );

  useEffect(() => {
    let c: Controller | null = null;
    let dead = false;
    startController(engine)
      .then((ctl) => {
        if (dead) ctl.dispose();
        else {
          c = ctl;
          setController(ctl);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    const off = engine.on('quit', () => window.close());
    const tick = setInterval(() => useUi.getState().tick(), 1000);
    return () => {
      dead = true;
      off();
      clearInterval(tick);
      c?.dispose();
    };
  }, [engine]);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) SquatClient` : 'SquatClient';
  }, [unread]);
  useGlobalKeys(controller, getOutput);
  const platform = useMemo(() => detectPlatform(), []);

  return (
    <ControllerContext.Provider value={controller}>
      <div
        className="app"
        style={{ '--font': fontFamily, '--font-size': `${fontSize}px` } as React.CSSProperties}
      >
        <a
          className="skip"
          href="#main-input"
          onClick={(e) => {
            e.preventDefault();
            document.querySelector<HTMLElement>('.inputline textarea, .inputline input')?.focus();
          }}
        >
          Skip to input
        </a>
        <div className="titlestrip" aria-hidden="true" />
        {platform !== 'mac' && <MenuBar platform={platform} />}
        {view === 'terminal' && (
          <header>
            <TabBar />
          </header>
        )}
        {error ? (
          <p role="alert" className="err pad">
            Failed to start: {error}
          </p>
        ) : view === 'editor' ? (
          <Suspense fallback={<main className="empty" aria-busy="true" />}>
            <EditorWorkspace />
          </Suspense>
        ) : (
          <Workspace />
        )}
        <StatusBar />
        <LiveRegion />
        <Toasts />
        <Dialogs />
        <UploadHost />
      </div>
    </ControllerContext.Provider>
  );
}
