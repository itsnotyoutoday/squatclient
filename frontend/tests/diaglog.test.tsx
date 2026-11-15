import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockEngine } from '../src/api/mock';
import { DiagLogDialog } from '../src/components/dialogs/DiagLogDialog';
import {
  ISSUE_URL_MAX,
  buildIssueUrl,
  canAdvance,
  diagLog,
  initialWizard,
  installDiagHooks,
  issueFields,
  logPageSnapshot,
  privateDeliveryText,
  registerDiagProvider,
  scrub,
  setDiagEngine,
  wizardBack,
  wizardNext,
  wizardSetIncluded,
} from '../src/lib/diaglog';
import type { WizardState } from '../src/lib/diaglog';
import { resetStores, useUi } from '../src/state/stores';

const info = { repoSlug: 'owner/repo', build: 'abc123-dirty 2026-11-15T10:00:00Z', os: 'darwin', arch: 'arm64', mode: 'always', errors: [] as string[], note: '' };

describe('wizard step logic', () => {
  it('goes 1 to 4, step 2 needs the saved zip, and back works', () => {
    let w = initialWizard();
    expect(w.step).toBe('included');
    expect(canAdvance(w)).toBe(true);
    w = wizardNext(w);
    expect(w.step).toBe('save');
    expect(canAdvance(w)).toBe(false);
    expect(wizardNext(w).step).toBe('save'); // no zip: stays
    w = { ...w, zip: { path: '/d/x.zip', size: 10 } };
    w = wizardNext(w);
    expect(w.step).toBe('tell');
    w = wizardNext(w);
    expect(w.step).toBe('done');
    expect(canAdvance(w)).toBe(false);
    expect(wizardBack(w).step).toBe('tell');
    expect(wizardBack(initialWizard()).step).toBe('included');
  });
  it('changing what is included forgets a zip built earlier', () => {
    let w: WizardState = { ...initialWizard(), zip: { path: '/d/x.zip', size: 1 } };
    w = wizardSetIncluded(w, { note: '' });
    expect(w.zip).not.toBeNull(); // nothing changed
    w = wizardSetIncluded(w, { currentOnly: true });
    expect(w.zip).toBeNull();
  });
});

describe('issue form URL', () => {
  it('is the template URL with every value encoded', () => {
    const u = buildIssueUrl({ ...info, errors: ['2026-11-15 12:00:00.000 [error] failed & broke = "x"'], note: 'it crashed: 100% & more' });
    expect(u.startsWith('https://github.com/owner/repo/issues/new?template=diagnostics.yml&')).toBe(true);
    const q = new URL(u).searchParams;
    expect(q.get('build')).toBe(info.build);
    expect(q.get('os')).toBe('darwin arm64');
    expect(q.get('mode')).toBe('always');
    expect(q.get('what')).toBe('it crashed: 100% & more');
    expect(q.get('summary')).toContain('failed & broke = "x"');
    expect(q.get('title')).toContain('[alpha]');
    expect(u).not.toMatch(/[ "<>]/); // nothing raw
  });
  it('is capped however long the errors and the note are', () => {
    const errors = Array.from({ length: 5 }, (_, i) => `2026-11-15 12:00:0${i}.000 [error] ${'long error text ü€ '.repeat(80)} ${i}`);
    const u = buildIssueUrl({ ...info, errors, note: 'n'.repeat(5000) });
    expect(u.length).toBeLessThanOrEqual(ISSUE_URL_MAX);
    const q = new URL(u).searchParams;
    expect(q.get('build')).toBe(info.build); // the short fields survive
    expect(q.get('os')).toBe('darwin arm64');
  });
  it('never carries a secret, even from a note or an error line that still has one', () => {
    const u = buildIssueUrl({
      ...info,
      errors: ['x [error] dbg s2: -> connect alice ember-tide-91', 'y [error] pair_code=ABCD-EFGH token=abcdef12345 Authorization: Bearer zzz999'],
      note: 'my password is hunter22 and /pair K7Q9-ZZ41',
    });
    const text = decodeURIComponent(u);
    for (const secret of ['ember-tide-91', 'ABCD-EFGH', 'abcdef12345', 'zzz999', 'hunter22', 'K7Q9-ZZ41']) expect(text).not.toContain(secret);
    expect(text).toContain('[redacted]');
  });
  it('puts the last error into the title and none of the log in the address', () => {
    const f = issueFields({ ...info, errors: ['t [error] first', 't [error] the last one'] });
    expect(f.title).toBe('[alpha] the last one');
    expect(buildIssueUrl({ ...info, errors: [], note: '' })).not.toContain('summary=');
  });
  it('scrub keeps ordinary text and hashes', () => {
    expect(scrub('mute: session s2 is now audible')).toBe('mute: session s2 is now audible');
    const h = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    expect(scrub(`pack sha256 ${h}`)).toContain(h);
  });
  it('the private delivery sentence names the contact from the build constants', () => {
    expect(privateDeliveryText({ contactName: 'Nveid', contactHost: 'startrekkin.net', contactPort: 1701 })).toBe(
      "If you don't want to attach the file to a public issue, submit the issue without it and say so, or contact Nveid at startrekkin.net port 1701 to arrange another private way to deliver it.",
    );
  });
});

describe('page logger', () => {
  let eng: MockEngine;
  beforeEach(() => {
    eng = new MockEngine();
    setDiagEngine(eng, true);
  });
  afterEach(() => setDiagEngine(null, false));
  it('forwards lines only while logging is on', async () => {
    diagLog('ui', 'one', 's1');
    setDiagEngine(eng, false);
    diagLog('ui', 'two', 's1');
    await Promise.resolve();
    expect(eng.diagState.lines).toEqual(['[ui] s1 one']);
  });
  it('snapshot providers are written, errors are forwarded with their stack', async () => {
    const off = registerDiagProvider('tabs', () => ['fg=s1']);
    logPageSnapshot('test');
    const un = installDiagHooks();
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: 'a.js', lineno: 3, colno: 4, error: new Error('boom') }));
    console.error('uh oh', new Error('inner'));
    un();
    off();
    await Promise.resolve();
    const all = eng.diagState.lines.join('\n');
    expect(all).toContain('[snapshot]  tabs: fg=s1');
    expect(all).toContain('window.onerror: boom at a.js:3:4');
    expect(all).toContain('console.error: uh oh');
  });
});

describe('DiagLogDialog', () => {
  let eng: MockEngine;
  beforeEach(() => {
    resetStores();
    eng = new MockEngine();
    useUi.getState().setEngine(eng);
  });

  const open = async () => {
    const user = userEvent.setup();
    render(<DiagLogDialog />);
    await screen.findByText(/Logging is ON/);
    return user;
  };

  it('shows the state and the sizes of both sessions', async () => {
    await open();
    expect(screen.getByText('This session')).toBeTruthy();
    expect(screen.getByText('Previous session')).toBeTruthy();
    expect(screen.getByText(/2 secrets were removed/)).toBeTruthy();
  });

  it('turns logging off and on', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Turn diagnostics off' }));
    await screen.findByText(/Logging is OFF/);
    expect(eng.diagState.enabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Turn diagnostics on' }));
    await screen.findByText(/Logging is ON/);
    expect(eng.diagState.enabled).toBe(true);
  });

  it('clears the logs only after the confirmation', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Clear logs...' }));
    expect(eng.diagState.cleared).toBe(0);
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(eng.diagState.cleared).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Clear logs...' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete them' }));
    await waitFor(() => expect(eng.diagState.cleared).toBe(1));
  });

  it('views and searches the log', async () => {
    eng.diagState.lines = ['[net] connect ok', '[sound] ev=e1 played'];
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'View log' }));
    const box = (await screen.findByLabelText(/Diagnostics log, newest lines last/)) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toContain('ev=e1 played'));
    await user.type(screen.getByLabelText('Search the log'), 'CONNECT');
    await waitFor(() => expect(box.value).toBe('[net] connect ok'));
  });

  it('walks through the four steps: save the zip, open the issue form, delete the zip', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Send...' }));
    // step 1
    expect(screen.getByText(/can contain text the game sent you/)).toBeTruthy();
    await user.type(screen.getByLabelText('Add a note'), 'it went wrong, my password is hunter22');
    await user.click(screen.getByLabelText(/Current session only/));
    const next = screen.getByRole('button', { name: 'Next' });
    await user.click(next);
    // step 2: Next is disabled until the zip is saved
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save to Downloads' }));
    await screen.findByText(/squatclient-diagnostics-mock-build-2026-11-15\.zip/);
    expect(eng.diagState.zips).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    // step 3: the public warning, the private-delivery sentence, the numbered instructions
    expect(screen.getByText(/A GitHub issue on this project is public/)).toBeTruthy();
    expect(screen.getByText(/contact Someone at mud\.example\.org port 1701/)).toBeTruthy();
    expect(screen.getByText(/Drag the zip you just saved/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open GitHub issue form' }));
    await waitFor(() => expect(eng.diagState.opened).toHaveLength(1));
    const url = eng.diagState.opened[0];
    expect(url).toContain('https://github.com/owner/repo/issues/new?template=diagnostics.yml');
    expect(decodeURIComponent(url)).not.toContain('hunter22'); // the note is scrubbed before it reaches the address
    // the quick-connect link prefills and does not connect
    await user.click(screen.getByRole('button', { name: /Connect to mud\.example\.org 1701/ }));
    expect(useUi.getState().quickPrefill).toEqual({ host: 'mud.example.org', port: 1701 });
    expect(useUi.getState().dialog).toBe('quick');
  });

  it('step 4 deletes the saved zip', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Send...' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Save to Downloads' }));
    await screen.findByText(/Saved:/);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await act(async () => undefined);
    await user.click(screen.getByRole('button', { name: 'Done: delete the saved zip' }));
    await waitFor(() => expect(eng.diagState.zips).toHaveLength(0));
    await user.click(screen.getByRole('button', { name: 'Open the issue list' }));
    await waitFor(() => expect(eng.diagState.opened.at(-1)).toBe('https://github.com/owner/repo/issues'));
  });

  it('has no email address anywhere in the dialog', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Send...' }));
    expect(document.body.textContent ?? '').not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(screen.queryByText(/mailto|by email/i)).toBeNull();
  });
});
