import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_GROUP, WorldManager, groupWorlds } from '../src/components/dialogs/WorldManager';
import { SettingsDialog } from '../src/components/dialogs/SettingsDialog';
import { MockEngine } from '../src/api/mock';
import { DEFAULT_SETTINGS } from '../src/api/types';
import type { WorldConfig } from '../src/api/types';
import { useSettings, useUi } from '../src/state/stores';

const w = (id: string, name: string, group?: string): WorldConfig => ({
  id,
  name,
  group,
  host: `${id}.example`,
  port: 4201,
  tls: false,
  tlsVerify: 'strict',
  encoding: 'utf-8',
  via: 'direct',
  login: { template: 'connect {name} {password}', hasPassword: false },
});

describe('world groups', () => {
  it('a world with no group is in the default group, which is listed first', () => {
    const g = groupWorlds([w('a', 'Zed'), w('b', 'Alpha', 'Aardvark')], '');
    expect(g.map(([n]) => n)).toEqual([DEFAULT_GROUP, 'Aardvark']);
    expect(g[0][1].map((x) => x.name)).toEqual(['Zed']);
  });

  it('dragging a world onto another group moves it there', async () => {
    const engine = new MockEngine();
    const saved: WorldConfig[] = [];
    engine.saveWorld = async (x: WorldConfig) => (saved.push(x), x);
    engine.listWorlds = async () => [w('a', 'Zed'), w('b', 'Alpha', 'Aardvark')];
    useUi.setState({ engine, worlds: [w('a', 'Zed'), w('b', 'Alpha', 'Aardvark')] });
    render(<WorldManager />);
    const data: Record<string, string> = { 'text/x-squat-world': 'a' };
    const dt = {
      types: ['text/x-squat-world'],
      getData: (k: string) => data[k] ?? '',
      setData: () => undefined,
    };
    fireEvent.drop(screen.getByRole('region', { name: 'Aardvark' }), { dataTransfer: dt });
    await waitFor(() => expect(saved[0]).toMatchObject({ id: 'a', group: 'Aardvark' }));
    expect(within(screen.getByRole('region', { name: DEFAULT_GROUP })).queryByText('Alpha')).toBeNull();
  });
});

describe('Settings tabs', () => {
  it('groups the settings into tabs, one shown at a time', () => {
    useUi.setState({ engine: new MockEngine() });
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true });
    render(<SettingsDialog />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Appearance',
      'Display & input',
      'History & scripts',
      'Squatters',
      'Game consoles',
      'Sound',
    ]);
    expect(screen.getByLabelText('Theme')).toBeTruthy();
    expect(screen.queryByLabelText('Master volume')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Sound' }));
    expect(screen.getByLabelText('Master volume')).toBeTruthy();
    expect(screen.queryByLabelText('Theme')).toBeNull();
  });
});

describe('world CMCP version', () => {
  it('a world picks its one CMCP version (default, 2 or 1), never both', async () => {
    const engine = new MockEngine();
    const saved: WorldConfig[] = [];
    engine.saveWorld = async (x: WorldConfig) => (saved.push(x), x);
    engine.listWorlds = async () => [w('a', 'Old Game')];
    useUi.setState({ engine, worlds: [w('a', 'Old Game')] });
    render(<WorldManager />);
    fireEvent.click(screen.getByText('Old Game'));
    const sel = screen.getByLabelText('CMCP version') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['', '2', '1']);
    fireEvent.change(sel, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(saved[0]).toMatchObject({ id: 'a', cmcp: '1' }));
  });
});
