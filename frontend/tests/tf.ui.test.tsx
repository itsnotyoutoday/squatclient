import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { canType, currentPreset, describeControl } from '../src/lib/tfcontrol';
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
  engine = new MockEngine({ scenario: 'tf' });
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  await waitFor(() => expect(Object.keys(useSessions.getState().sessions).length).toBe(1));
  return engine;
}

describe('tfcontrol helpers', () => {
  it('knows who may type and which preset a state is', () => {
    expect(canType(undefined)).toBe(true);
    expect(canType({ tf: { world: 'a', fg: true, input: 'tf', automation: 'tf' } })).toBe(false);
    expect(canType({ tf: { world: 'a', fg: true, input: 'both', automation: 'tf' } })).toBe(true);
    expect(currentPreset({ world: 'a', fg: true, input: 'remote', automation: 'client' })).toBe('full');
    expect(currentPreset({ world: 'a', fg: true, input: 'remote', automation: 'tf' })).toBe('takeover')
    expect(currentPreset({ world: 'a', fg: true, input: 'both', automation: 'client' })).toBeUndefined();
    expect(describeControl({ world: 'a', fg: true, input: 'tf', automation: 'tf' })).toMatch(/only watches/);
  });
});

describe('TinyFugue squatter UI', () => {
  it('shows who has the keyboard and locks the input until control is taken', async () => {
    await boot();
    const id = useSessions.getState().order[0];
    expect(screen.getByTestId(`tfbadge-${id}`)).toHaveTextContent('TF');
    expect(screen.getByTestId('tf-control')).toHaveTextContent('Keyboard: TinyFugue · Triggers: TinyFugue');
    const input = screen.getByLabelText('Command input');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('placeholder', expect.stringMatching(/TinyFugue has the keyboard/));

    const sel = within(screen.getByTestId('tf-control')).getByLabelText('Control of this TinyFugue connection');
    await userEvent.selectOptions(sel, 'full');
    await waitFor(() => expect(screen.getByLabelText('Command input')).toBeEnabled());
    expect(screen.getByTestId(`tfbadge-${id}`)).toHaveTextContent('You ⚙');
    expect(screen.getByTestId('tf-control')).toHaveTextContent('Keyboard: You · Triggers: This app');

    await userEvent.selectOptions(sel, 'viewer');
    await waitFor(() => expect(screen.getByLabelText('Command input')).toBeDisabled());
  });

  it('squatters dialog: type choice swaps the default port and pairs a TinyFugue squatter', async () => {
    const e = await boot();
    act(() => useUi.getState().openDialog('squatters'));
    const dlg = await screen.findByRole('dialog', { name: 'Squatters' });
    expect(within(dlg).getByTestId('sqkind-sq-tf')).toHaveTextContent('TinyFugue · admin');
    await userEvent.selectOptions(within(dlg).getByLabelText('Type'), 'tf-squatterd');
    expect(within(dlg).getByLabelText(/^Port/)).toHaveValue(10328);
    expect(within(dlg).getByText(/In TinyFugue run/)).toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText('Host'), 'tf2.example');
    await userEvent.type(within(dlg).getByLabelText('Pair code'), 'AAAA-1111');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Pair' }));
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Trust and pair' }));
    await waitFor(async () =>
      expect((await e.listSquatters()).some((s) => s.host === 'tf2.example' && s.kind === 'tf-squatterd')).toBe(true),
    );
    // a plain squatter keeps the plain default
    await userEvent.selectOptions(within(dlg).getByLabelText('Type'), 'squatterd');
    expect(within(dlg).getByLabelText(/^Port/)).toHaveValue(10327);
  });

  it('squatters dialog: stores the automation preference', async () => {
    const e = await boot();
    act(() => useUi.getState().openDialog('squatters'));
    const dlg = await screen.findByRole('dialog', { name: 'Squatters' });
    await userEvent.selectOptions(within(dlg).getByLabelText('Automation for Home TinyFugue'), 'client');
    await waitFor(async () =>
      expect((await e.listSquatters()).find((s) => s.id === 'sq-tf')?.automation).toBe('client'),
    );
  });

  it('TinyFugue worlds: add, edit without leaking the password, connect, delete', async () => {
    const e = await boot();
    act(() => useUi.getState().openDialog('squatters'));
    const dlg = await screen.findByRole('dialog', { name: 'Squatters' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'TinyFugue worlds of Home TinyFugue' }));
    const w = await screen.findByRole('dialog', { name: /TinyFugue worlds/ });
    expect(await within(w).findByText('alpha')).toBeInTheDocument();
    expect(within(w).getByText(/password set/)).toBeInTheDocument();

    await userEvent.click(within(w).getByRole('button', { name: 'Add world' }));
    await userEvent.type(within(w).getByLabelText('Name'), 'gamma');
    await userEvent.type(within(w).getByLabelText('Host'), 'gamma.example');
    await userEvent.clear(within(w).getByLabelText(/^Port/));
    await userEvent.type(within(w).getByLabelText(/^Port/), '4000');
    await userEvent.type(within(w).getByLabelText(/^Password/), 'secret');
    await userEvent.click(within(w).getByRole('button', { name: 'Save' }));
    expect(await within(w).findByText('gamma')).toBeInTheDocument();
    const listed = await e.listTFWorlds('sq-tf');
    expect(listed.find((x) => x.name === 'gamma')).toMatchObject({ passSet: true });
    expect(JSON.stringify(listed)).not.toContain('secret');

    await userEvent.click(within(w).getByRole('button', { name: 'Delete beta' }));
    await waitFor(() => expect(within(w).queryByText('beta')).toBeNull());

    await userEvent.click(within(w).getByRole('button', { name: 'Connect gamma' }));
    await waitFor(() => expect(Object.keys(useSessions.getState().sessions).length).toBe(2));
    expect(useUi.getState().dialog).toBeNull();
  });

  it('a viewer device cannot edit worlds', async () => {
    const e = await boot();
    const tf = (await e.listSquatters()).find((q) => q.id === 'sq-tf')!;
    act(() => useUi.getState().setSquatters([{ ...tf, role: 'viewer' }]));
    act(() => useUi.getState().openTFWorlds('sq-tf'));
    const w = await screen.findByRole('dialog', { name: /TinyFugue worlds/ });
    expect(await within(w).findByText('alpha')).toBeInTheDocument();
    expect(within(w).queryByRole('button', { name: 'Add world' })).toBeNull();
    expect(within(w).queryByRole('button', { name: 'Delete alpha' })).toBeNull();
  });
});

describe('Connect via lists both kinds of squatter, named by kind', () => {
  it('a world can be routed through the TinyFugue squatter', async () => {
    await boot();
    act(() => useUi.getState().openDialog('worlds'));
    const d = await screen.findByRole('dialog', { name: 'Worlds' });
    await userEvent.click(within(d).getByText('Hogwarts MUSH'));
    const via = await within(d).findByLabelText(/Connect via/);
    const opts = within(via).getAllByRole('option').map((o) => o.textContent);
    expect(opts).toEqual(['Direct', 'Squatter: Home server', 'TinyFugue: Home TinyFugue']);
    await userEvent.selectOptions(via, 'sq-tf');
    expect((via as HTMLSelectElement).value).toBe('sq-tf');
  });
});

describe('TinyFugue tabs: marker, tooltip, rename', () => {
  it('marks a TinyFugue tab with (tf) and says in the tooltip which squatter holds it', async () => {
    await boot();
    const id = useSessions.getState().order[0];
    const tab = screen.getByRole('tab', { name: /alpha/ });
    expect(within(tab).getByLabelText('through TinyFugue')).toHaveTextContent('(tf)');
    expect(tab.getAttribute('title')).toContain('TinyFugue: Home TinyFugue (tf.example.com:10328)');
    expect(id).toBeTruthy();
  });

  it('renaming a tab renames the world in TinyFugue, here, and the tab', async () => {
    const e = await boot();
    const tab = screen.getByRole('tab', { name: /alpha/ });
    fireEvent.contextMenu(tab);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename (in TinyFugue)...' }));
    const d = await screen.findByRole('dialog', { name: 'Rename in TinyFugue' });
    const input = within(d).getByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'has space');
    expect(within(d).getByRole('button', { name: 'Rename' })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'alpha-prime');
    await userEvent.click(within(d).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /alpha-prime/ })).toBeInTheDocument());
    expect((await e.listTFWorlds('sq-tf')).map((w) => w.name).sort()).toEqual(['alpha-prime', 'beta']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a connection opened by address offers to become a world, and becomes one', async () => {
    const e = await boot();
    const si = await e.connect({ host: 'mud.example', port: 4000, tls: false, via: 'sq-tf' });
    expect(si.tf?.world).toMatch(/^\(unnamed/);
    const tab = await screen.findByRole('tab', { name: /unnamed/ });
    fireEvent.contextMenu(tab);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Save as a world in TinyFugue...' }));
    const d = await screen.findByRole('dialog', { name: 'Save as a world in TinyFugue' });
    const name = within(d).getByLabelText('Name');
    expect(name).toHaveValue('');
    expect(within(d).getByRole('button', { name: 'Save world' })).toBeDisabled();
    await userEvent.type(name, 'mud-kept');
    await userEvent.click(within(d).getByRole('button', { name: 'Save world' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /mud-kept/ })).toBeInTheDocument());
    const kept = (await e.listTFWorlds('sq-tf')).find((w) => w.name === 'mud-kept');
    expect(kept).toMatchObject({ host: 'mud.example', port: '4000' });
    expect(kept?.temp).toBeUndefined();
  });

  it('a rename made on the other side shows up here: the tab and the world list follow', async () => {
    const e = await boot();
    const sid = useSessions.getState().order[0];
    await e.renameTFWorld('sq-tf', 'alpha', 'alpha-elsewhere'); // TinyFugue's side
    await waitFor(() => expect(useSessions.getState().sessions[sid].name).toBe('alpha-elsewhere'));
    expect(screen.getByRole('tab', { name: /alpha-elsewhere/ })).toBeInTheDocument();
  });

  it('the TinyFugue worlds dialog renames a record by editing its name', async () => {
    const e = await boot();
    act(() => useUi.getState().openTFWorlds('sq-tf'));
    const d = await screen.findByRole('dialog', { name: /TinyFugue worlds/ });
    await userEvent.click(await within(d).findByRole('button', { name: 'Edit beta' }));
    const name = within(d).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'beta2');
    await userEvent.click(within(d).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await e.listTFWorlds('sq-tf')).map((w) => w.name)).toContain('beta2'));
    expect((await e.listTFWorlds('sq-tf')).map((w) => w.name)).not.toContain('beta');
  });
});

describe('TinyFugue scripts dialog', () => {
  it('uploads, loads, lists and deletes a script and shows what TinyFugue said', async () => {
    const e = await boot();
    act(() => useUi.getState().openDialog('squatters'));
    const sq = await screen.findByRole('dialog', { name: 'Squatters' });
    await userEvent.click(within(sq).getByRole('button', { name: 'TinyFugue scripts of Home TinyFugue' }));
    const d = await screen.findByRole('dialog', { name: /TinyFugue scripts/ });
    expect(within(d).getByText(/squat_scripts=safe/)).toBeInTheDocument();

    const send = within(d).getByRole('button', { name: 'Send and load' });
    expect(send).toBeDisabled(); // no name and no text yet
    await userEvent.type(within(d).getByLabelText('Script name'), 'bad name');
    expect(within(d).getByText(/ending in .tf/)).toBeInTheDocument();
    await userEvent.clear(within(d).getByLabelText('Script name'));
    await userEvent.type(within(d).getByLabelText('Script name'), 'mine.tf');
    await userEvent.click(within(d).getByLabelText('Script text'));
    await userEvent.paste('/def -t"*hi*" mine = /echo hi');
    await userEvent.click(within(d).getByRole('button', { name: 'Send and load' }));
    expect(await within(d).findByText('Loaded.')).toBeInTheDocument();
    expect((await e.listTFScripts('sq-tf')).map((x) => x.name)).toEqual(['mine.tf']);
    expect(await within(d).findByText('mine.tf')).toBeInTheDocument();

    await userEvent.click(within(d).getByRole('button', { name: 'Delete mine.tf' }));
    await waitFor(async () => expect(await e.listTFScripts('sq-tf')).toEqual([]));
  });

  it('shows why when TinyFugue refuses, and offers the button only to admin devices', async () => {
    const e = await boot();
    e.tfScriptsMode = 'off';
    act(() => useUi.getState().openTFScripts('sq-tf'));
    const d = await screen.findByRole('dialog', { name: /TinyFugue scripts/ });
    await userEvent.type(within(d).getByLabelText('Script name'), 'x.tf');
    await userEvent.click(within(d).getByLabelText('Script text'));
    await userEvent.paste('/echo x');
    await userEvent.click(within(d).getByRole('button', { name: 'Send and load' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent(/script upload is off/);

    act(() => useUi.getState().openDialog('squatters'));
    const sq = await screen.findByRole('dialog', { name: 'Squatters' });
    const tf = (await e.listSquatters()).find((q) => q.id === 'sq-tf')!;
    act(() => useUi.getState().setSquatters([{ ...tf, role: 'operator' }]));
    await waitFor(() =>
      expect(within(sq).queryByRole('button', { name: 'TinyFugue scripts of Home TinyFugue' })).toBeNull(),
    );
  });
});

describe('mock TinyFugue API', () => {
  it('refuses commands for non-admins and bad control values', async () => {
    const e = new MockEngine({ scenario: 'tf' });
    const sid = (await e.listSessions())[0].id;
    await expect(e.setControl(sid, 'input', 'nonsense')).rejects.toThrow();
    await expect(e.sendGmcp(sid, '', '{}')).rejects.toThrow();
    expect((await e.tfExec('sq-tf', '/version')).ok).toBe(true);
    e.dispose();
  });
});
