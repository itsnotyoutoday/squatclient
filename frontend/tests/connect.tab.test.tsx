import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { resetStores, useSessions, useSettings, useUi } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { stubLayout } from './helpers';

// Connecting to a world puts you in that world: its tab is the active one when the connect finishes, wherever you were before.
beforeEach(() => {
  stubLayout();
  resetStores();
  clearHistories();
});
afterEach(cleanup);

async function boot(scenario: 'demo' | 'empty'): Promise<MockEngine> {
  const engine = new MockEngine({ scenario });
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  return engine;
}

describe('connecting makes that world the active tab', () => {
  it('from the Home tab, with no world open', async () => {
    const engine = await boot('empty');
    expect(useUi.getState().consoleOpen || !useSessions.getState().fg).toBe(true);
    const info = await act(async () => engine.connect({ host: 'example.org', port: 4201, tls: false }));
    await waitFor(() => expect(useSessions.getState().fg).toBe(info.id));
    expect(useUi.getState().consoleOpen).toBe(false); // the world is shown, not the Home tab
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('example.org');
  });

  it('while another world is in front', async () => {
    const engine = await boot('demo');
    await waitFor(() => expect(useSessions.getState().order.length).toBeGreaterThan(1));
    const first = useSessions.getState().fg;
    const info = await act(async () => engine.connect({ host: 'later.example', port: 4201, tls: false }));
    expect(info.id).not.toBe(first);
    await waitFor(() => expect(useSessions.getState().fg).toBe(info.id));
    expect(useUi.getState().consoleOpen).toBe(false);
  });

  it('while the Home tab is showing and worlds are already open', async () => {
    const engine = await boot('demo');
    await waitFor(() => expect(useSessions.getState().order.length).toBeGreaterThan(1));
    await userEvent.click(screen.getByTestId('console-tab'));
    expect(useUi.getState().consoleOpen).toBe(true);
    const info = await act(async () => engine.connect({ host: 'third.example', port: 4201, tls: false }));
    await waitFor(() => expect(useSessions.getState().fg).toBe(info.id));
    expect(useUi.getState().consoleOpen).toBe(false);
  });

  it('but the startup auto-connect does not steal the tab you are on', async () => {
    const engine = await boot('demo');
    await waitFor(() => expect(useSessions.getState().order.length).toBeGreaterThan(1));
    const first = useSessions.getState().fg;
    await act(async () => engine.connect({ host: 'auto.example', port: 4201, tls: false, noFocus: true } as never));
    await new Promise((r) => setTimeout(r, 30));
    expect(useSessions.getState().fg).toBe(first);
  });
});

describe('a TinyFugue world opened through a squatter', () => {
  it('becomes the active tab too', async () => {
    const engine = new MockEngine({ scenario: 'tf' }); // a paired TinyFugue squatter with one world already open
    render(<App engine={engine} />);
    await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
    await waitFor(() => expect(useSessions.getState().order.length).toBeGreaterThan(0));
    const first = useSessions.getState().fg;
    const si = await act(async () => engine.connectTFWorld('sq-tf', 'beta')); // a world of that squatter that is not open yet
    expect(si.id).not.toBe(first);
    await waitFor(() => expect(useSessions.getState().fg).toBe(si.id));
    expect(useUi.getState().consoleOpen).toBe(false);
  });
});

describe('reconnecting an ended session', () => {
  it('shows the world it just reconnected, not whichever tab sat beside the old one', async () => {
    const engine = await boot('demo');
    await waitFor(() => expect(useSessions.getState().order.length).toBeGreaterThan(2));
    const order = useSessions.getState().order;
    const dead = order[1];
    act(() => engine.endSession(dead, 'closed'));
    await waitFor(() => expect(useSessions.getState().sessions[dead]?.state).toBe('ended'));
    act(() => useSessions.getState().setFg(dead));
    const banner = await screen.findByTestId('ended-banner');
    const before = new Set(useSessions.getState().order);
    await userEvent.click(within(banner).getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(useSessions.getState().order.some((id) => !before.has(id))).toBe(true));
    const fresh = useSessions.getState().order.find((id) => !before.has(id));
    await waitFor(() => expect(useSessions.getState().fg).toBe(fresh));
    expect(useSessions.getState().sessions[dead]).toBeUndefined(); // the ended tab is gone
    // and it stays there: closing the ended tab must not push another world to the engine and be sent back
    await new Promise((r) => setTimeout(r, 20));
    expect(useSessions.getState().fg).toBe(fresh);
  });

  it('shows the new world BEFORE closing the ended tab (closing the tab you are on picks whatever sat beside it)', async () => {
    const engine = await boot('demo');
    await waitFor(() => expect(useSessions.getState().order.length).toBeGreaterThan(2));
    const dead = useSessions.getState().order[1];
    act(() => engine.endSession(dead, 'closed'));
    await waitFor(() => expect(useSessions.getState().sessions[dead]?.state).toBe('ended'));
    act(() => useSessions.getState().setFg(dead));
    // what the window was showing at the moment the ended tab was closed: it must already be the new session, never the dead one
    let fgAtDismiss: string | null = 'not called';
    const before = new Set(useSessions.getState().order);
    const realDismiss = engine.dismiss.bind(engine);
    engine.dismiss = async (id: string) => {
      fgAtDismiss = useSessions.getState().fg;
      return realDismiss(id);
    };
    const banner = await screen.findByTestId('ended-banner');
    await userEvent.click(within(banner).getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(fgAtDismiss).not.toBe('not called'));
    const fresh = useSessions.getState().order.find((id) => !before.has(id));
    expect(fgAtDismiss).toBe(fresh);
    expect(fgAtDismiss).not.toBe(dead);
  });

  it('closing a tab you are not on leaves the world in front alone', async () => {
    const engine = await boot('demo');
    await waitFor(() => expect(useSessions.getState().order.length).toBeGreaterThan(2));
    const [a, b] = useSessions.getState().order;
    act(() => useSessions.getState().setFg(b));
    act(() => engine.endSession(a, 'closed'));
    await waitFor(() => expect(useSessions.getState().sessions[a]?.state).toBe('ended'));
    await act(async () => engine.dismiss(a));
    await waitFor(() => expect(useSessions.getState().sessions[a]).toBeUndefined());
    expect(useSessions.getState().fg).toBe(b);
  });
});
