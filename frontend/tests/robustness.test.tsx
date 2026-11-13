import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { WailsEngine } from '../src/api/wails';

function Boom(): never {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  it('shows an error panel instead of a blank window', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/kaboom/)).toBeTruthy();
    expect(screen.getByText('Copy details')).toBeTruthy();
  });
  it('renders children normally', () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('fine')).toBeTruthy();
  });
});

describe('WailsEngine null lists (Go nil slice -> JSON null)', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).go;
    delete (window as unknown as Record<string, unknown>).runtime;
  });
  it('turns null into [] for every list-returning call', async () => {
    const nul = () => Promise.resolve(null);
    (window as unknown as Record<string, unknown>).go = {
      main: { App: { ListWorlds: nul, ListSquatters: nul, ListSessions: nul, Scrollback: nul, Search: nul } },
    };
    (window as unknown as Record<string, unknown>).runtime = { EventsOn: () => () => undefined };
    const e = new WailsEngine();
    expect(await e.listWorlds()).toEqual([]);
    expect(await e.listSquatters()).toEqual([]);
    expect(await e.listSessions()).toEqual([]);
    expect(await e.scrollback('s', { limit: 10 })).toEqual([]);
    expect(await e.search('s', 'x', {})).toEqual([]);
  });
});
