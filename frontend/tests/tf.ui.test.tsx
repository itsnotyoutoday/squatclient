import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
