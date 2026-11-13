import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { resetStores, useSessions, useSettings, useUi } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { clearDrafts } from '../src/lib/drafts';
import { openUpload, useUpload } from '../src/lib/upload/store';
import { stubLayout } from './helpers';

let restore: () => void;
let engine: MockEngine;
beforeEach(() => {
  restore = stubLayout();
  resetStores();
  clearHistories();
  clearDrafts();
  window.localStorage.clear();
  useUpload.getState().close();
});
afterEach(() => {
  cleanup();
  engine?.dispose();
  restore();
  useUpload.getState().close();
});

const SCRIPT = '@@ greeter\n&GREET me=Hello,\n  [name(%#)]!\n\nthink one\nthink two\n';

async function boot(files: Record<string, string> = { '~/a.mush': SCRIPT }): Promise<MockEngine> {
  engine = new MockEngine({ scenario: 'demo' });
  for (const [p, t] of Object.entries(files)) engine.setFile(p, t);
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  await screen.findByLabelText('Command input');
  act(() => useUi.getState().openDialog(null));
  return engine;
}
const sent = (e: MockEngine): string[] => e.sent.map((s) => s.text);
const fg = (): string => useSessions.getState().fg ?? '';
const dialog = (name = /Upload/): Promise<HTMLElement> => screen.findByRole('dialog', { name });
const setFast = (ms: number): void =>
  useSettings.setState({ settings: { ...useSettings.getState().settings, sendLineDelayMs: ms } });

async function typeCommand(text: string): Promise<void> {
  const box = screen.getByLabelText('Command input');
  await userEvent.type(box, `${text}{Enter}`);
}

describe('/upload command', () => {
  it('bare /upload opens the picker, then the dialog; nothing is sent and the command is not sent to the game', async () => {
    const e = await boot();
    const pick = vi.spyOn(e, 'pickFile');
    e.nextPick = '~/a.mush';
    await typeCommand('/upload');
    const d = await dialog(/Upload a\.mush/);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(d).toHaveTextContent('a.mush');
    expect(d).toHaveTextContent('6 lines');
    expect(sent(e)).toEqual([]);
    expect(screen.getByLabelText('Target session')).toHaveTextContent(
      useSessions.getState().sessions[fg()].name,
    );
    // only the dialog's own Send records history, and never the typed command
    expect((await e.history(fg(), '', {})).total).toBe(0);
  });

  it('/upload <path> reads that path without the picker (also ~/ and quoted paths)', async () => {
    const e = await boot({ '~/a.mush': SCRIPT, '/tmp/with space.txt': 'say hi\n' });
    const pick = vi.spyOn(e, 'pickFile');
    const read = vi.spyOn(e, 'readTextFile');
    await typeCommand('/upload ~/a.mush');
    await dialog(/Upload a\.mush/);
    expect(read).toHaveBeenCalledWith('~/a.mush');
    expect(pick).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await typeCommand('/upload "/tmp/with space.txt"');
    await dialog(/Upload with space\.txt/);
    expect(read).toHaveBeenLastCalledWith('/tmp/with space.txt');
  });

  it('a cancelled picker does nothing', async () => {
    const e = await boot();
    e.nextPick = '';
    await typeCommand('/upload');
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUi.getState().toasts).toEqual([]);
  });

  it('reports a relative path, a missing file and an engine failure as errors', async () => {
    const e = await boot();
    await typeCommand('/upload notes.txt');
    await waitFor(() => expect(useUi.getState().toasts.at(-1)?.text).toMatch(/absolute path/));
    await typeCommand('/upload ~/missing.txt');
    await waitFor(() => expect(useUi.getState().toasts.at(-1)?.text).toMatch(/not found/));
    vi.spyOn(e, 'readTextFile').mockRejectedValue(new Error('boom'));
    await typeCommand('/upload ~/a.mush');
    await waitFor(() => expect(useUi.getState().toasts.at(-1)?.text).toMatch(/boom/));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent(e)).toEqual([]);
  });

  it('works from the editor too, line by line, and a block can mix it with game text', async () => {
    const e = await boot();
    await typeCommand('say before');
    await typeCommand('/upload ~/a.mush');
    await dialog();
    expect(sent(e)).toEqual(['say before']);
  });
});

describe('upload dialog', () => {
  async function open(
    file = SCRIPT,
    delay = 0,
    patch: Partial<ReturnType<typeof useSettings.getState>['settings']> = {},
  ): Promise<{ e: MockEngine; d: HTMLElement }> {
    const e = await boot({ '~/a.mush': file });
    useSettings.setState({ settings: { ...useSettings.getState().settings, ...patch } });
    setFast(delay);
    await typeCommand('/upload ~/a.mush');
    return { e, d: await dialog() };
  }

  it('shows file facts, a numbered preview, and the prepared result with the command count', async () => {
    const { d } = await open();
    expect(screen.getByLabelText('File details')).toHaveTextContent(/a\.mush.*\d+ bytes.*6 lines.*UTF-8/);
    const preview = within(d).getByRole('region', { name: 'File preview' });
    expect(preview).toHaveTextContent('@@ greeter');
    expect(preview.querySelector('[data-line="2"]')).toHaveTextContent('&GREET me=Hello,');
    expect(screen.getByLabelText('Prepared result')).toHaveTextContent(
      '3 commands will be sent, 1 continuation line joined, 2 blank/comment lines skipped.',
    );
    await userEvent.click(within(d).getByRole('tab', { name: /To be sent \(3\)/ }));
    const prepared = within(d).getByRole('region', { name: 'Prepared commands preview' });
    expect(prepared).toHaveTextContent('&GREET me=Hello,[name(%#)]!');
    expect(prepared).not.toHaveTextContent('@@ greeter');
  });

  it('options start from the settings and change the prepared result', async () => {
    const { d } = await open(SCRIPT, 0, { softcodeJoin: false, stripBlankLines: false });
    expect(within(d).getByRole('checkbox', { name: /Join continuation/ })).not.toBeChecked();
    expect(screen.getByLabelText('Prepared result')).toHaveTextContent('6 commands will be sent.');
    await userEvent.click(within(d).getByRole('checkbox', { name: /Join continuation/ }));
    await userEvent.click(within(d).getByRole('checkbox', { name: /Skip blank/ }));
    expect(screen.getByLabelText('Prepared result')).toHaveTextContent('3 commands will be sent');
    await userEvent.type(within(d).getByLabelText('Prefix for every command'), '@force me=');
    await userEvent.click(within(d).getByRole('tab', { name: /To be sent/ }));
    expect(within(d).getByRole('region', { name: 'Prepared commands preview' })).toHaveTextContent(
      '@force me=think one',
    );
  });

  it('the per-line delay defaults to the setting, or 50 ms when the setting is 0', async () => {
    const { d } = await open(SCRIPT, 0);
    expect(within(d).getByLabelText('Delay per line (ms)')).toHaveValue(50);
    cleanup();
    useUpload.getState().close();
    resetStores();
    await boot();
    setFast(120);
    await typeCommand('/upload ~/a.mush');
    expect(within(await dialog()).getByLabelText('Delay per line (ms)')).toHaveValue(120);
  });

  it('sends nothing until Send is clicked, then one command per line to the target session; ONE history entry', async () => {
    const { e, d } = await open();
    const delay = within(d).getByLabelText('Delay per line (ms)');
    await userEvent.clear(delay);
    await userEvent.type(delay, '0');
    expect(sent(e)).toEqual([]);
    await userEvent.click(within(d).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByLabelText('Upload summary')).toBeInTheDocument());
    expect(e.sent).toEqual([
      { session: fg(), text: '&GREET me=Hello,[name(%#)]!' },
      { session: fg(), text: 'think one' },
      { session: fg(), text: 'think two' },
    ]);
    expect(screen.getByLabelText('Upload summary')).toHaveTextContent(
      /Done: sent 3 commands, 2 skipped \(blank or comment lines\)/,
    );
    expect(screen.getByLabelText('Upload progress')).toHaveTextContent('3/3 (100%)');
    const hist = await e.history(fg(), '', {});
    expect(hist.entries.map((x) => x.text)).toEqual(['/upload a.mush']);
    await userEvent.click(within(d).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('paces the send, shows progress and the current line, pauses, resumes and cancels with a summary', async () => {
    const lines = Array.from({ length: 8 }, (_, i) => `think line ${i + 1}`).join('\n');
    const { e, d } = await open(lines, 40);
    await userEvent.click(within(d).getByRole('button', { name: 'Send' }));
    expect(sent(e)).toEqual(['think line 1']);
    const prog = screen.getByLabelText('Upload progress');
    await waitFor(() => expect(prog).toHaveTextContent(/Sending [2-9]\/8/));
    expect(within(prog).getByText(/Line \d+: think line/)).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(prog).toHaveTextContent(/Paused: /));
    const n = sent(e).length;
    await new Promise((r) => setTimeout(r, 200));
    expect(sent(e).length).toBe(n);
    await userEvent.click(within(d).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(sent(e).length).toBeGreaterThan(n));
    await userEvent.click(within(d).getByRole('button', { name: 'Cancel' }));
    const m = sent(e).length;
    const sum = await screen.findByLabelText('Upload summary');
    expect(sum).toHaveTextContent(new RegExp(`Cancelled at command ${m + 1} of 8: ${m} sent`));
    await new Promise((r) => setTimeout(r, 150));
    expect(sent(e).length).toBe(m);
    expect(m).toBeLessThan(8);
  });

  it('closing the dialog with Escape while sending cancels the rest', async () => {
    const lines = Array.from({ length: 6 }, (_, i) => `say ${i}`).join('\n');
    const { e, d } = await open(lines, 50);
    await userEvent.click(within(d).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sent(e).length).toBeGreaterThan(1));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const n = sent(e).length;
    await new Promise((r) => setTimeout(r, 200));
    expect(sent(e).length).toBe(n);
    expect(n).toBeLessThan(6);
    expect(useUi.getState().toasts.some((t) => /cancelled/i.test(t.text))).toBe(true);
  });

  it('warns about unbalanced brackets in the prepared code and makes the user say "Send anyway"', async () => {
    const { e, d } = await open('say ok\n&F me=[add(1,2\nsay fine\n');
    const alert = within(d).getByRole('alert');
    expect(alert).toHaveTextContent('2 bracket problems');
    expect(alert).toHaveTextContent(/Command 2:/);
    expect(within(d).queryByRole('button', { name: 'Send' })).toBeNull();
    const go = within(d).getByRole('button', { name: 'Send anyway' });
    expect(sent(e)).toEqual([]);
    await userEvent.click(go);
    await waitFor(() => expect(sent(e)).toEqual(['say ok', '&F me=[add(1,2', 'say fine']));
  });

  it('lists only the first few problems; balanced code shows no warning', async () => {
    const bad = Array.from({ length: 9 }, (_, i) => `say (${i}`).join('\n');
    const { d } = await open(bad);
    expect(within(d).getByRole('alert')).toHaveTextContent(/and \d+ more/);
    expect(within(d).getByRole('alert').querySelectorAll('li').length).toBe(5);
    cleanup();
    useUpload.getState().close();
    resetStores();
    await boot();
    await typeCommand('/upload ~/a.mush');
    expect(within(await dialog()).queryByRole('alert')).toBeNull();
  });

  it('the warning can be switched off: Send stays "Send"', async () => {
    const { d } = await open('say [add(1,2\n', 0, { warnUnbalanced: false });
    expect(within(d).getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('cannot send to a session that is not connected, and an empty result has nothing to send', async () => {
    const e = await boot();
    const ended = Object.values(useSessions.getState().sessions).find((s) => s.state === 'ended');
    expect(ended).toBeTruthy();
    act(() =>
      openUpload(ended?.id ?? '', {
        ok: true,
        path: '/x.txt',
        name: 'x.txt',
        size: 4,
        encoding: 'utf-8',
        text: 'say hi\n',
      }),
    );
    const d = await dialog();
    expect(within(d).getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByLabelText('Target session')).toHaveTextContent('(not connected)');
    act(() => useUpload.getState().close());
    act(() =>
      openUpload(fg(), {
        ok: true,
        path: '/e.txt',
        name: 'e.txt',
        size: 8,
        encoding: 'utf-8',
        text: '@@ x\n\n',
      }),
    );
    const d2 = await dialog();
    expect(screen.getByLabelText('Prepared result')).toHaveTextContent('Nothing to send');
    expect(within(d2).getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(sent(e)).toEqual([]);
  });

  it('a send error from the engine stops the upload and is reported in the summary', async () => {
    const { e, d } = await open('say a\nsay b\nsay c\n', 30);
    vi.spyOn(e, 'input').mockRejectedValue(new Error('connection lost'));
    await userEvent.click(within(d).getByRole('button', { name: 'Send' }));
    const sum = await screen.findByLabelText('Upload summary');
    expect(sum).toHaveTextContent(/Stopped by an error: connection lost/);
  });

  it('stays responsive with a 60k line file: the preview is virtualised and chunked sending finishes', async () => {
    const big = Array.from({ length: 60_000 }, (_, i) => `think ${i + 1}`).join('\n');
    const { e, d } = await open(big);
    const rows = (): number => d.querySelectorAll('.cw-vl-row').length;
    expect(rows()).toBeGreaterThan(5);
    expect(rows()).toBeLessThan(80);
    const view = within(d).getByRole('region', { name: 'File preview' });
    view.scrollTop = 18 * 30_000;
    fireEvent.scroll(view);
    await waitFor(() => expect(view.querySelector('[data-line="30001"]')).not.toBeNull());
    expect(rows()).toBeLessThan(80);
    expect(screen.getByLabelText('Prepared result')).toHaveTextContent('60000 commands will be sent');
    const delay = within(d).getByLabelText('Delay per line (ms)');
    await userEvent.clear(delay);
    await userEvent.type(delay, '0');
    await userEvent.click(within(d).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByLabelText('Upload summary')).toBeInTheDocument(), {
      timeout: 20000,
    });
    expect(e.sent).toHaveLength(60_000);
    expect(sent(e)[59_999]).toBe('think 60000');
  }, 40000);
});

describe('dropping a file on the window', () => {
  const dropOf = (file: File): Event => {
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: [file] } });
    return ev;
  };

  it('opens the upload dialog for the foreground session (read with FileReader, nothing sent)', async () => {
    const e = await boot();
    const f = new File(['say dropped\nsay two\n'], 'drop.mush', { type: 'text/plain' });
    await act(async () => {
      window.dispatchEvent(dropOf(f));
    });
    const d = await dialog(/Upload drop\.mush/);
    expect(screen.getByLabelText('Prepared result')).toHaveTextContent('2 commands');
    expect(screen.getByLabelText('Target session')).toHaveTextContent(
      useSessions.getState().sessions[fg()].name,
    );
    expect(sent(e)).toEqual([]);
    expect(d).toBeInTheDocument();
  });

  it('shows an overlay while dragging, and ignores drags that carry no files', async () => {
    await boot();
    const enter = new Event('dragenter', { bubbles: true, cancelable: true });
    Object.defineProperty(enter, 'dataTransfer', { value: { types: ['Files'], files: [] } });
    act(() => {
      window.dispatchEvent(enter);
    });
    expect(screen.getByText('Drop a text file to upload it')).toBeInTheDocument();
    const leave = new Event('dragleave', { bubbles: true });
    Object.defineProperty(leave, 'dataTransfer', { value: { types: ['Files'], files: [] } });
    act(() => {
      window.dispatchEvent(leave);
    });
    expect(screen.queryByText('Drop a text file to upload it')).toBeNull();
    const text = new Event('dragenter', { bubbles: true, cancelable: true });
    Object.defineProperty(text, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });
    act(() => {
      window.dispatchEvent(text);
    });
    expect(screen.queryByText('Drop a text file to upload it')).toBeNull();
  });

  it('rejects binary and oversized drops with an error and no dialog', async () => {
    await boot();
    const bin = new File([new Uint8Array([1, 0, 2, 0, 3])], 'pic.png');
    await act(async () => {
      window.dispatchEvent(dropOf(bin));
    });
    await waitFor(() => expect(useUi.getState().toasts.at(-1)?.text).toMatch(/pic\.png.*binary/));
    expect(screen.queryByRole('dialog')).toBeNull();
    const huge = new File(['x'], 'huge.txt');
    Object.defineProperty(huge, 'size', { value: 6 * 1024 * 1024 });
    await act(async () => {
      window.dispatchEvent(dropOf(huge));
    });
    await waitFor(() => expect(useUi.getState().toasts.at(-1)?.text).toMatch(/too large/));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('needs a session: without one it says so', async () => {
    await boot();
    act(() => useSessions.getState().setFg(null));
    await act(async () => {
      window.dispatchEvent(dropOf(new File(['say x'], 'x.txt')));
    });
    expect(useUi.getState().toasts.at(-1)?.text).toMatch(/Open a session first/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not stack a second upload on an open dialog', async () => {
    await boot();
    await typeCommand('/upload ~/a.mush');
    await dialog();
    await act(async () => {
      window.dispatchEvent(dropOf(new File(['say x'], 'other.txt')));
    });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: /a\.mush/ })).toBeInTheDocument();
  });
});
