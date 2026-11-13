import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { resetStores, useSessions, useSettings, useUi } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { clearDrafts } from '../src/lib/drafts';
import { heightBounds } from '../src/lib/inputsize';
import { stubLayout } from './helpers';

let restore: () => void;
let engine: MockEngine;
beforeEach(() => {
  restore = stubLayout();
  resetStores();
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
  act(() => useUi.getState().openDialog(null)); // the demo opens "While you were away"
  return engine;
}
const sent = (e: MockEngine): string[] => e.sent.map((s) => s.text);
const fg = (): string => useSessions.getState().fg ?? '';
const enterEditor = async (): Promise<HTMLTextAreaElement> => {
  await userEvent.click(screen.getByRole('button', { name: 'Editor mode' }));
  return (await screen.findByLabelText('Command editor')) as HTMLTextAreaElement;
};

describe('resizable command window', () => {
  it('is a keyboard-operable separator: Up grows, Down shrinks, clamped, persisted, double-click resets', async () => {
    const e = await boot();
    const h = screen.getByRole('separator', { name: 'Resize command window' });
    const { min, max } = heightBounds(window.innerHeight, useSettings.getState().settings.fontSize);
    expect(h).toHaveAttribute('aria-valuemin', String(min));
    expect(h).toHaveAttribute('aria-valuemax', String(max));
    h.focus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    const grown = useSettings.getState().settings.inputHeight;
    expect(grown).toBeGreaterThan(min);
    expect((await e.getSettings()).inputHeight).toBe(grown); // persisted through the engine
    expect(screen.getByLabelText('Command input').style.height).toBe(`${grown}px`);
    await userEvent.keyboard('{End}');
    expect(useSettings.getState().settings.inputHeight).toBe(min);
    await userEvent.keyboard('{Home}');
    expect(useSettings.getState().settings.inputHeight).toBe(max);
    await userEvent.keyboard('{PageUp}');
    expect(useSettings.getState().settings.inputHeight).toBe(max); // cannot exceed ~70% of the window
    fireEvent.doubleClick(h);
    expect(useSettings.getState().settings.inputHeight).toBe(0);
    expect(screen.getByLabelText('Command input').style.height).toBe('');
  });

  it('dragging with the mouse resizes (up = taller) and commits on release', async () => {
    const e = await boot();
    const h = screen.getByRole('separator');
    const ta = screen.getByLabelText('Command input');
    Object.defineProperty(ta, 'offsetHeight', { value: 40, configurable: true });
    fireEvent.mouseDown(h, { clientY: 500, button: 0 });
    fireEvent.mouseMove(window, { clientY: 450 });
    expect(useSettings.getState().settings.inputHeight).toBe(90);
    fireEvent.mouseUp(window, { clientY: 400 });
    expect(useSettings.getState().settings.inputHeight).toBe(140);
    await waitFor(async () => expect((await e.getSettings()).inputHeight).toBe(140));
  });

  it('the editor has its own persisted height', async () => {
    await boot();
    await enterEditor();
    const body = document.querySelector<HTMLElement>('.editor-body');
    expect(body?.style.height).toBe('240px');
    screen.getByRole('separator').focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(useSettings.getState().settings.editorHeight).toBeGreaterThan(240);
    expect(useSettings.getState().settings.inputHeight).toBe(0);
  });
});

describe('editor mode', () => {
  it('toggles with the button, Cmd/Ctrl+Shift+E; Escape returns to one line and keeps the text', async () => {
    await boot();
    const ed = await enterEditor();
    await userEvent.type(ed, 'abc');
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByLabelText('Command input')).toHaveValue('abc');
    fireEvent.keyDown(window, { key: 'E', ctrlKey: true, shiftKey: true });
    expect(await screen.findByLabelText('Command editor')).toHaveValue('abc');
    fireEvent.keyDown(window, { key: 'E', metaKey: true, shiftKey: true });
    expect(await screen.findByLabelText('Command input')).toBeInTheDocument();
  });

  it('Enter inserts a newline; Ctrl+Enter sends the buffer as joined lines and records ONE history entry', async () => {
    const e = await boot();
    const ed = await enterEditor();
    await userEvent.type(ed, '&F o=a{Enter}  b{Enter}@@ c{Enter}{Enter}say hi');
    expect(ed.value).toBe('&F o=a\n  b\n@@ c\n\nsay hi');
    expect(sent(e)).toEqual([]);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(sent(e)).toEqual(['&F o=ab', 'say hi']);
    expect(ed.value).toBe('');
    const page = await e.history(fg(), '', {});
    expect(page.entries.map((x) => x.text)).toEqual(['&F o=a\n  b\n@@ c\n\nsay hi']);
  });

  it('respects the softcodeJoin / stripBlankLines settings', async () => {
    const e = await boot();
    useSettings.setState({
      settings: { ...useSettings.getState().settings, softcodeJoin: false, stripBlankLines: false },
    });
    const ed = await enterEditor();
    await userEvent.type(ed, 'a{Enter}  b{Enter}{Enter}c');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(sent(e)).toEqual(['a', '  b', '', 'c']);
  });

  it('Send line / selection sends the logical line under the cursor and keeps the buffer', async () => {
    const e = await boot();
    const ed = await enterEditor();
    await userEvent.type(ed, 'one{Enter}two{Enter}  more{Enter}three');
    ed.setSelectionRange(ed.value.indexOf('two') + 1, ed.value.indexOf('two') + 1);
    await userEvent.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}');
    expect(sent(e)).toEqual(['twomore']);
    expect(ed.value).toContain('three');
    ed.setSelectionRange(0, 3);
    await userEvent.click(screen.getByRole('button', { name: 'Send line / selection' }));
    expect(sent(e).at(-1)).toBe('one');
  });

  it('Tab inserts two spaces, Shift+Tab outdents; Clear empties', async () => {
    await boot();
    const ed = await enterEditor();
    await userEvent.type(ed, 'x');
    ed.setSelectionRange(0, 0);
    await userEvent.keyboard('{Tab}');
    expect(ed.value).toBe('  x');
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(ed.value).toBe('x');
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(ed.value).toBe('');
  });

  it('shows line numbers and the line/column indicator; wrap hides the gutter', async () => {
    await boot();
    const ed = await enterEditor();
    await userEvent.type(ed, 'ab{Enter}cd');
    expect(document.querySelector('.gutter')?.textContent).toBe('1\n2');
    expect(screen.getByLabelText('Cursor position')).toHaveTextContent('Ln 2, Col 3');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Wrap' }));
    expect(document.querySelector('.gutter')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('squat.editor.prefs') ?? '{}').wrap).toBe(true);
  });

  it('multi-line paste goes into the editor instead of being sent', async () => {
    const e = await boot();
    const ed = await enterEditor();
    ed.focus();
    await userEvent.paste('a\nb');
    expect(ed.value).toBe('a\nb');
    expect(sent(e)).toEqual([]);
  });

  it('single-line mode is unchanged: Enter sends, multi-line paste sends line by line, history is recorded', async () => {
    const e = await boot();
    const box = screen.getByLabelText('Command input');
    await userEvent.type(box, 'look{Enter}');
    box.focus();
    await userEvent.paste('x\ny\n');
    expect(sent(e)).toEqual(['look', 'x', 'y']);
    const page = await e.history(fg(), '', {});
    expect(page.entries.map((p) => p.text)).toEqual(['y', 'x', 'look']);
  });

  it('keeps the draft per world across tab switches and a remount (restart)', async () => {
    await boot();
    const ed = await enterEditor();
    await userEvent.type(ed, 'big{Enter}code');
    const first = fg();
    const other = useSessions
      .getState()
      .order.find((id) => id !== first && useSessions.getState().sessions[id].state === 'connected');
    act(() => useSessions.getState().setFg(other ?? null));
    await waitFor(() => expect(screen.queryByLabelText('Command editor')).toBeNull()); // other world: its own (empty) input
    act(() => useSessions.getState().setFg(first));
    expect(await screen.findByLabelText('Command editor')).toHaveValue('big\ncode');
    // a restart: new component tree reads localStorage
    cleanup();
    clearDrafts();
    resetStores();
    render(<App engine={engine} />);
    expect(await screen.findByLabelText('Command editor')).toHaveValue('big\ncode');
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('draft is never taken from the password prompt and passwords are not recorded', async () => {
    const e = await boot();
    const pw = Object.values(useSessions.getState().sessions).find((s) => s.remoteEcho);
    act(() => useSessions.getState().setFg(pw?.id ?? null));
    const box = await screen.findByLabelText('Password input');
    await userEvent.type(box, 'hunter2{Enter}');
    expect(sent(e).at(-1)).toBe('hunter2');
    expect(JSON.stringify(Object.entries(window.localStorage))).not.toContain('hunter2');
    expect((await e.history(pw?.id ?? '', '', {})).total).toBe(0);
  });

  it('sends a block paced by sendLineDelayMs with progress and Cancel', async () => {
    const e = await boot();
    useSettings.setState({ settings: { ...useSettings.getState().settings, sendLineDelayMs: 60 } });
    const ed = await enterEditor();
    await userEvent.type(ed, 'l1{Enter}l2{Enter}l3{Enter}l4');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(sent(e)).toEqual(['l1']);
    const status = await screen.findByRole('status', { name: 'Sending block' });
    expect(status).toHaveTextContent('Sending 1/4');
    await waitFor(() => expect(sent(e).length).toBeGreaterThanOrEqual(2));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const n = sent(e).length;
    await new Promise((r) => setTimeout(r, 200));
    expect(sent(e).length).toBe(n);
    expect(n).toBeLessThan(4);
    await waitFor(() => expect(useUi.getState().toasts.some((t) => /cancelled/i.test(t.text))).toBe(true));
  });
});

describe('persistent history in the input line', () => {
  it('seeds Up/Down recall from the world history when a session opens', async () => {
    engine = new MockEngine({ scenario: 'demo' });
    const sessions = await engine.listSessions();
    const s = sessions.find((x) => x.state === 'connected');
    await engine.recordHistory(s?.id ?? '', 'older command');
    render(<App engine={engine} />);
    await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
    const box = await screen.findByLabelText('Command input');
    await waitFor(async () => {
      box.focus();
      await userEvent.keyboard('{ArrowUp}');
      expect(box).toHaveValue('older command');
    });
  });
});

describe('history browser', () => {
  async function open(seed: string[]): Promise<MockEngine> {
    engine = new MockEngine({ scenario: 'demo' });
    const s = (await engine.listSessions()).find((x) => x.state === 'connected');
    for (const t of seed) await engine.recordHistory(s?.id ?? '', t);
    render(<App engine={engine} />);
    await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
    await screen.findByLabelText('Command input');
    act(() => useUi.getState().openDialog(null));
    fireEvent.keyDown(window, { key: 'r', ctrlKey: true });
    await screen.findByRole('dialog', { name: 'Command history' });
    await screen.findAllByRole('option');
    return engine;
  }

  it('opens with Ctrl+R, lists newest first, filters instantly, supports regex and case toggles', async () => {
    await open(['look', 'north', 'say Hello', 'look at me']);
    const opts = (): string[] => screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(opts()[0]).toContain('look at me');
    const search = screen.getByRole('searchbox', { name: 'Search history' });
    await userEvent.type(search, 'LOOK');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    expect(document.querySelector('.hrow mark')?.textContent).toBe('look');
    await userEvent.click(screen.getByRole('button', { name: 'Aa' }));
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    expect(screen.getByRole('status', { name: 'History results' })).toHaveTextContent('No matching commands');
    await userEvent.click(screen.getByRole('button', { name: 'Aa' }));
    await userEvent.clear(search);
    await userEvent.type(search, '^(north|say)');
    await userEvent.click(screen.getByRole('button', { name: '.*' }));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    await userEvent.clear(search);
    await userEvent.type(search, '(');
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i);
  });

  it('Up/Down select, Enter loads into the input, multi-line entries open the editor', async () => {
    await open(['first', 'a\nb\nc']);
    const search = screen.getByRole('searchbox');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(search).toHaveAttribute('aria-activedescendant', expect.stringMatching(/-o1$/));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByLabelText('Command input')).toHaveValue('first');
    fireEvent.keyDown(window, { key: 'r', ctrlKey: true });
    await screen.findAllByRole('option');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByLabelText('Command editor')).toHaveValue('a\nb\nc');
  });

  it('Shift+Enter sends immediately (a block through the block rules) and double-click loads', async () => {
    const e = await open(['say one', '&F o=a\n  b']);
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    await waitFor(() => expect(e.sent.map((s) => s.text)).toEqual(['&F o=ab']));
    fireEvent.keyDown(window, { key: 'r', ctrlKey: true });
    const rows = await screen.findAllByRole('option');
    fireEvent.click(rows[rows.length - 1]);
    fireEvent.doubleClick(rows[rows.length - 1]);
    expect(await screen.findByLabelText('Command input')).toHaveValue('say one');
  });

  it('Delete removes the selected entry; Clear history asks first', async () => {
    const e = await open(['one', 'two', 'three']);
    await userEvent.keyboard('{Delete}');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    const sid = fg();
    expect((await e.history(sid, '', {})).entries.map((x) => x.text)).toEqual(['two', 'one']);
    await userEvent.click(screen.getByRole('button', { name: 'Clear history…' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Delete all 2');
    await userEvent.click(within(alert).getByRole('button', { name: 'Cancel' }));
    expect((await e.history(sid, '', {})).total).toBe(2);
    await userEvent.click(screen.getByRole('button', { name: 'Clear history…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    await waitFor(async () => expect((await e.history(sid, '', {})).total).toBe(0));
    expect(await screen.findByText('No commands remembered yet')).toBeInTheDocument();
  });

  it('Escape closes; the dialog is labelled and modal', async () => {
    await open(['x']);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('stays responsive with 20k entries (virtualised, paged)', async () => {
    engine = new MockEngine({ scenario: 'demo' });
    const s = (await engine.listSessions()).find((x) => x.state === 'connected');
    await engine.saveSettings({ ...(await engine.getSettings()), historyMax: 30000 });
    for (let i = 0; i < 20000; i++) await engine.recordHistory(s?.id ?? '', `cmd number ${i}`);
    render(<App engine={engine} />);
    await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
    await screen.findByLabelText('Command input');
    act(() => useUi.getState().openDialog(null));
    fireEvent.keyDown(window, { key: 'r', ctrlKey: true });
    await screen.findAllByRole('option');
    expect(screen.getByRole('status', { name: 'History results' })).toHaveTextContent('1 of 20000');
    expect(document.querySelectorAll('[role=option]').length).toBeLessThan(100); // only the visible window is in the DOM
    await userEvent.keyboard('{Control>}{End}{/Control}');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    expect(screen.getByRole('status', { name: 'History results' })).toHaveTextContent('20000 of 20000');
  }, 30000);
});

describe('settings dialog', () => {
  it('shows history size and stored count, and clears with confirmation', async () => {
    engine = new MockEngine({ scenario: 'demo' });
    const s = (await engine.listSessions()).find((x) => x.state === 'connected');
    await engine.recordHistory(s?.id ?? '', 'a');
    await engine.recordHistory(s?.id ?? '', 'b');
    render(<App engine={engine} />);
    await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
    await screen.findByLabelText('Command input');
    act(() => useUi.getState().openDialog('settings'));
    const size = await screen.findByLabelText(/Command history size/);
    expect(size).toHaveValue(20000);
    expect(await screen.findByText(/2 stored/)).toBeInTheDocument();
    fireEvent.change(size, { target: { value: '50' } });
    expect(useSettings.getState().settings.historyMax).toBe(100); // clamped to the minimum
    await userEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear history' }).at(-1) as HTMLElement);
    await waitFor(async () => expect((await engine.history(s?.id ?? '', '', {})).total).toBe(0));
  });
});
