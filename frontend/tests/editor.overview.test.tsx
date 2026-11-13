import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { resetStores, useSessions, useSettings, useUi } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { clearDrafts } from '../src/lib/drafts';
import { getObject, resetEditor } from '../src/state/editorStore';
import { detailsKey, resetDetails, setFlag, useDetails } from '../src/state/detailsStore';
import { fitChips, loadOverviewCollapsed, overviewKey, shortExpr } from '../src/lib/editor/props';
import { worldKey } from '../src/lib/worldkey';
import { stubLayout } from './helpers';

let restore: () => void;
let engine: MockEngine;
beforeEach(() => {
  restore = stubLayout();
  resetStores();
  resetEditor();
  resetDetails();
  clearHistories();
  clearDrafts();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  engine?.dispose();
  restore();
});

async function open(target = '#12'): Promise<MockEngine> {
  engine = new MockEngine({ scenario: 'demo' });
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  await screen.findByLabelText('Command input');
  act(() => useUi.getState().openDialog(null));
  const input = screen.getByLabelText('Command input');
  await userEvent.click(input);
  await userEvent.type(input, `/edit ${target}{Enter}`);
  await screen.findByTestId('editor-workspace');
  await screen.findByRole('region', { name: 'Object overview' });
  return engine;
}
const fgSid = (): string => useSessions.getState().fg ?? '';
const ov = (): HTMLElement => screen.getByRole('region', { name: 'Object overview' });

describe('overview helpers', () => {
  it('shortens expressions and fits chips to a budget', () => {
    expect(shortExpr('=#123 | flag^WIZARD', 40)).toBe('=#123 | flag^WIZARD');
    expect(shortExpr('a'.repeat(60), 10)).toBe('aaaaaaaaa…');
    expect(shortExpr('  a   b  ')).toBe('a b');
    const names = ['ABODE', 'DARK', 'ENTER_OK', 'HALT', 'INHERIT'];
    const r = fitChips(names, (s) => s, 24);
    expect(r.shown.length + r.more).toBe(5);
    expect(r.more).toBeGreaterThan(0);
    expect(fitChips(['VERY_LONG_NAME_THAT_EXCEEDS'], (s) => s, 4)).toEqual({
      shown: ['VERY_LONG_NAME_THAT_EXCEEDS'],
      more: 0,
    });
    expect(fitChips([], (s: string) => s, 10)).toEqual({ shown: [], more: 0 });
  });
});

describe('overview header', () => {
  it('shows identity, flags, powers and locks above the attribute editor, from one shared fetch', async () => {
    const e = await open();
    const o = within(ov());
    expect(await o.findByText('Command Console')).toBeTruthy();
    expect(o.getByText('(#12)')).toBeTruthy();
    expect(o.getByText('Thing')).toBeTruthy();
    expect(o.getByRole('button', { name: 'Nveid' })).toBeTruthy(); // owner
    expect(o.getByRole('button', { name: 'Lobby' })).toBeTruthy(); // location
    expect(o.getByRole('group', { name: 'Flags, 2' })).toBeTruthy();
    expect(o.getByRole('group', { name: 'Powers, 0' }).textContent).toContain('none');
    expect(o.getByRole('group', { name: 'Locks, 4' })).toBeTruthy();
    expect(o.getByRole('button', { name: /^Basic: =#45/ }).getAttribute('title')).toContain('Flags: visual');
    // it is rendered before the attribute list/editor in the DOM
    const body = document.querySelector('.ew-body')!;
    expect(ov().compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // one fetch is shared with the details view
    await userEvent.click(screen.getByRole('button', { name: /Object details/ }));
    await screen.findByTestId('details-pane');
    expect(e.game.calls.filter((c) => c.method === 'details').length).toBe(1);
  });

  it('clicking a chip or label jumps to the section of Object details; + opens the add flow', async () => {
    await open();
    const o = within(ov());
    await userEvent.click(o.getByRole('button', { name: 'DARK' }));
    await screen.findByTestId('details-pane');
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Flags'));
    await userEvent.click(o.getByRole('button', { name: 'Add power' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Add power' })),
    );
    await userEvent.click(o.getByRole('button', { name: 'Add lock' }));
    await screen.findByRole('dialog', { name: 'New lock' });
    await userEvent.keyboard('{Escape}');
    await userEvent.click(o.getByRole('button', { name: /^Locks/ }));
    await waitFor(() => expect(document.activeElement?.textContent).toMatch(/^Locks/));
  });

  it('owner and location open that object in a tab', async () => {
    await open();
    await userEvent.click(within(ov()).getByRole('button', { name: 'Lobby' }));
    await screen.findByRole('tab', { name: /Lobby/ });
  });

  it('is refreshed after a change made in the editor and by its Refresh button', async () => {
    const e = await open();
    await within(ov()).findByRole('button', { name: 'DARK' });
    await act(async () => {
      await setFlag(fgSid(), '#12', 'DARK', false);
    });
    await waitFor(() => expect(within(ov()).queryByRole('button', { name: 'DARK' })).toBeNull());
    e.game.objects.get('#12')!.flagNames = ['OPAQUE'];
    await userEvent.click(within(ov()).getByRole('button', { name: 'Refresh the object overview' }));
    await within(ov()).findByRole('button', { name: 'OPAQUE' });
  });

  it('truncates long groups with +N more, which expands', async () => {
    const e = await open();
    e.game.objects.get('#12')!.flagNames = [
      'ABODE',
      'DARK',
      'ENTER_OK',
      'HALT',
      'INHERIT',
      'JUMP_OK',
      'LINK_OK',
      'NO_COMMAND',
      'OPAQUE',
    ];
    await userEvent.click(within(ov()).getByRole('button', { name: 'Refresh the object overview' }));
    const flags = within(await within(ov()).findByRole('group', { name: 'Flags, 9' }));
    const more = await flags.findByRole('button', { name: /more$/ });
    const n = Number(/\+(\d+)/.exec(more.textContent ?? '')![1]);
    expect(n).toBeGreaterThan(0);
    await userEvent.click(more);
    expect(within(ov()).getByRole('button', { name: 'OPAQUE' })).toBeTruthy();
    expect(flags.queryByRole('button', { name: /more$/ })).toBeNull();
  });

  it('shows a read-only badge and disables adding for objects you do not control', async () => {
    await open('#14');
    const o = within(ov());
    expect(await o.findByText(/read-only/)).toBeTruthy();
    expect((o.getByRole('button', { name: 'Add flag' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('collapses to one line and remembers it per world', async () => {
    await open();
    await userEvent.click(within(ov()).getByRole('button', { name: 'Collapse the object overview' }));
    expect(within(ov()).queryByRole('group', { name: /^Flags/ })).toBeNull();
    const s = useSessions.getState().sessions[fgSid()];
    expect(window.localStorage.getItem(overviewKey(worldKey(s)))).toBe('1');
    expect(loadOverviewCollapsed(worldKey(s))).toBe(true);
    await userEvent.click(within(ov()).getByRole('button', { name: 'Expand the object overview' }));
    expect(within(ov()).getByRole('group', { name: /^Flags/ })).toBeTruthy();
    expect(window.localStorage.getItem(overviewKey(worldKey(s)))).toBe('0');
  });

  it('shows a skeleton while loading and a one-line warning with Retry on error', async () => {
    engine = new MockEngine({ scenario: 'demo' });
    render(<App engine={engine} />);
    await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
    await screen.findByLabelText('Command input');
    act(() => useUi.getState().openDialog(null));
    engine.game.latencyMs = 150;
    engine.game.failNext.push({ method: 'details', result: { code: 'timeout', error: 'engine: timeout' } });
    const input = screen.getByLabelText('Command input');
    await userEvent.click(input);
    await userEvent.type(input, '/edit #12{Enter}');
    await screen.findByLabelText('Loading the object overview');
    const retry = await within(await screen.findByRole('region', { name: 'Object overview' })).findByRole(
      'button',
      { name: 'Retry' },
    );
    engine.game.latencyMs = 0;
    await userEvent.click(retry);
    await within(ov()).findByText('Command Console');
  });

  it('never prints to the terminal or records history', async () => {
    const e = await open();
    await within(ov()).findByText('Command Console');
    expect(e.sent).toEqual([]);
    const h = await e.history(fgSid(), '', { limit: 20 } as never);
    expect(h.entries.map((x) => x.text)).toEqual(['/edit #12']);
    expect(getObject(fgSid(), '#12')?.name).toBe('Command Console');
    expect(useDetails.getState().entries[detailsKey(fgSid(), '#12')]?.data?.name).toBe('Command Console');
  });
});
