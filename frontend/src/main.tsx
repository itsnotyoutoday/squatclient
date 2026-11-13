import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createEngine } from './api';
import { App } from './App';
import { loadStoredThemes, parseTheme } from './themes';

loadStoredThemes(parseTheme);
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App engine={createEngine()} />
  </StrictMode>,
);
