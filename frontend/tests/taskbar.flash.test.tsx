import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { resetStores, useSessions, useSettings } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { stubLayout } from './helpers';

let engine: MockEngine;
let focused = false;
beforeEach(() => {
  stubLayout();
  resetStores();
  clearHistories();
  focused = false;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function boot(): Promise<string> {
  engine = new MockEngine({ scenario: 'demo' });
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  await waitFor(() => expect(useSessions.getState().fg).toBeTruthy());
  return useSessions.getState().fg as string;
}

describe('taskbar activity light', () => {
  it('lights when new text arrives in a background window, clears when the window is focused again', async () => {
    const id = await boot();
    engine.attention.length = 0;
    act(() => void engine.pushLine(id, [{ s: 'something happened' }]));
    await waitFor(() => expect(engine.attention).toEqual([true]));
    act(() => void engine.pushLine(id, [{ s: 'and again' }]));
    expect(engine.attention).toEqual([true]); // lit once, not on every line
    focused = true;
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(engine.attention).toEqual([true, false]));
  });

  it('stays dark while the window is focused, and when the setting is off', async () => {
    const id = await boot();
    engine.attention.length = 0;
    focused = true;
    act(() => void engine.pushLine(id, [{ s: 'seen at once' }]));
    focused = false;
    useSettings.getState().set({ ...useSettings.getState().settings, taskbarFlash: false });
    act(() => void engine.pushLine(id, [{ s: 'setting is off' }]));
    await new Promise((r) => setTimeout(r, 50));
    expect(engine.attention).toEqual([]);
  });
});
