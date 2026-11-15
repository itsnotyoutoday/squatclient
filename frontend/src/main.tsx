import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createEngine, hasWails } from './api';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installProblemCapture } from './lib/problems';

installProblemCapture();
// macOS uses an integrated title bar (ADR 0002): reserve the traffic-light area.
if (hasWails() && /Mac/.test(navigator.userAgent)) document.documentElement.classList.add('mac-titlebar');
// dev only (vite serve): lets a browser preview feed recorded game data into the layouts
if (import.meta.env.DEV || import.meta.env.MODE === 'hook') {
  void Promise.all([import('./layout/store'), import('./state/stores')]).then(([l, st]) => {
    (window as unknown as Record<string, unknown>).__squat = {
      layoutData: l.useLayoutData,
      sessions: st.useSessions,
      settings: st.useSettings,
      ui: st.useUi,
    };
  });
}
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App engine={createEngine()} />
    </ErrorBoundary>
  </StrictMode>,
);
