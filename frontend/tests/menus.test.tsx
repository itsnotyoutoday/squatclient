import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { detectPlatform } from '../src/lib/platform';
import { resetStores, useSessions, useSettings, useUi } from '../src/state/stores';
import { waitFor } from '@testing-library/react';

describe('platform', () => {
  it('tells macOS, Windows and Linux apart', () => {
    expect(detectPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)' })).toBe('mac');
    expect(detectPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })).toBe('windows');
    expect(detectPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux)' })).toBe('linux');
  });
});

describe('menus and tab menu', () => {
  beforeEach(() => resetStores());

  async function boot(search = ''): Promise<MockEngine> {
    window.history.replaceState({}, '', `/${search}`);
    const engine = new MockEngine({ scenario: 'demo' });
    render(<App engine={engine} />);
    await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
    act(() => useUi.getState().openDialog(null));
    return engine;
  }

  it('Windows/Linux get an in-window menu bar whose items open the dialogs', async () => {
    await boot('?platform=windows');
    const bar = await screen.findByRole('menubar', { name: 'Application menu' });
    expect(bar.className).toContain('windows');
    await userEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /^Settings/ }));
    expect(useUi.getState().dialog).toBe('settings');
    // Connection Settings is about the foreground tab
    await userEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Connection Settings/ }));
    expect(useUi.getState().dialog).toBe('session');
    expect(useUi.getState().sessionDialog).toBe(useSessions.getState().fg);
  });

  it('Help > About SquatClient opens the About dialog', async () => {
    await boot('?platform=windows');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Help' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /About SquatClient/ }));
    expect(useUi.getState().dialog).toBe('about');
    expect(await screen.findByRole('dialog', { name: 'About SquatClient' })).toBeInTheDocument();
  });

  it('the Escape key closes an open menu', async () => {
    await boot('?platform=linux');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'View' }));
    expect(screen.getByRole('menu', { name: 'View' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'View' })).toBeNull();
  });

  it('macOS has no in-window menu bar (the native one is used)', async () => {
    await boot('?platform=mac');
    expect(screen.queryByRole('menubar')).toBeNull();
  });

  it('right-clicking a tab offers its settings; a quick connect can be saved as a world', async () => {
    const e = await boot('?platform=mac');
    const sid = await e.connect({ host: 'quick.example.net', port: 4242, tls: false }).then((s) => s.id);
    const tab = await screen.findByRole('tab', { name: /quick\.example\.net:4242/ });
    await userEvent.pointer({ keys: '[MouseRight]', target: tab });
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Save as world...' }));
    expect(useUi.getState().sessionDialog).toBe(sid);
    await userEvent.click(await screen.findByRole('button', { name: 'Save as world' }));
    await waitFor(() =>
      expect(useUi.getState().worlds.some((w) => w.host === 'quick.example.net')).toBe(true),
    );
    await waitFor(() => expect(useSessions.getState().sessions[sid].worldId).toBeTruthy());
  });
});
