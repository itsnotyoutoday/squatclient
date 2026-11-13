import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { resetStores, useSessions, useSettings, useUi } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { stubLayout } from './helpers';
import { dark } from '../src/themes/builtin';
const rgbOf = (hex: string): string =>
  `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;

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

async function boot(scenario: 'demo' | 'empty' = 'demo'): Promise<MockEngine> {
  engine = new MockEngine({ scenario });
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  return engine;
}

describe('App smoke (mock mode)', () => {
  it('loads and renders a coloured line', async () => {
    await boot();
    await waitFor(() => expect(document.querySelectorAll('.row').length).toBeGreaterThan(0));
    // the grand atrium room is rendered with ANSI 14 bold ("cyan")
    const el = (await screen.findAllByText('The Grand Atrium'))[0];
    expect(el.style.color).toBe(rgbOf(dark.ansi[14])); // from the theme, never hard-coded
    expect(el.className).toContain('b');
    expect(screen.getByRole('tablist', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Status' })).toBeInTheDocument();
  });

  it('has landmarks: header/main/footer and a labelled input', async () => {
    await boot();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByLabelText('Command input')).toBeInTheDocument();
  });

  it('shows the empty state when there are no sessions', async () => {
    await boot('empty');
    expect(screen.getByText(/Open a world/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the "While you were away" summary at startup with unread and ended sessions', async () => {
    await boot();
    const dlg = await screen.findByRole('dialog', { name: 'While you were away' });
    expect(within(dlg).getByText('Old Realm')).toBeInTheDocument();
    expect(within(dlg).getByText(/ended: The server closed the connection/)).toBeInTheDocument();
    expect(within(dlg).getByText('Moon Base Alpha')).toBeInTheDocument();
    expect(within(dlg).getAllByText(/\d+ new/).length).toBeGreaterThan(0);
    expect(within(dlg).queryByText('Hogwarts MUSH')).toBeNull(); // caught up
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not show the summary when nothing needs attention', async () => {
    await boot('empty');
    await engine.connect({ host: 'h', port: 1, tls: false });
    expect(screen.queryByRole('dialog', { name: 'While you were away' })).toBeNull();
  });

  it('switches sessions with Alt-N and shows unread/ended markers on tabs', async () => {
    await boot();
    await userEvent.keyboard('{Escape}');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(within(tabs[1]).getByLabelText(/\d+ unread/)).toBeInTheDocument();
    expect(within(tabs[2]).getByText('ended')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '2', code: 'Digit2', altKey: true });
    await waitFor(() => expect(useSessions.getState().fg).toBe(useSessions.getState().order[1]));
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
    // switching acks: unread clears
    await waitFor(() =>
      expect(useSessions.getState().sessions[useSessions.getState().order[1]].unread).toBe(0),
    );
  });

  it('cycles with Ctrl-Tab', async () => {
    await boot();
    await userEvent.keyboard('{Escape}');
    const first = useSessions.getState().fg;
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
    expect(useSessions.getState().fg).not.toBe(first);
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(useSessions.getState().fg).toBe(first);
  });
});

describe('ended session view', () => {
  it('shows the humanised reason, time, last text, and Connect again / Dismiss', async () => {
    const e = await boot();
    await userEvent.keyboard('{Escape}');
    const ended = Object.values(useSessions.getState().sessions).find((s) => s.state === 'ended');
    expect(ended).toBeDefined();
    act(() => useSessions.getState().setFg(ended?.id ?? null));
    const banner = await screen.findByTestId('ended-banner');
    expect(banner).toHaveTextContent('The server closed the connection');
    expect(banner).toHaveTextContent(/Ended (\d|[A-Z][a-z]{2} \d)/);
    expect(banner).toHaveTextContent(`Last text: ${ended?.lastText}`);
    expect(screen.queryByLabelText('Command input')).toBeNull();

    // Connect again: opens a new connection to the same world and drops the ended one
    await userEvent.click(within(banner).getByRole('button', { name: 'Connect again' }));
    await waitFor(async () => {
      const list = await e.listSessions();
      expect(list.filter((s) => s.host === ended?.host).length).toBe(1);
      expect(list.find((s) => s.host === ended?.host)?.state).not.toBe('ended');
    });
    expect(useSessions.getState().sessions[ended?.id ?? '']).toBeUndefined();
  });

  it('Dismiss removes the session', async () => {
    const e = await boot();
    await userEvent.keyboard('{Escape}');
    const ended = Object.values(useSessions.getState().sessions).find((s) => s.state === 'ended');
    act(() => useSessions.getState().setFg(ended?.id ?? null));
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(useSessions.getState().sessions[ended?.id ?? '']).toBeUndefined());
    expect((await e.listSessions()).some((s) => s.id === ended?.id)).toBe(false);
  });

  it('a live session going ended swaps the input for the banner', async () => {
    const e = await boot();
    await userEvent.keyboard('{Escape}');
    const id = useSessions.getState().fg as string;
    expect(screen.getByLabelText('Command input')).toBeInTheDocument();
    act(() => e.endSession(id, 'timeout', 'read timeout'));
    expect(await screen.findByTestId('ended-banner')).toHaveTextContent('The connection timed out');
  });
});

describe('input line', () => {
  it('sends text through engine.input (never parsing commands), Enter clears', async () => {
    const e = await boot();
    await userEvent.keyboard('{Escape}');
    const box = screen.getByLabelText('Command input');
    await userEvent.type(box, '/def foo = bar{Enter}');
    expect(e.sent.at(-1)).toMatchObject({ text: '/def foo = bar' });
    expect(box).toHaveValue('');
  });

  it('Up recalls history; Shift+Enter inserts a newline and sends line by line', async () => {
    const e = await boot();
    await userEvent.keyboard('{Escape}');
    const box = screen.getByLabelText('Command input');
    await userEvent.type(box, 'north{Enter}');
    await userEvent.keyboard('{ArrowUp}');
    expect(box).toHaveValue('north');
    await userEvent.clear(box);
    await userEvent.type(box, 'one{Shift>}{Enter}{/Shift}two{Enter}');
    const texts = e.sent.map((s) => s.text);
    expect(texts.slice(-2)).toEqual(['one', 'two']);
  });

  it('multi-line paste sends each line', async () => {
    const e = await boot();
    await userEvent.keyboard('{Escape}');
    const box = screen.getByLabelText('Command input');
    box.focus();
    await userEvent.paste('a\nb\nc\n');
    expect(e.sent.slice(-3).map((s) => s.text)).toEqual(['a', 'b', 'c']);
  });

  it('applies emacs keys: Ctrl-A, Ctrl-K, Ctrl-Y', async () => {
    await boot();
    await userEvent.keyboard('{Escape}');
    const box = screen.getByLabelText('Command input') as HTMLTextAreaElement;
    await userEvent.type(box, 'hello world');
    await userEvent.keyboard('{Control>}a{/Control}');
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(box).toHaveValue('');
    await userEvent.keyboard('{Control>}y{/Control}');
    expect(box).toHaveValue('hello world');
  });

  it('masks input for remote echo (password) and keeps it out of history', async () => {
    const e = await boot();
    await userEvent.keyboard('{Escape}');
    const pw = Object.values(useSessions.getState().sessions).find((s) => s.remoteEcho);
    act(() => useSessions.getState().setFg(pw?.id ?? null));
    const box = await screen.findByLabelText('Password input');
    expect(box).toHaveAttribute('type', 'password');
    await userEvent.type(box, 'hunter2{Enter}');
    expect(e.sent.at(-1)).toMatchObject({ text: 'hunter2' });
    await waitFor(() => expect(screen.getByLabelText('Command input')).toBeInTheDocument());
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByLabelText('Command input')).toHaveValue('');
  });
});

describe('search', () => {
  it('opens with Ctrl-Shift-F, highlights matches, navigates, closes with Escape', async () => {
    await boot();
    await userEvent.keyboard('{Escape}');
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true, shiftKey: true });
    const box = await screen.findByRole('searchbox', { name: 'Search text' });
    await userEvent.type(box, 'stained');
    await waitFor(() => expect(document.querySelectorAll('.hl, .hl-cur').length).toBeGreaterThan(0));
    expect(screen.getByText(/1 \/ \d+/)).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('search')).toBeNull();
  });
});

describe('dialogs', () => {
  it('world manager: search, add, edit, connect via squatter option, delete', async () => {
    const e = await boot();
    await userEvent.keyboard('{Escape}');
    act(() => useUi.getState().openDialog('worlds'));
    const dlg = await screen.findByRole('dialog', { name: 'Worlds' });
    await userEvent.type(within(dlg).getByLabelText('Search worlds'), 'moon');
    expect(within(dlg).getByText(/Moon Base Alpha/)).toBeInTheDocument();
    expect(within(dlg).queryByText(/Hogwarts/)).toBeNull();
    await userEvent.clear(within(dlg).getByLabelText('Search worlds'));
    await userEvent.click(within(dlg).getByRole('button', { name: '+ Add world' }));
    const form = within(dlg).getByRole('form', { name: 'Edit world' });
    await userEvent.type(within(form).getByLabelText('Name'), 'Test World');
    await userEvent.type(within(form).getByLabelText('Host'), 'test.example');
    await userEvent.selectOptions(within(form).getByLabelText('Connect via'), 'sq-home');
    await userEvent.type(within(form).getByLabelText(/^Password/), 'pw');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(async () => {
      const w = (await e.listWorlds()).find((x) => x.name === 'Test World');
      expect(w).toMatchObject({
        host: 'test.example',
        via: 'sq-home',
        encoding: 'utf-8',
        tlsVerify: 'strict',
      });
      expect(w?.login?.hasPassword).toBe(true);
    });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(async () =>
      expect((await e.listWorlds()).some((x) => x.name === 'Test World')).toBe(false),
    );
  });

  it('quick connect validates and connects', async () => {
    const e = await boot('empty');
    act(() => useUi.getState().openDialog('quick'));
    const dlg = await screen.findByRole('dialog', { name: 'Quick connect' });
    const go = within(dlg).getByRole('button', { name: 'Connect' });
    expect(go).toBeDisabled();
    await userEvent.type(within(dlg).getByLabelText('Host'), 'quick.example');
    expect(go).toBeEnabled();
    await userEvent.click(go);
    await waitFor(async () =>
      expect((await e.listSessions()).some((s) => s.host === 'quick.example')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('settings apply live: theme variables and persisted via engine', async () => {
    const e = await boot();
    await userEvent.keyboard('{Escape}');
    act(() => useUi.getState().openDialog('settings'));
    const dlg = await screen.findByRole('dialog', { name: 'Settings' });
    await userEvent.selectOptions(within(dlg).getByLabelText('Theme'), 'light');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#fbfbfa');
    await userEvent.click(within(dlg).getByLabelText('Show timestamps'));
    expect(await e.getSettings()).toMatchObject({ theme: 'light', timestamps: true });
    await waitFor(() => expect(document.querySelector('.ts')).not.toBeNull());
  });

  it('squatters: pair shows fingerprint for TOFU confirmation, then confirms', async () => {
    const e = await boot();
    await userEvent.keyboard('{Escape}');
    act(() => useUi.getState().openDialog('squatters'));
    const dlg = await screen.findByRole('dialog', { name: 'Squatters' });
    await userEvent.type(within(dlg).getByLabelText('Name'), 'Office');
    await userEvent.type(within(dlg).getByLabelText('Host'), 'office.example');
    await userEvent.type(within(dlg).getByLabelText('Pair code'), 'AAAA-1111');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Pair' }));
    expect(await within(dlg).findByTestId('fingerprint')).toHaveTextContent(/^SHA256:/);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Trust and pair' }));
    await waitFor(async () =>
      expect((await e.listSquatters()).some((s) => s.name === 'Office' && s.paired)).toBe(true),
    );
    await userEvent.click(within(dlg).getByRole('button', { name: 'Remove Office' }));
    await waitFor(async () => expect((await e.listSquatters()).some((s) => s.name === 'Office')).toBe(false));
  });

  it('dialogs trap focus, are labelled, and close with Escape', async () => {
    await boot();
    await userEvent.keyboard('{Escape}');
    act(() => useUi.getState().openDialog('help'));
    // the help browser is lazy-loaded: give a busy machine (parallel test runs) more than the default 1s
    const dlg = await screen.findByRole('dialog', { name: 'SquatClient Help' }, { timeout: 5000 });
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    const close = within(dlg).getByRole('button', { name: 'Close dialog' });
    close.focus();
    await userEvent.tab();
    expect(dlg.contains(document.activeElement)).toBe(true);
    await userEvent.tab({ shift: true });
    expect(dlg.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('accessibility', () => {
  it('mirrors new lines into an aria-live region in screen-reader mode, batched', async () => {
    const e = await boot();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('live-region')).toBeNull();
    act(() => useSettings.getState().set({ ...useSettings.getState().settings, screenReader: true }));
    const region = await screen.findByTestId('live-region');
    expect(region).toHaveAttribute('aria-live', 'polite');
    const id = useSessions.getState().fg as string;
    await waitFor(() => expect(region).toHaveTextContent(''));
    await act(async () => {
      e.pushLine(id, [{ s: 'first announcement' }]);
      e.pushLine(id, [{ s: 'second announcement' }]);
      await new Promise((r) => setTimeout(r, 600));
    });
    await waitFor(() => expect(region.textContent).toContain('first announcement'));
    expect(region.textContent).toContain('second announcement'); // one batched update
  });

  it('status bar shows built-in segments and engine status fields', async () => {
    await boot();
    await userEvent.keyboard('{Escape}');
    const bar = screen.getByRole('status', { name: 'Status' });
    expect(bar).toHaveTextContent('Hogwarts MUSH');
    expect(bar).toHaveTextContent('Connected');
    expect(bar).toHaveTextContent(/Active: \d/);
    const id = useSessions.getState().fg as string;
    act(() => useSessions.getState().setStatus(id, [{ name: 'hp', text: 'HP 12/20' }]));
    expect(bar).toHaveTextContent('HP 12/20');
  });
});
