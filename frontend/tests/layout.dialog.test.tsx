import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { resetLayoutData } from '../src/layout/store';
import { resetStores, useSessions, useSettings, useUi } from '../src/state/stores';
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

async function boot(): Promise<void> {
  engine = new MockEngine({ scenario: 'demo' });
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  await waitFor(() => expect(useSessions.getState().fg).toBeTruthy());
  act(() => useUi.getState().openDialog('layouts'));
}

describe('the Layouts dialog', () => {
  it('lists the built-in layouts and makes one the default', async () => {
    await boot();
    expect(await screen.findByRole('radio', { name: /Classic/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Sidebar/ }));
    await waitFor(() => expect(useSettings.getState().settings.layout).toBe('sidebar'));
    await userEvent.click(screen.getByRole('radio', { name: /Classic/ }));
    await waitFor(() => expect(useSettings.getState().settings.layout).toBe(''));
  });

  it('makes a layout from a starter, saves it, lists it, edits it and deletes it', async () => {
    await boot();
    await userEvent.click(await screen.findByRole('button', { name: 'Classic' })); // the starter button
    const id = screen.getByLabelText('Layout id');
    expect(id).toHaveValue('my-classic');
    const src = screen.getByLabelText('Layout source');
    expect((src as HTMLTextAreaElement).value).toContain('<Mush />');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('radio', { name: /my-classic/ })).toBeInTheDocument();
    // choose it, then edit
    await userEvent.click(screen.getByRole('radio', { name: /my-classic/ }));
    await waitFor(() => expect(useSettings.getState().settings.layout).toBe('my-classic'));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByLabelText('Layout source') as HTMLTextAreaElement).value).toContain('<InputBar />');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // deleting the layout in use falls back to the default
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('radio', { name: /my-classic/ })).toBeNull());
    expect(useSettings.getState().settings.layout).toBe('');
  });

  it('opens from the View menu action', async () => {
    engine = new MockEngine({ scenario: 'demo' });
    render(<App engine={engine} />);
    await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
    act(() =>
      (engine as unknown as { emit: (n: string, p: unknown) => void }).emit('menu', { action: 'layouts' }),
    );
    expect(await screen.findByRole('dialog', { name: 'Layouts' })).toBeInTheDocument();
  });
});
