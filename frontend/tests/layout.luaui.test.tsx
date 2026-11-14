import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { resetLayoutData, useLayoutData } from '../src/layout/store';
import { resetStores, useSessions, useSettings } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { stubLayout } from './helpers';

let restore: () => void;
let engine: MockEngine;
beforeEach(() => {
  restore = stubLayout();
  resetStores();
  resetLayoutData();
  clearHistories();
});
afterEach(() => {
  cleanup();
  engine?.dispose();
  restore();
});

const WHO = {
  who: {
    id: 'who',
    title: "Who's online",
    kind: 'window',
    x: 50,
    y: 40,
    body: {
      type: 'column',
      children: [
        { type: 'heading', value: 'Players' },
        {
          type: 'table',
          columns: [
            { key: 'name', title: 'Name' },
            { key: 'room', title: 'Room' },
          ],
          rows: [
            { name: 'god', room: 'Limbo' },
            { name: 'ann', room: 'Plaza' },
          ],
        },
        { type: 'button', text: 'Refresh', send: '/who-refresh' },
        { type: 'gauge', label: 'Load', value: 3, max: 10 },
        { type: 'input', placeholder: 'Find topic', send: '/help-find {value}' },
        { type: 'bogus', children: [{ type: 'text', value: 'ignored' }] },
      ],
    },
  },
};

async function boot(): Promise<string> {
  engine = new MockEngine({ scenario: 'demo' });
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  await waitFor(() => expect(useSessions.getState().fg).toBeTruthy());
  return useSessions.getState().fg as string;
}

describe('windows and panels opened by Lua', () => {
  it('draws a window from the "ui.windows" variable, with buttons, inputs and tables', async () => {
    const sid = await boot();
    expect(screen.queryByRole('dialog', { name: "Who's online" })).toBeNull();
    act(() => useLayoutData.getState().setLua({ 'ui.windows': WHO }));
    const win = await screen.findByRole('dialog', { name: "Who's online" });
    expect(within(win).getByRole('columnheader', { name: 'Room' })).toBeInTheDocument();
    expect(within(win).getByText('ann')).toBeInTheDocument();
    expect(within(win).getByRole('progressbar', { name: 'Load' })).toHaveAttribute('aria-valuenow', '3');
    expect(within(win).queryByText('ignored')).toBeNull(); // unknown node types draw nothing
    await userEvent.click(within(win).getByRole('button', { name: 'Refresh' }));
    expect(engine.sent.at(-1)).toEqual({ session: sid, text: '/who-refresh' });
    await userEvent.type(within(win).getByLabelText('Find topic'), 'look{Enter}');
    expect(engine.sent.at(-1)).toEqual({ session: sid, text: '/help-find look' });
  });

  it("the × removes the window from Lua's variable too", async () => {
    await boot();
    act(() => useLayoutData.getState().setLua({ 'ui.windows': WHO }));
    const win = await screen.findByRole('dialog', { name: "Who's online" });
    await userEvent.click(within(win).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: "Who's online" })).toBeNull());
    expect((await engine.luaVars())['ui.windows']).toBeUndefined();
  });

  it('a window closed from Lua disappears', async () => {
    await boot();
    act(() => useLayoutData.getState().setLua({ 'ui.windows': WHO }));
    await screen.findByRole('dialog', { name: "Who's online" });
    act(() => useLayoutData.getState().setLua({ 'ui.windows': undefined }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: "Who's online" })).toBeNull());
  });
});
