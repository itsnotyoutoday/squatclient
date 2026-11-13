import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { DEFAULT_SETTINGS } from '../src/api/types';
import { useSettings } from '../src/state/stores';

afterEach(() => vi.restoreAllMocks());

describe('squatter reconnect after sleep / network return', () => {
  it('defaults to automatic reconnect', () => {
    expect(DEFAULT_SETTINGS.autoReconnectSquatters).toBe(true);
  });

  it('nudges lost squatter links when the network returns or the window is shown again, throttled', async () => {
    const engine = new MockEngine({ scenario: 'demo' });
    const spy = vi.spyOn(engine, 'nudgeSquatters');
    render(<App engine={engine} />);
    await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
    spy.mockClear();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(spy).toHaveBeenCalledTimes(1);
    // a burst of focus/visibility events right after must not flood the engine
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
