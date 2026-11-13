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
import { pressKey as pressKeyOn } from './codeeditor.helpers';
import { content, doc, press, setDoc, setSel, typeText, view, waitEditor } from './input.helpers';

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
const enterEditor = async (): Promise<HTMLElement> => {
  await userEvent.click(screen.getByRole('button', { name: 'Multi-line mode' }));
  await waitEditor();
  return content();
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

describe('editor mode (CodeMirror)', () => {
  it('toggles with the button, Cmd/Ctrl+Shift+E; Escape returns to one line and keeps the text', async () => {
    await boot();
    await enterEditor();
    typeText('abc');
    press('Escape');
    expect(await screen.findByLabelText('Command input')).toHaveValue('abc');
    fireEvent.keyDown(window, { key: 'E', ctrlKey: true, shiftKey: true });
    await waitEditor();
    expect(doc()).toBe('abc');
    fireEvent.keyDown(window, { key: 'E', metaKey: true, shiftKey: true });
    expect(await screen.findByLabelText('Command input')).toBeInTheDocument();
  });

  it('is a real CodeMirror editor: accessible name, MUSH highlighting, line numbers, bracket matching', async () => {
    await boot();
    await enterEditor();
    expect(content()).toHaveAttribute('aria-label', 'Command editor');
    expect(content()).toHaveAttribute('role', 'textbox');
    typeText('&A me=$go *:@pemit %#=[add(1,#12)]');
    expect(content().querySelector('.mc-attrdef')).not.toBeNull();
    expect(content().querySelector('.mc-function')?.textContent).toBe('add');
    expect(content().querySelector('.mc-substitution')).not.toBeNull();
    expect(document.querySelector('.cm-lineNumbers')).not.toBeNull();
  });

  it('Enter inserts a newline; Ctrl+Enter sends the buffer as joined lines and records ONE history entry', async () => {
    const e = await boot();
    await enterEditor();
    typeText('&F o=a\n  b\n@@ c\n\nsay hi');
    press('Enter'); // a plain Enter is a newline, never a send
    expect(doc().startsWith('&F o=a\n  b\n@@ c\n\nsay hi\n')).toBe(true);
    setDoc('&F o=a\n  b\n@@ c\n\nsay hi');
    expect(sent(e)).toEqual([]);
    press('Enter', { ctrl: true });
    expect(sent(e)).toEqual(['&F o=ab', 'say hi']);
    expect(doc()).toBe('');
    const page = await e.history(fg(), '', {});
    expect(page.entries.map((x) => x.text)).toEqual(['&F o=a\n  b\n@@ c\n\nsay hi']);
  });

  it('respects the softcodeJoin / stripBlankLines settings', async () => {
    const e = await boot();
    useSettings.setState({
      settings: { ...useSettings.getState().settings, softcodeJoin: false, stripBlankLines: false },
    });
    await enterEditor();
    typeText('a\n  b\n\nc');
    press('Enter', { ctrl: true });
    expect(sent(e)).toEqual(['a', '  b', '', 'c']);
  });

  it('Send line / selection sends the logical line under the cursor and keeps the buffer', async () => {
    const e = await boot();
    await enterEditor();
    typeText('one\ntwo\n  more\nthree');
    setSel(doc().indexOf('two') + 1);
    press('Enter', { ctrl: true, shift: true });
    expect(sent(e)).toEqual(['twomore']);
    expect(doc()).toContain('three');
    setSel(0, 3);
    await userEvent.click(screen.getByRole('button', { name: 'Send line / selection' }));
    expect(sent(e).at(-1)).toBe('one');
    expect(doc()).toContain('three');
  });

  it('Tab inserts two spaces, Shift+Tab outdents; Clear empties', async () => {
    await boot();
    await enterEditor();
    typeText('x');
    setSel(0);
    press('Tab');
    expect(doc()).toBe('  x');
    press('Tab', { shift: true });
    expect(doc()).toBe('x');
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(doc()).toBe('');
  });

  it('undo / redo work inside the editor', async () => {
    await boot();
    await enterEditor();
    typeText('one');
    typeText(' two');
    press('z', { ctrl: true });
    expect(doc()).not.toBe('one two');
    press('y', { ctrl: true });
    expect(doc()).toBe('one two');
  });

  it('Expand / Collapse toolbar buttons are reversible and honour the selection', async () => {
    await boot();
    await enterEditor();
    const code = '&F o=[switch(%0,1,[add(1,2)],2,[mul(3,4)],3,[sub(5,6)],4,[div(7,8)],default)] tail';
    typeText(code);
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(doc()).toContain('\n');
    expect(
      doc()
        .split('\n')
        .slice(1)
        .every((l) => /^\s/.test(l)),
    ).toBe(true); // continuation lines are indented
    await userEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(doc()).toBe(code);
    // selection only: the rest of the buffer is untouched
    setDoc('keep me\n' + code);
    setSel(8, 8 + code.length);
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(doc().startsWith('keep me\n&F o=')).toBe(true);
    expect(doc().split('\n').length).toBeGreaterThan(2);
  });

  it('line numbers and wrap are toggles and are remembered', async () => {
    await boot();
    await enterEditor();
    typeText('ab\ncd');
    expect(screen.getByLabelText('Cursor position')).toHaveTextContent('Ln 2, Col 3');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Line numbers' }));
    expect(document.querySelector('.cm-lineNumbers')).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Wrap' }));
    expect(content().classList.contains('cm-lineWrapping')).toBe(true);
    const prefs = JSON.parse(window.localStorage.getItem('squat.editor.prefs') ?? '{}');
    expect(prefs).toMatchObject({ wrap: true, lineNumbers: false });
  });

  it('shows the bracket problem count from the balance linter', async () => {
    await boot();
    await enterEditor();
    expect(screen.queryByLabelText('Bracket problems')).toBeNull();
    typeText('[add(1,2');
    await waitFor(() =>
      expect(screen.getByLabelText('Bracket problems')).toHaveTextContent('2 bracket problems'),
    );
    setDoc('[add(1,2)]');
    await waitFor(() => expect(screen.queryByLabelText('Bracket problems')).toBeNull());
  });

  it('Cmd/Ctrl+F opens the editor search and is NOT stolen by the global output search', async () => {
    await boot();
    await enterEditor();
    typeText('find me');
    press('f', { ctrl: true });
    await waitFor(() => expect(document.querySelector('.cm-search')).not.toBeNull());
    expect(useUi.getState().searchOpen).toBe(false);
    // Escape closes the search panel first and stays in editor mode
    const input = document.querySelector<HTMLElement>('.cm-search input') as HTMLElement;
    act(() => pressKeyOn(input, 'Escape'));
    await waitFor(() => expect(document.querySelector('.cm-search')).toBeNull());
    expect(content()).toBeInTheDocument();
    // outside the editor the global shortcut still works
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(useUi.getState().searchOpen).toBe(true);
  });

  it("multi-line paste in single-line mode still sends line by line (editor paste is CodeMirror's)", async () => {
    const e = await boot();
    const box = screen.getByLabelText('Command input');
    box.focus();
    await userEvent.paste('a\nb');
    expect(sent(e)).toEqual(['a', 'b']);
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
    await enterEditor();
    typeText('big\ncode');
    const first = fg();
    const other = useSessions
      .getState()
      .order.find((id) => id !== first && useSessions.getState().sessions[id].state === 'connected');
    act(() => useSessions.getState().setFg(other ?? null));
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeNull()); // other world: its own (empty) input
    act(() => useSessions.getState().setFg(first));
    await waitEditor();
    expect(doc()).toBe('big\ncode');
    // a restart: new component tree reads localStorage
    cleanup();
    clearDrafts();
    resetStores();
    render(<App engine={engine} />);
    await waitEditor();
    expect(doc()).toBe('big\ncode');
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

  it('secrets in an editor draft are not what is recorded: a block holding a connect line is dropped from history', async () => {
    const e = await boot();
    await enterEditor();
    typeText('connect me hunter2');
    press('Enter', { ctrl: true });
    expect(sent(e)).toEqual(['connect me hunter2']);
    expect((await e.history(fg(), '', {})).entries.map((x) => x.text)).not.toContain('connect me hunter2');
  });

  it('sends a block paced by sendLineDelayMs with progress and Cancel', async () => {
    const e = await boot();
    useSettings.setState({ settings: { ...useSettings.getState().settings, sendLineDelayMs: 60 } });
    await enterEditor();
    typeText('l1\nl2\nl3\nl4');
    press('Enter', { ctrl: true });
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

  it('the editor view is lazily loaded: CodeMirror is absent until editor mode opens', async () => {
    await boot();
    expect(document.querySelector('.cm-editor')).toBeNull();
    await enterEditor();
    expect(view()).toBeTruthy();
  });
});

describe('unbalanced bracket check before sending', () => {
  it('asks first: Send anyway sends the block, the dialog names the lines', async () => {
    const e = await boot();
    await enterEditor();
    typeText('say fine\n&F o=[add(1,2\nsay also fine');
    press('Enter', { ctrl: true });
    const dlg = await screen.findByRole('dialog', { name: 'Unbalanced brackets' });
    expect(dlg).toHaveTextContent(/2 bracket problems on line 2/);
    expect(sent(e)).toEqual([]);
    expect(doc()).toContain('say fine'); // nothing was cleared
    await userEvent.click(within(dlg).getByRole('button', { name: 'Send anyway' }));
    expect(sent(e)).toEqual(['say fine', '&F o=[add(1,2', 'say also fine']);
    expect(doc()).toBe('');
  });

  it('Fix first sends nothing, keeps the text and puts the cursor on the first problem', async () => {
    const e = await boot();
    await enterEditor();
    typeText('say fine\n&F o=[add(1,2');
    press('Enter', { ctrl: true });
    const dlg = await screen.findByRole('dialog', { name: 'Unbalanced brackets' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Fix first' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent(e)).toEqual([]);
    expect(doc()).toBe('say fine\n&F o=[add(1,2');
    await waitFor(() => expect(view().state.selection.main.head).toBe(doc().indexOf('[')));
  });

  it('also guards Send line / selection, numbering lines by the editor', async () => {
    const e = await boot();
    await enterEditor();
    typeText('ok\nbad(1,2\nok');
    setSel(doc().indexOf('bad') + 1);
    await userEvent.click(screen.getByRole('button', { name: 'Send line / selection' }));
    expect(await screen.findByRole('dialog', { name: 'Unbalanced brackets' })).toHaveTextContent(/on line 2/);
    expect(sent(e)).toEqual([]);
  });

  it('can be turned off with the warnUnbalanced setting', async () => {
    const e = await boot();
    useSettings.setState({ settings: { ...useSettings.getState().settings, warnUnbalanced: false } });
    await enterEditor();
    typeText('say [add(1,2');
    press('Enter', { ctrl: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent(e)).toEqual(['say [add(1,2']);
  });

  it('balanced code and single-line sending are unaffected', async () => {
    const e = await boot();
    await enterEditor();
    typeText('say [add(1,2)]');
    press('Enter', { ctrl: true });
    expect(sent(e)).toEqual(['say [add(1,2)]']);
    press('Escape');
    const box = await screen.findByLabelText('Command input');
    await userEvent.type(box, 'say :) [[add(1{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent(e).at(-1)).toBe('say :) [add(1');
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
    await waitEditor();
    expect(doc()).toBe('a\nb\nc');
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
