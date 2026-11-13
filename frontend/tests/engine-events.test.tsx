import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import type { EngineEventName, EngineEvents } from '../src/api/types';
import { resetStores, useSessions, useSettings, useUi } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { stubLayout } from './helpers';

let restore: () => void;
let engine: MockEngine;
beforeEach(() => {
  restore = stubLayout();
  resetStores();
  clearHistories();
});
afterEach(() => {
  cleanup();
  engine?.dispose();
  restore();
});

async function boot(): Promise<MockEngine> {
  engine = new MockEngine({ scenario: 'demo' });
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  await waitFor(() => expect(Object.keys(useSessions.getState().sessions).length).toBeGreaterThan(1));
  return engine;
}

/** Simulate an event pushed by the Go side. */
function push<E extends EngineEventName>(e: MockEngine, name: E, payload: EngineEvents[E]): void {
  act(() => (e as unknown as { emit: (n: E, p: EngineEvents[E]) => void }).emit(name, payload));
}

describe('events added by the Go app (UI-CONTRACT-NOTES 1, 3)', () => {
  it('session-removed drops the session', async () => {
    const e = await boot();
    const id = useSessions.getState().order[0];
    push(e, 'session-removed', { id });
    expect(useSessions.getState().sessions[id]).toBeUndefined();
  });

  it('foreground switches the visible session only for known ids', async () => {
    const e = await boot();
    const [a, b] = useSessions.getState().order;
    act(() => useSessions.getState().setFg(a));
    push(e, 'foreground', { session: b });
    expect(useSessions.getState().fg).toBe(b);
    push(e, 'foreground', { session: 'ghost' });
    expect(useSessions.getState().fg).toBe(b);
  });

  it('menu actions open dialogs', async () => {
    const e = await boot();
    push(e, 'menu', { action: 'quick-connect' });
    expect(useUi.getState().dialog).toBe('quick');
    act(() => useUi.getState().openDialog(null));
    push(e, 'menu', { action: 'settings' });
    expect(useUi.getState().dialog).toBe('settings');
    act(() => useUi.getState().openDialog(null));
    push(e, 'menu', { action: 'unknown-action' });
    expect(useUi.getState().dialog).toBeNull();
  });

  it('reset refetches scrollback for the session', async () => {
    const e = await boot();
    const id = useSessions.getState().order[0];
    const before = [] as string[];
    const orig = e.scrollback.bind(e);
    e.scrollback = async (...args: Parameters<typeof orig>) => {
      before.push(args[0]);
      return orig(...args);
    };
    push(e, 'reset', { session: id });
    await waitFor(() => expect(before).toContain(id));
  });
});
