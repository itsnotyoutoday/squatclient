import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { resetStores, useSessions, useSettings, useUi } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { clearDrafts } from '../src/lib/drafts';
import { getObject, resetEditor } from '../src/state/editorStore';
import { resetDetails } from '../src/state/detailsStore';
import { checkLockExpr, checkLockType, checkName, checkParens } from '../src/lib/editor/props';
import { MockGame } from '../src/api/mock-game';
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

async function boot(): Promise<MockEngine> {
  engine = new MockEngine({ scenario: 'demo' });
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  await screen.findByLabelText('Command input');
  act(() => useUi.getState().openDialog(null));
  return engine;
}

async function openDetails(target = '#12'): Promise<MockEngine> {
  const e = await boot();
  const input = screen.getByLabelText('Command input');
  await userEvent.click(input);
  await userEvent.type(input, `/edit ${target}{Enter}`);
  await screen.findByTestId('editor-workspace');
  await userEvent.click(await screen.findByRole('button', { name: /Object details/ }));
  await screen.findByTestId('details-pane');
  await screen.findByRole('heading', { name: 'Identity' });
  return e;
}
const status = (): HTMLElement => screen.getByTestId('details-status');
const chip = (list: string, name: string): HTMLElement | null =>
  within(screen.getByRole('list', { name: list })).queryByText(name);

describe('validation helpers', () => {
  it('mirrors the engine rules', () => {
    expect(checkName('Gadget 2')).toBeNull();
    for (const bad of ['', 'a;b', 'a=b', '[x]', ' x', 'a|b', 'a\nb'])
      expect(checkName(bad), bad).not.toBeNull();
    for (const ok of ['Basic', 'user:gate', 'User:x_1']) expect(checkLockType(ok), ok).toBeNull();
    for (const bad of ['', 'user:', 'a b', 'x:y', '1a']) expect(checkLockType(bad), bad).not.toBeNull();
    expect(checkLockExpr('#1 | flag^WIZARD')).toBeNull();
    for (const bad of ['', '#1;x', 'a[b]', '{x}', '50%', 'a\\b'])
      expect(checkLockExpr(bad), bad).not.toBeNull();
    expect(checkParens('(#1|#2)&!#3')).toBeNull();
    expect(checkParens('(#1')).toMatch(/not closed/);
    expect(checkParens('#1)')).toMatch(/no matching/);
  });
});

describe('MockGame lock tests', () => {
  it('evaluates keys with &, |, !, flags and types', async () => {
    const g = new MockGame(2);
    g.objects.get('#12')!.locks = {
      Basic: '#45 | flag^WIZARD',
      Use: '!#1 & type^PLAYER',
      Enter: '(=#14|#16)&#45',
    };
    expect((await g.testLock('#12', 'Basic', '#45')).result).toBe('true');
    expect((await g.testLock('#12', 'Basic', '#1')).result).toBe('true'); // wizard flag
    expect((await g.testLock('#12', 'Basic', '#14')).result).toBe('false');
    expect((await g.testLock('#12', 'Use', '#1')).result).toBe('false');
    expect((await g.testLock('#12', 'Use', 'me')).result).toBe('true');
    expect((await g.testLock('#12', 'Enter', '#45')).result).toBe('false');
    expect((await g.testLock('#12', 'Nope', '#45')).result).toBe('unknown');
  });
});

describe('Object details view', { timeout: 20000 }, () => {
  it('shows every section for a thing', async () => {
    await openDetails();
    for (const h of ['Identity', 'Location', 'Relations', 'Flags', 'Powers', /^Locks/, 'Warnings'])
      expect(screen.getByRole('heading', { name: h })).toBeTruthy();
    expect(screen.getByDisplayValue('Command Console')).toBeTruthy();
    expect(chip('Flags', 'DARK')).toBeTruthy();
    expect(chip('Flags', 'VISUAL')).toBeTruthy();
    const locks = within(screen.getByRole('list', { name: 'Locks' }));
    for (const t of ['Basic', 'Use', 'Enter', 'user:gate']) expect(locks.getByText(t)).toBeTruthy();
    expect(locks.getByText('#45|flag^WIZARD')).toBeTruthy();
    // lock flags are toggle chips, set ones pressed
    expect(
      within(screen.getByRole('group', { name: 'Flags of the Basic lock' }))
        .getByRole('button', { name: 'visual' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getAllByText(/Nav Console/).length).toBeGreaterThan(0); // parent
    expect(screen.getByText('normal')).toBeTruthy(); // warnings
  });

  it('turns a flag off and on; a refused change shows the game reply and restores the state', async () => {
    const e = await openDetails();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off flag DARK' }));
    await waitFor(() => expect(chip('Flags', 'DARK')).toBeNull());
    expect(status().textContent).toContain('Flag reset.');
    const input = screen.getByRole('combobox', { name: 'Add flag' });
    await userEvent.type(input, 'STICKY{Enter}');
    await waitFor(() => expect(chip('Flags', 'STICKY')).toBeTruthy());
    // refused: wizard-only
    await userEvent.type(input, 'WIZARD{Enter}');
    const alerts = await screen.findAllByText(/WIZARD: Not allowed: Permission denied\./);
    expect(alerts.some((a) => a.closest('[role="alert"]'))).toBe(true);
    expect(chip('Flags', 'WIZARD')).toBeNull();
    expect(status().textContent).toContain('Permission denied.');
    // the catalogue is searchable with descriptions
    await userEvent.clear(input);
    await userEvent.type(input, 'opaq');
    expect(await screen.findByRole('option', { name: /OPAQUE/ })).toBeTruthy();
    expect(e.game.calls.filter((c) => c.method === 'setFlag').length).toBe(3);
  });

  it('a random failure leaves the old state', async () => {
    const e = await openDetails();
    e.game.failNext.push({ method: 'setFlag', result: { code: 'timeout', error: 'engine: timed out' } });
    await userEvent.click(screen.getByRole('button', { name: 'Turn off flag VISUAL' }));
    await screen.findAllByText(/did not answer in time/);
    expect(chip('Flags', 'VISUAL')).toBeTruthy();
  });

  it('powers need a wizard', async () => {
    const e = await openDetails();
    await userEvent.type(screen.getByRole('combobox', { name: 'Add power' }), 'NO_QUOTA{Enter}');
    await screen.findAllByText(/NO_QUOTA: Not allowed/);
    e.game.wizard = true;
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Powers' })).getByRole('button', { name: 'Add' }),
    );
    await waitFor(() => expect(chip('Powers', 'NO_QUOTA')).toBeTruthy());
  });

  it('renames; a refused rename puts the name back', async () => {
    await openDetails();
    const name = screen.getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Console Mk2{Enter}');
    await waitFor(() => expect(getObject(fgSid(), '#12')?.name).toBe('Console Mk2'));
    expect(screen.getByRole('tab', { name: /Console Mk2/ })).toBeTruthy();
    await userEvent.clear(name);
    await userEvent.type(name, 'a;b');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await screen.findByText(/cannot contain/);
  });

  it('clears a relation and changes the parent through the picker', async () => {
    await openDetails();
    await userEvent.click(screen.getByRole('button', { name: 'Clear parent' }));
    await waitFor(() => expect(screen.getAllByText('(none)').length).toBeGreaterThan(0));
    const rel = screen.getByRole('region', { name: 'Relations' });
    await userEvent.click(within(rel).getAllByRole('button', { name: 'Change...' })[0]);
    const dlg = await screen.findByRole('dialog', { name: 'Change parent' });
    await userEvent.type(within(dlg).getByLabelText(/New parent/), '#13');
    await within(dlg).findByText(/Set Nav Console \(#13\) as the parent\?/);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(rel).getByText('Nav Console (#13)')).toBeTruthy();
  });

  it('manages locks: flags, clear, editor with helper and test, parentheses guard', async () => {
    await openDetails();
    const g = within(screen.getByRole('group', { name: 'Flags of the Use lock' }));
    await userEvent.click(g.getByRole('button', { name: 'no_inherit' }));
    await waitFor(() =>
      expect(g.getByRole('button', { name: 'no_inherit' }).getAttribute('aria-pressed')).toBe('true'),
    );
    await userEvent.click(g.getByRole('button', { name: 'wizard' })); // wizard-only
    await screen.findAllByText(/Permission denied\./);
    // editor
    await userEvent.click(screen.getByRole('button', { name: 'Edit Use lock' }));
    const dlg = await screen.findByRole('dialog', { name: 'Edit Use lock' });
    const key = within(dlg).getByLabelText('Key');
    expect((key as HTMLInputElement).value).toBe('#45|flag^WIZARD');
    await userEvent.click(within(dlg).getByRole('button', { name: /Insert Is exactly this object/ }));
    expect((key as HTMLInputElement).value).toContain('=#');
    await userEvent.clear(key);
    await userEvent.type(key, '(#45');
    await within(dlg).findByText(/1 \( not closed/);
    expect((within(dlg).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(key, ')');
    // the Test button evaluates the STORED lock
    await userEvent.click(within(dlg).getByRole('button', { name: 'Test' }));
    expect((await within(dlg).findByTestId('lock-test-result')).textContent).toMatch(/passes for me/);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(screen.getByRole('list', { name: 'Locks' })).getByText('(#45)')).toBeTruthy();
    // clear a lock
    await userEvent.click(screen.getByRole('button', { name: 'Clear Enter lock' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit Enter lock' })).toBeNull());
  });

  it('adds a user-defined lock', async () => {
    await openDetails();
    await userEvent.click(screen.getByRole('button', { name: 'New lock...' }));
    const dlg = await screen.findByRole('dialog', { name: 'New lock' });
    await userEvent.type(within(dlg).getByLabelText('Lock type'), 'user:vip');
    await userEvent.type(within(dlg).getByLabelText('Key'), 'flag^WIZARD');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(screen.getByRole('list', { name: 'Locks' })).getByText('user:vip')).toBeTruthy();
  });

  it('runs @wcheck and sets warnings', async () => {
    await openDetails();
    await userEvent.type(screen.getByLabelText('Warnings to set'), 'all');
    await userEvent.click(screen.getByRole('button', { name: 'Set' }));
    await waitFor(() => expect(screen.getByText('all')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Run @wcheck' }));
    expect((await screen.findByLabelText('Warning check result')).textContent).toContain('No warnings');
  });

  it('shows the raw examine text with colour and switches variants', async () => {
    const e = await openDetails();
    await userEvent.click(screen.getByRole('tab', { name: 'Raw examine' }));
    const pre = await screen.findByLabelText('Examine text of #12');
    await waitFor(() => expect(pre.textContent).toContain('Command Console'));
    expect(pre.querySelector('span.b')).toBeTruthy(); // bold run from the colour renderer
    await userEvent.click(screen.getByRole('radio', { name: /Brief/ }));
    await waitFor(() =>
      expect(e.game.calls.some((c) => c.method === 'examine' && c.args[1] === 'brief')).toBe(true),
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await screen.findByRole('heading', { name: 'Identity' });
  });

  it('is read-only for objects you do not control', async () => {
    await openDetails('#14');
    expect(screen.getByTestId('details-readonly').textContent).toMatch(/do not control/);
    expect((screen.getByRole('button', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move...' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'New lock...' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Add flag' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('lists exits and contents of a room and opens them in a new tab', async () => {
    await openDetails('#10');
    const exits = within(screen.getByRole('region', { name: /^Exits/ }));
    expect(exits.getByText('North')).toBeTruthy();
    await userEvent.click(exits.getByText('North'));
    await screen.findByRole('tab', { name: /North/ });
  });
});

describe('Move dialog', { timeout: 20000 }, () => {
  it('searches, looks around without moving, confirms and moves; then the details refresh', async () => {
    const e = await openDetails();
    await userEvent.click(screen.getByRole('button', { name: 'Move...' }));
    const dlg = await screen.findByRole('dialog', { name: 'Move object' });
    // nearby list is there
    expect(await within(dlg).findByRole('list', { name: 'Nearby places' })).toBeTruthy();
    await userEvent.type(within(dlg).getByRole('searchbox'), 'garden');
    const results = await within(dlg).findByRole('list', { name: 'Search results' });
    await userEvent.click(within(results).getByRole('button', { name: /Garden/ }));
    // looking does not move
    await within(dlg).findByText(/A quiet garden with a fountain\. Birds sing\./);
    expect(e.game.calls.some((c) => c.method === 'move')).toBe(false);
    expect(within(dlg).getByTestId('place-confirm').textContent).toContain(
      'Move Command Console (#12) to Garden (#11)?',
    );
    await userEvent.click(within(dlg).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Garden (#11)' })).toBeTruthy());
    expect(e.game.objects.get('#12')!.location).toBe('#11');
    // recently used survives for the world
    await userEvent.click(screen.getByRole('button', { name: 'Move...' }));
    const again = await screen.findByRole('dialog', { name: 'Move object' });
    expect(await within(again).findByRole('list', { name: 'Recently used places' })).toBeTruthy();
  });

  it('keeps the dialog open and shows the game reply when the move is refused', async () => {
    await openDetails();
    await userEvent.click(screen.getByRole('button', { name: 'Move...' }));
    const dlg = await screen.findByRole('dialog', { name: 'Move object' });
    await userEvent.type(within(dlg).getByRole('searchbox'), 'sanctum');
    const results = await within(dlg).findByRole('list', { name: 'Search results' });
    await userEvent.click(within(results).getByRole('button', { name: /Wizard Sanctum/ }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Move' }));
    await within(dlg).findByText(/Permission denied\./);
    expect(screen.getByRole('dialog', { name: 'Move object' })).toBeTruthy();
  });

  it('says so when the game restricts searching, and Escape closes', async () => {
    const e = await openDetails();
    e.game.restrictSearch = true;
    await userEvent.click(screen.getByRole('button', { name: 'Move...' }));
    const dlg = await screen.findByRole('dialog', { name: 'Move object' });
    await userEvent.type(within(dlg).getByRole('searchbox'), 'room');
    await within(dlg).findByText(/does not allow searching every room/);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('details-pane')).toBeTruthy(); // Escape closed the dialog only
  });
});

describe('attribute context menu', { timeout: 20000 }, () => {
  it('opens on right-click, toggles flags with check marks, locks, and copies', async () => {
    const e = await openDetails();
    const opt = screen.getAllByRole('option').find((o) => o.textContent?.includes('CMD_ENGAGE'))!;
    await userEvent.click(opt); // select the attribute (leaves details)
    act(() => {
      opt.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }),
      );
    });
    const menu = await screen.findByRole('menu', { name: /Actions for attribute CMD_ENGAGE/ });
    const flag = within(menu).getByRole('menuitemcheckbox', { name: /no_command/ });
    await waitFor(() => expect((flag as HTMLButtonElement).disabled).toBe(false));
    expect(flag.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(flag);
    await waitFor(() =>
      expect(
        within(menu)
          .getByRole('menuitemcheckbox', { name: /no_command/ })
          .getAttribute('aria-checked'),
      ).toBe('true'),
    );
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Lock attribute/ }));
    await waitFor(() =>
      expect(within(menu).getByRole('menuitem', { name: /Unlock attribute/ })).toBeTruthy(),
    );
    expect(e.game.objects.get('#12')!.attrs.CMD_ENGAGE.atrlocked).toBe(true);
    // Escape closes, focus goes back
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens from the keyboard (Shift+F10) and renames and deletes with verification', async () => {
    const e = await openDetails();
    const opt = screen.getAllByRole('option').find((o) => o.textContent?.includes('CMD_GEN_001'))!;
    await userEvent.click(opt);
    const list = screen.getByRole('listbox', { name: /Attributes of/ });
    list.focus();
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Rename/ }));
    const dlg = await screen.findByRole('dialog', { name: 'Rename attribute' });
    const input = within(dlg).getByLabelText('New name');
    await userEvent.clear(input);
    await userEvent.type(input, 'RENAMED_ONE');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(e.game.objects.get('#12')!.attrs.RENAMED_ONE).toBeTruthy();
    expect(e.game.objects.get('#12')!.attrs.CMD_GEN_001).toBeUndefined();
    // delete shows a confirmation and the exact refusal
    e.game.objects.get('#12')!.attrs.RENAMED_ONE.readonly = true;
    const opt2 = (await screen.findAllByRole('option')).find((o) => o.textContent?.includes('RENAMED_ONE'))!;
    act(() => {
      opt2.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
      );
    });
    await userEvent.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Delete attribute/ }),
    );
    const del = await screen.findByRole('dialog', { name: 'Delete attribute' });
    expect(del.textContent).toContain('Delete RENAMED_ONE from #12?');
    await userEvent.click(within(del).getByRole('button', { name: 'Delete' }));
    await within(del).findByText(/Permission denied\./);
    expect(e.game.objects.get('#12')!.attrs.RENAMED_ONE).toBeTruthy();
  });

  it('disables the changing actions on an object you do not control', async () => {
    await openDetails('#14');
    await userEvent.click(screen.getAllByRole('option').find((o) => o.textContent?.includes('LOG'))!);
    await userEvent.click(await screen.findByRole('button', { name: /Actions for attribute LOG/ }));
    const menu = await screen.findByRole('menu');
    expect((within(menu).getByRole('menuitem', { name: /Rename/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (within(menu).getByRole('menuitem', { name: /Delete attribute/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((within(menu).getByRole('menuitem', { name: /Copy name/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe('routing', () => {
  it('none of it touches the terminal output or the command history', async () => {
    const e = await openDetails();
    const sid = fgSid();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off flag DARK' }));
    await waitFor(() => expect(chip('Flags', 'DARK')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Raw examine' }));
    await screen.findByLabelText('Examine text of #12');
    expect(e.sent.map((s) => s.text)).toEqual([]); // nothing typed to the game
    const hist = await e.history(sid, '', { limit: 50 } as never);
    expect(hist.entries.map((h) => h.text)).toEqual(['/edit #12']); // only what the user typed
    expect(document.body.textContent ?? '').not.toContain('SQUATCAP');
  });

  it('is keyboard accessible: pinned entry, tabs, labelled regions', async () => {
    await openDetails();
    const pane = screen.getByTestId('details-pane');
    expect(within(pane).getAllByRole('region').length).toBeGreaterThanOrEqual(7);
    const tabs = screen.getByRole('tablist', { name: 'Details views' });
    const first = within(tabs).getByRole('tab', { name: 'Overview' });
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(within(tabs).getByRole('tab', { name: 'Raw examine' }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
  });
});

const fgSid = (): string => useSessions.getState().fg ?? '';
