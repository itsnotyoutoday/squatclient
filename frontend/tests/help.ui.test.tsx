import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { resetStores, useSettings, useUi } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { resetHelp } from '../src/help/store';
import { openHelp } from '../src/help/command';
import { stubLayout } from './helpers';

// Load the lazy chunk (and its content) up front so the first test is not slowed by the import.
beforeAll(async () => {
  await import('../src/components/help/HelpBrowser');
}, 30_000);

let restore: () => void;
let engine: MockEngine;
beforeEach(() => {
  restore = stubLayout();
  resetStores();
  clearHistories();
  resetHelp();
});
afterEach(() => {
  cleanup();
  engine?.dispose();
  restore();
  vi.restoreAllMocks();
});

async function boot(): Promise<void> {
  engine = new MockEngine({ scenario: 'demo' });
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  await screen.findByRole('dialog', { name: 'While you were away' });
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

const helpDialog = (): Promise<HTMLElement> =>
  screen.findByRole('dialog', { name: 'SquatClient Help' }, { timeout: 5000 });
const heading = (dlg: HTMLElement): HTMLElement => within(dlg).getByRole('heading', { level: 1 });

async function typeLine(text: string): Promise<void> {
  const input = screen.getByLabelText('Command input');
  await userEvent.click(input);
  await userEvent.type(input, `${text}{Enter}`);
}

describe('/help interception', () => {
  it('opens the browser at home for a bare /help and does not send it to the engine', async () => {
    await boot();
    const spy = vi.spyOn(engine, 'input');
    await typeLine('/help');
    const dlg = await helpDialog();
    expect(heading(dlg)).toHaveTextContent('Home');
    expect(spy).not.toHaveBeenCalled();
  });

  it('opens a topic for TF-style names', async () => {
    await boot();
    const spy = vi.spyOn(engine, 'input');
    await typeLine('/help /def');
    const dlg = await helpDialog();
    await waitFor(() => expect(heading(dlg)).toHaveTextContent('Macros: /def'));
    // the looked-up term is highlighted
    expect(dlg.querySelector('mark.hit')).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('opens a search for free words', async () => {
    await boot();
    await typeLine('/help gag spam');
    const dlg = await helpDialog();
    expect(await within(dlg).findByRole('status')).toHaveTextContent(/topics? match/);
    expect(within(dlg).getByRole('searchbox', { name: 'Search help' })).toHaveValue('gag spam');
    expect(dlg.querySelector('.helpresults mark.hit')).not.toBeNull();
  });

  it('still sends other lines, including /helpful text, to the engine', async () => {
    await boot();
    const spy = vi.spyOn(engine, 'input');
    await typeLine('/helpme');
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.any(String), '/helpme'));
    expect(screen.queryByRole('dialog', { name: 'SquatClient Help' })).toBeNull();
  });

  it('opens from F1 and from the dialog state used by the menu', async () => {
    await boot();
    await userEvent.keyboard('{F1}');
    await helpDialog();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => useUi.getState().openDialog('help')); // what the controller does for the native menu action
    await helpDialog();
  });
});

describe('help browser', () => {
  it('navigates links with back and forward (Alt-Left, Alt-Right) and a breadcrumb', async () => {
    await boot();
    act(() => openHelp());
    const dlg = await helpDialog();
    await userEvent.click(
      within(dlg.querySelector('.helpbody') as HTMLElement).getAllByRole('link', {
        name: 'Getting started',
      })[0],
    );
    expect(heading(dlg)).toHaveTextContent('Getting started');
    expect(within(dlg).getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Home');
    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    expect(heading(dlg)).toHaveTextContent('Home');
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(heading(dlg)).toHaveTextContent('Getting started');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Back' }));
    expect(heading(dlg)).toHaveTextContent('Home');
  });

  it('search is instant, "/" focuses it, Escape clears then closes', async () => {
    await boot();
    act(() => openHelp('keys'));
    const dlg = await helpDialog();
    await waitFor(() => expect(heading(dlg)).toHaveTextContent('Keyboard shortcuts'));
    (document.activeElement as HTMLElement).blur();
    (dlg.querySelector('.treeitem') as HTMLElement).focus();
    await userEvent.keyboard('/');
    const box = within(dlg).getByRole('searchbox', { name: 'Search help' });
    expect(box).toHaveFocus();
    await userEvent.type(box, 'fingerprint');
    const results = await within(dlg).findByRole('region', { name: 'Search results' });
    const first = within(results).getAllByRole('button')[0];
    expect(first).toHaveTextContent('Squatter');
    await userEvent.keyboard('{Escape}');
    expect(box).toHaveValue('');
    expect(screen.getByRole('dialog', { name: 'SquatClient Help' })).toBeInTheDocument();
    await userEvent.click(box);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opening a search result goes to the topic and highlights the words', async () => {
    await boot();
    act(() => openHelp('fingerprint pinned'));
    const dlg = await helpDialog();
    const results = await within(dlg).findByRole('region', { name: 'Search results' });
    await userEvent.click(within(results).getAllByRole('button')[0]);
    await waitFor(() => expect(dlg.querySelector('.helpbody mark.hit')).not.toBeNull());
  });

  it('tree has ARIA roles and arrow-key navigation', async () => {
    await boot();
    act(() => openHelp());
    const dlg = await helpDialog();
    const tree = within(dlg).getByRole('tree', { name: 'Help topics' });
    const items = within(tree).getAllByRole('treeitem');
    expect(items[0]).toHaveAttribute('aria-selected', 'true');
    expect(items[0]).toHaveAttribute('aria-level', '1');
    items[0].focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(tree).getAllByRole('treeitem')[1]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(items[0]).toHaveFocus();
    // expand a branch with Right, open it with Enter
    const scripting = within(tree).getByRole('treeitem', { name: /The scripting language/ });
    scripting.focus();
    expect(scripting).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{ArrowRight}');
    expect(scripting).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Enter}');
    expect(heading(dlg)).toHaveTextContent('The scripting language');
  });

  it('opens external http(s) links in the system browser only and keeps internal links inside', async () => {
    await boot();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    act(() => openHelp('about'));
    const dlg = await helpDialog();
    await waitFor(() => expect(heading(dlg)).toHaveTextContent('About and credits'));
    const body = dlg.querySelector('.helpbody') as HTMLElement;
    const links = within(body).getAllByRole('link');
    const ext = links.find((a) =>
      a.getAttribute('href')?.startsWith('https://github.com/itsnotyoutoday/squatclient'),
    );
    expect(ext).toBeDefined();
    await userEvent.click(ext as HTMLElement);
    expect(open).toHaveBeenCalledWith(
      'https://github.com/itsnotyoutoday/squatclient',
      '_blank',
      'noopener,noreferrer',
    );
    expect(heading(dlg)).toHaveTextContent('About and credits');
    // no rendered link anywhere uses another scheme
    for (const a of links) expect(a.getAttribute('href')).toMatch(/^(https?:|help:|#)/);
  });

  it('Insert into input puts the snippet on the input line without sending it', async () => {
    await boot();
    const spy = vi.spyOn(engine, 'input');
    act(() => openHelp('scripting'));
    const dlg = await helpDialog();
    await waitFor(() => expect(heading(dlg)).toHaveTextContent('The scripting language'));
    const btn = within(dlg).getAllByRole('button', { name: 'Insert code into input line' })[0];
    const code = (btn.closest('.codeblock')?.querySelector('code')?.textContent ?? '').replace(/\n$/, '');
    expect(code).toContain('/set greeting=Hello');
    await userEvent.click(btn);
    expect(spy).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((screen.getByLabelText('Command input') as HTMLTextAreaElement).value).toBe(code);
    expect(spy).not.toHaveBeenCalled();
  });

  it('Copy writes the snippet to the clipboard', async () => {
    await boot();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    act(() => openHelp('scripting'));
    const dlg = await helpDialog();
    await waitFor(() => expect(heading(dlg)).toHaveTextContent('The scripting language'));
    await userEvent.click(within(dlg).getAllByRole('button', { name: 'Copy code' })[0]);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/set greeting=Hello'));
  });

  it('keeps the browser state when closed and reopened', async () => {
    await boot();
    act(() => openHelp('keys'));
    await helpDialog();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => useUi.getState().openDialog('help'));
    const dlg = await helpDialog();
    await waitFor(() => expect(heading(dlg)).toHaveTextContent('Keyboard shortcuts'));
  });
});
