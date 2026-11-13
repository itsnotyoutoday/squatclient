import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createEngine, hasWails } from './api';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { loadStoredThemes, parseTheme } from './themes';

loadStoredThemes(parseTheme);
// macOS uses an integrated title bar (ADR 0002): reserve the traffic-light area.
if (hasWails() && /Mac/.test(navigator.userAgent)) document.documentElement.classList.add('mac-titlebar');
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App engine={createEngine()} />
    </ErrorBoundary>
  </StrictMode>,
);
