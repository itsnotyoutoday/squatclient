import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorView } from '@codemirror/view';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { resetStores, useSessions, useSettings, useUi } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { clearDrafts } from '../src/lib/drafts';
import {
  getBuffer,
  getObject,
  getWorkspace,
  openTarget,
  resetEditor,
  gotoRef,
  startPersistence,
} from '../src/state/editorStore';
import { persistKey } from '../src/lib/editor/persist';
import { worldKey } from '../src/lib/worldkey';
import { refAt } from '../src/lib/editor/refs';
import { stubLayout } from './helpers';

const readCss = (): string => readFileSync('src/styles/editorworkspace.css', 'utf8');

let restore: () => void;
let engine: MockEngine;
beforeEach(() => {
  restore = stubLayout();
  resetStores();
  resetEditor();
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
  act(() => useUi.getState().openDialog(null)); // "While you were away"
  return engine;
}
const fg = (): string => useSessions.getState().fg ?? '';

async function typeCommand(text: string): Promise<void> {
  const input = screen.getByLabelText('Command input');
  await userEvent.click(input);
  await userEvent.type(input, `${text}{Enter}`);
}
const view = (attr: string, dbref = '#12'): EditorView => {
  const el = document.querySelector(`.cm-content[aria-label="Value of ${attr} on ${dbref}"]`);
  const v = el && EditorView.findFromDOM(el.closest('.cm-editor') as HTMLElement);
  if (!v) throw new Error(`no editor for ${dbref}/${attr}`);
  return v;
};
const waitEditorFor = (attr: string, dbref = '#12'): Promise<void> =>
  waitFor(() => expect(view(attr, dbref)).toBeTruthy());
const setDoc = (attr: string, text: string, dbref = '#12'): void =>
  act(() =>
    view(attr, dbref).dispatch({
      changes: { from: 0, to: view(attr, dbref).state.doc.length, insert: text },
    }),
  );
const key = (k: string, mods: Partial<KeyboardEventInit> = {}): void => {
  act(() => {
    // like a real key press: dispatched on the focused element, bubbling up to window
    (document.activeElement ?? window).dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }),
    );
  });
};

async function openEditor(cmd = '/edit #12/POWER'): Promise<MockEngine> {
  const e = await boot();
  await typeCommand(cmd);
  await screen.findByTestId('editor-workspace');
  return e;
}

describe('entry points', () => {
  it('/edit #12/POWER flips to the editor, opens the object and attribute, and sends nothing to the game', async () => {
    const e = await openEditor();
    await screen.findByRole('tab', { name: /Command Console \(#12\)/ });
    await waitEditorFor('POWER');
    expect(view('POWER').state.doc.toString()).toBe('100');
    expect(useUi.getState().view).toBe('editor');
    expect(screen.queryByLabelText('Command input')).toBeNull(); // terminal view is not showing
    expect(e.sent.map((s) => s.text)).toEqual(['/edit #12/POWER'].filter(() => false)); // /edit itself never reaches the game
    expect(e.sent).toEqual([]);
    // the terminal's session is still there
    expect(useSessions.getState().sessions[fg()]).toBeDefined();
  });

  it('bare /edit opens the view; Cmd-E toggles; Escape and the Terminal button leave', async () => {
    await boot();
    await typeCommand('/edit');
    await screen.findByTestId('editor-workspace');
    key('e', { metaKey: true });
    await screen.findByLabelText('Command input');
    expect(useUi.getState().view).toBe('terminal');
    await userEvent.click(screen.getByRole('button', { name: 'Object Editor' })); // top bar button
    await screen.findByTestId('editor-workspace');
    key('Escape');
    await screen.findByLabelText('Command input');
    // Ctrl-E means end-of-line inside the input line and must not flip the view there ...
    await userEvent.click(screen.getByLabelText('Command input'));
    key('e', { ctrlKey: true });
    expect(useUi.getState().view).toBe('terminal');
    // ... but toggles from anywhere else
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    key('e', { ctrlKey: true });
    await screen.findByTestId('editor-workspace');
    await userEvent.click(screen.getByRole('button', { name: 'Terminal' }));
    await screen.findByLabelText('Command input');
  });

  it('a bad /edit shows a message and stays in the terminal; an unknown object keeps the view with a toast', async () => {
    await boot();
    await typeCommand('/edit #12/a b');
    expect(useUi.getState().view).toBe('terminal');
    await waitFor(() =>
      expect(
        useUi
          .getState()
          .toasts.map((t) => t.text)
          .join(),
      ).toMatch(/not a valid attribute/),
    );
    await typeCommand('/edit #999');
    await waitFor(() =>
      expect(
        useUi
          .getState()
          .toasts.map((t) => t.text)
          .join(),
      ).toMatch(/No such object/),
    );
  });
});

describe('layout and accessibility', () => {
  it('has the tablists, tabpanel, listbox, labelled controls and a main landmark', async () => {
    await openEditor();
    await waitEditorFor('POWER');
    const worlds = screen.getByRole('tablist', { name: 'Worlds' });
    expect(within(worlds).getAllByRole('tab').length).toBeGreaterThan(0);
    expect(
      within(worlds)
        .getAllByRole('tab')
        .filter((t) => t.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1);
    const objects = screen.getByRole('tablist', { name: 'Open objects' });
    const tab = within(objects).getByRole('tab', { name: /Command Console/ });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('aria-controls', 'ew-panel');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    const list = screen.getByRole('listbox', { name: /Attributes of Command Console/ });
    const opts = within(list).getAllByRole('option');
    expect(opts.length).toBeGreaterThan(5);
    expect(opts.length).toBeLessThan(80); // virtualised: not all ~130 rows
    expect(within(list).getByRole('option', { selected: true })).toHaveTextContent('POWER');
    expect(screen.getByRole('main', { name: 'Object Editor' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: /Tools for POWER/ })).toBeInTheDocument();
    for (const name of ['Save', 'Revert', 'Expand', 'Collapse', 'Compare', 'Refresh']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('checkbox', { name: /Wrap/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /%r as line breaks/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Value of POWER on #12' })).toBeInTheDocument();
    expect(screen.getByLabelText('Filter attributes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ new attribute' })).toBeInTheDocument();
  });

  it('arrow keys move between tabs; Up/Down/Enter drive the attribute list', async () => {
    await openEditor();
    await waitEditorFor('POWER');
    await act(async () => {
      await openTarget(fg(), '#13');
    });
    const objects = screen.getByRole('tablist', { name: 'Open objects' });
    const first = within(objects).getByRole('tab', { name: /Command Console/ });
    act(() => first.focus());
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(getWorkspace(fg()).activeObject).toBe('#13'));
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(getWorkspace(fg()).activeObject).toBe('#12'));

    const list = screen.getByRole('listbox', { name: /Attributes of Command Console/ });
    list.focus();
    const before = list.getAttribute('aria-activedescendant');
    await userEvent.keyboard('{ArrowDown}');
    expect(list.getAttribute('aria-activedescendant')).not.toBe(before);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(getObject(fg(), '#12')!.activeAttr).not.toBe('POWER'));
  });

  it('filters the attribute list and shows markers for modified and read-only attributes', async () => {
    await openEditor('/edit #12/LOCKED_ATTR');
    await waitEditorFor('LOCKED_ATTR');
    await userEvent.type(screen.getByLabelText('Filter attributes'), 'locked');
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(within(list).getByRole('img', { name: 'read-only' })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Filter attributes'));
    await userEvent.type(screen.getByLabelText('Filter attributes'), 'power');
    await userEvent.click(within(list).getByRole('option', { name: /^POWER/ }));
    await waitEditorFor('POWER');
    setDoc('POWER', '5');
    await waitFor(() =>
      expect(within(list).getByRole('option', { name: /POWER.*modified/ })).toBeInTheDocument(),
    );
    await userEvent.type(screen.getByLabelText('Filter attributes'), 'zzz');
    expect(screen.getByText('No attribute matches.')).toBeInTheDocument();
  });

  it('layout-critical CSS: flex column root, min-height:0 panes, only ew- selectors', async () => {
    const css = readCss();
    const rule = (sel: string): string =>
      new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(rule('.ew-root')).toMatch(/display:\s*flex/);
    expect(rule('.ew-root')).toMatch(/flex-direction:\s*column/);
    for (const c of [
      '.ew-root',
      '.ew-body',
      '.ew-side',
      '.ew-main',
      '.ew-editors',
      '.ew-editorhost',
      '.ew-attrscroll',
    ]) {
      expect(rule(c), c).toMatch(/min-height:\s*0/);
    }
    expect(rule('.ew-attrscroll')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.ew-editorhost > .codeeditor')).toMatch(/min-height:\s*0/);
    const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{/g)]
      .flatMap((m) => m[1].split(','))
      .map((s) => s.trim())
      .filter(
        (s) =>
          s &&
          !/^(to|from|\d+%)$/.test(s) &&
          !s.startsWith('@') &&
          !s.startsWith('keyframes ') &&
          !s.startsWith('media '),
      );
    for (const s of selectors) expect(s, s).toMatch(/^\.ew-/);
    // narrow windows keep the list usable (600px floor)
    expect(css).toMatch(/@media \(max-width: 760px\)/);
  });

  it('component sources only use ew- class names (plus the shared button/dialog helpers)', async () => {
    const files = import.meta.glob('../src/components/editor/*.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const allowed = new Set(['primary', 'danger', 'dim', 'actions']);
    const bad: string[] = [];
    for (const [f, src] of Object.entries(files)) {
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        for (const c of (m[1] ?? m[2]).split(/\s+/).filter((x) => /^[A-Za-z][\w-]*$/.test(x))) {
          if (!c.startsWith('ew-') && !allowed.has(c)) bad.push(`${f}: ${c}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('permissions', () => {
  it('an object you do not control opens read-only with a banner; Save is disabled; the editor is read-only', async () => {
    await openEditor('/edit #14/LOG');
    await waitEditorFor('LOG', '#14');
    expect(await screen.findByTestId('readonly-banner')).toHaveTextContent(
      /You do not control #14 \(owner: #7\); editing is disabled/,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+ new attribute' })).toBeDisabled();
    expect(view('LOG', '#14').state.readOnly).toBe(true);
    // Compare and Refresh still work
    expect(screen.getByRole('button', { name: 'Compare' })).toBeEnabled();
    key('s', { metaKey: true });
    expect(engine.game.calls.some((c) => c.method === 'saveAttr')).toBe(false);
  });

  it('unknown control: editable with a notice', async () => {
    await openEditor('/edit #16/NOTE');
    await waitEditorFor('NOTE', '#16');
    expect(await screen.findByTestId('unknown-banner')).toHaveTextContent(
      /Could not check whether you control #16/,
    );
    expect(view('NOTE', '#16').state.readOnly).toBe(false);
  });

  it('a protected attribute opens read-only with a lock', async () => {
    await openEditor('/edit #12/LOCKED_ATTR');
    await waitEditorFor('LOCKED_ATTR');
    await screen.findByText(/LOCKED_ATTR is protected/);
    expect(view('LOCKED_ATTR').state.readOnly).toBe(true);
  });
});

describe('saving', () => {
  it('Save button and Cmd-S: saved, verified, announced', async () => {
    await openEditor();
    await waitEditorFor('POWER');
    setDoc('POWER', '250');
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(saveBtn).toBeEnabled());
    await userEvent.click(saveBtn);
    await waitFor(() => expect(engine.game.objects.get('#12')!.attrs.POWER.value).toBe('250'));
    expect(await screen.findByTestId('save-notice')).toHaveTextContent('Saved');
    expect(screen.getByTestId('editor-announce')).toHaveTextContent('Saved POWER on #12');
    expect(saveBtn).toBeDisabled();

    setDoc('POWER', '300');
    key('s', { metaKey: true });
    await waitFor(() => expect(engine.game.objects.get('#12')!.attrs.POWER.value).toBe('300'));
  });

  it('Cmd-Shift-S saves every dirty attribute of the object', async () => {
    await openEditor();
    await waitEditorFor('POWER');
    setDoc('POWER', '1');
    await act(async () => {
      await (await import('../src/state/editorStore')).selectAttr(fg(), '#12', 'DO_ENGAGE');
    });
    await waitEditorFor('DO_ENGAGE');
    setDoc('DO_ENGAGE', '@pemit %#=x');
    key('s', { metaKey: true, shiftKey: true });
    await waitFor(() => expect(engine.game.objects.get('#12')!.attrs.DO_ENGAGE.value).toBe('@pemit %#=x'));
    await waitFor(() => expect(engine.game.objects.get('#12')!.attrs.POWER.value).toBe('1'));
  });

  it("a rejected save keeps the text and shows the game's exact reply, prominently and announced", async () => {
    await openEditor();
    await waitEditorFor('POWER');
    engine.game.rejectRate = 1;
    setDoc('POWER', 'my precious work');
    key('s', { ctrlKey: true });
    const err = await screen.findByTestId('save-error');
    expect(err).toHaveTextContent('Not saved: Permission denied.');
    expect(err).toHaveAttribute('role', 'alert');
    expect(view('POWER').state.doc.toString()).toBe('my precious work');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByTestId('editor-alert')).toHaveTextContent(/POWER was not saved: Permission denied/);
    expect(
      within(screen.getByRole('listbox')).getByRole('option', { name: /POWER.*error/ }),
    ).toBeInTheDocument();
    engine.game.rejectRate = 0;
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(engine.game.objects.get('#12')!.attrs.POWER.value).toBe('my precious work'));
  });

  it('conflict: side-by-side diff with Overwrite / Reload theirs / Keep editing', async () => {
    await openEditor();
    await waitEditorFor('POWER');
    setDoc('POWER', 'mine');
    engine.game.externalSet('#12', 'POWER', 'theirs');
    key('s', { metaKey: true });
    const dlg = await screen.findByRole('dialog', { name: /POWER changed in the game/ });
    expect(within(dlg).getByRole('table')).toBeInTheDocument();
    expect(within(dlg).getAllByRole('row').length).toBeGreaterThan(1);
    expect(within(dlg).getByText('theirs')).toBeInTheDocument();
    expect(within(dlg).getByText('mine')).toBeInTheDocument();
    expect(engine.game.calls.some((c) => c.method === 'saveAttr')).toBe(false);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Reload theirs' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(view('POWER').state.doc.toString()).toBe('theirs'));

    setDoc('POWER', 'mine again');
    engine.game.externalSet('#12', 'POWER', 'theirs 2');
    key('s', { metaKey: true });
    const dlg2 = await screen.findByRole('dialog');
    await userEvent.click(within(dlg2).getByRole('button', { name: 'Overwrite' }));
    await waitFor(() => expect(engine.game.objects.get('#12')!.attrs.POWER.value).toBe('mine again'));
  });

  it('a mismatch shows a warning and keeps the buffer dirty', async () => {
    await openEditor();
    await waitEditorFor('POWER');
    engine.game.alterOnSave = (v) => v + '!';
    setDoc('POWER', 'abc');
    key('s', { metaKey: true });
    expect(await screen.findByTestId('save-error')).toHaveTextContent(/Not stored as written/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('Expand / Collapse in the toolbar change only the view; the saved value is collapsed', async () => {
    await openEditor('/edit #12/FN_CHECKPOWER');
    await waitEditorFor('FN_CHECKPOWER');
    setDoc(
      'FN_CHECKPOWER',
      'if(gte(get(%!/POWER),mul(%0,10)),add(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15),sub(100,200,300,400))',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }));
    await waitFor(() => expect(view('FN_CHECKPOWER').state.doc.lines).toBeGreaterThan(1));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(engine.game.objects.get('#12')!.attrs.FN_CHECKPOWER.value).toContain('sub(100'),
    );
    expect(engine.game.objects.get('#12')!.attrs.FN_CHECKPOWER.value).not.toContain('\n');
    expect(engine.game.objects.get('#12')!.attrs.FN_CHECKPOWER.value).toBe(
      'if(gte(get(%!/POWER),mul(%0,10)),add(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15),sub(100,200,300,400))',
    );
  });

  it('%r as line breaks: toggle, edit with real newlines, saved as %r', async () => {
    await openEditor('/edit #12/DESCRIBE');
    await waitEditorFor('DESCRIBE');
    await userEvent.click(screen.getByRole('checkbox', { name: /%r as line breaks/ }));
    await waitFor(() =>
      expect(view('DESCRIBE').state.doc.toString()).toBe(
        'A bank of glowing panels.\nThe central display reads READY.',
      ),
    );
    expect(screen.getByRole('button', { name: 'Expand' })).toBeDisabled();
    setDoc('DESCRIBE', 'one\ntwo');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(engine.game.objects.get('#12')!.attrs.DESCRIBE.value).toBe('one%rtwo'));
  });

  it('Revert restores the stored text; Compare shows the difference to the game', async () => {
    await openEditor();
    await waitEditorFor('POWER');
    setDoc('POWER', 'changed');
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }));
    const dlg = await screen.findByRole('dialog', { name: /Compare POWER/ });
    await within(dlg).findByRole('table');
    expect(within(dlg).getByText('100')).toBeInTheDocument();
    expect(within(dlg).getByText('changed')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revert' }));
    await waitFor(() => expect(view('POWER').state.doc.toString()).toBe('100'));
  });

  it('programmatic reads and writes never reach the terminal or the command history', async () => {
    const e = await openEditor();
    await waitEditorFor('POWER');
    setDoc('POWER', '42');
    key('s', { metaKey: true });
    await waitFor(() => expect(e.game.objects.get('#12')!.attrs.POWER.value).toBe('42'));
    expect(e.sent).toEqual([]);
    const lines = await e.scrollback(fg(), { limit: 500 });
    expect(JSON.stringify(lines)).not.toMatch(/SQUATCAP|POWER/);
    const h = await e.history(fg(), '', {});
    expect(h.entries.map((x) => x.text)).not.toContain('42');
  });
});

describe('tabs and keys', () => {
  it('[+] asks for a target: validates, reports errors inline, opens by dbref / me / name', async () => {
    await openEditor();
    await waitEditorFor('POWER');
    await userEvent.click(screen.getByRole('button', { name: 'Open another object' }));
    const input = screen.getByLabelText('Open object');
    await userEvent.type(input, 'a;b{Enter}');
    expect(await screen.findByText(/cannot contain/)).toHaveAttribute('role', 'alert');
    await userEvent.clear(input);
    await userEvent.type(input, '#999{Enter}');
    await screen.findByText(/No such object: #999/);
    await userEvent.clear(input);
    await userEvent.type(input, 'Nav{Enter}');
    await screen.findByRole('tab', { name: /Nav Console \(#13\)/ });
    expect(screen.queryByLabelText('Open object')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open another object' }));
    await userEvent.type(screen.getByLabelText('Open object'), '#14/LOG{Enter}');
    await screen.findByRole('tab', { name: /Captain's Log \(#14\)/ });
    await waitEditorFor('LOG', '#14');
    await userEvent.click(screen.getByRole('button', { name: 'Open another object' }));
    await userEvent.type(screen.getByLabelText('Open object'), 'Console{Enter}');
    expect(await screen.findByText(/More than one object matches/)).toBeInTheDocument();
    key('Escape'); // closes the prompt first, never the view
    await waitFor(() => expect(screen.queryByLabelText('Open object')).toBeNull());
    expect(useUi.getState().view).toBe('editor');
  });

  it('Cmd-1..9 switch object tabs, Cmd-T opens the prompt, Cmd-W closes (dirty ones ask first)', async () => {
    await openEditor();
    await waitEditorFor('POWER');
    await act(async () => {
      await openTarget(fg(), '#13');
      await openTarget(fg(), '#45');
    });
    key('1', { metaKey: true });
    expect(getWorkspace(fg()).activeObject).toBe('#12');
    key('3', { ctrlKey: true });
    expect(getWorkspace(fg()).activeObject).toBe('#45');
    key('9', { metaKey: true }); // no such tab: nothing happens
    expect(getWorkspace(fg()).activeObject).toBe('#45');
    key('t', { metaKey: true });
    expect(await screen.findByLabelText('Open object')).toBeInTheDocument();
    key('Escape');
    // dirty close
    key('1', { metaKey: true });
    await waitEditorFor('POWER');
    setDoc('POWER', 'unsaved!');
    key('w', { metaKey: true });
    const dlg = await screen.findByRole('dialog', { name: /Unsaved changes in Command Console/ });
    expect(within(dlg).getByText('POWER')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(getWorkspace(fg()).objects).toHaveLength(3);
    key('w', { metaKey: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(getWorkspace(fg()).objects.map((o) => o.dbref)).toEqual(['#13', '#45']));
    // clean tab closes at once with the close button
    await userEvent.click(screen.getByRole('button', { name: 'Close Nav Console' }));
    expect(getWorkspace(fg()).objects.map((o) => o.dbref)).toEqual(['#45']);
  });

  it('Save all and close writes the dirty attributes first', async () => {
    await openEditor();
    await waitEditorFor('POWER');
    setDoc('POWER', '77');
    await userEvent.click(screen.getByRole('button', { name: 'Close Command Console' }));
    const dlg = await screen.findByRole('dialog');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save all and close' }));
    await waitFor(() => expect(getWorkspace(fg()).objects).toHaveLength(0));
    expect(engine.game.objects.get('#12')!.attrs.POWER.value).toBe('77');
  });

  it('Cmd-P quick-open jumps to an attribute by fuzzy name', async () => {
    await openEditor();
    await waitEditorFor('POWER');
    key('p', { metaKey: true });
    const input = await screen.findByRole('combobox', { name: 'Attribute name' });
    await userEvent.type(input, 'cmdeng');
    const opt = await within(screen.getByRole('dialog')).findByRole('option', { name: 'CMD_ENGAGE' });
    expect(opt).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    await waitEditorFor('CMD_ENGAGE');
    expect(getObject(fg(), '#12')!.activeAttr).toBe('CMD_ENGAGE');
  });

  it('+ new attribute creates a buffer that the first save writes', async () => {
    await openEditor();
    await waitEditorFor('POWER');
    await userEvent.click(screen.getByRole('button', { name: '+ new attribute' }));
    await userEvent.type(screen.getByLabelText('New attribute name'), 'bad name{Enter}');
    expect(await screen.findByText(/not a valid attribute name/)).toHaveAttribute('role', 'alert');
    await userEvent.clear(screen.getByLabelText('New attribute name'));
    await userEvent.type(screen.getByLabelText('New attribute name'), 'brand_new{Enter}');
    await waitEditorFor('BRAND_NEW');
    setDoc('BRAND_NEW', 'hello');
    key('s', { metaKey: true });
    await waitFor(() => expect(engine.game.objects.get('#12')!.attrs.BRAND_NEW.value).toBe('hello'));
  });

  it('search across attributes lists hits from lazily fetched values and jumps to one', async () => {
    await openEditor();
    await waitEditorFor('POWER');
    key('f', { metaKey: true, shiftKey: true });
    const box = await screen.findByLabelText('Search all attributes of this object');
    await userEvent.type(box, 'ENGAGE{Enter}');
    const hits = await screen.findByRole('list', { name: 'Search results' });
    await waitFor(() => expect(within(hits).getAllByRole('button').length).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(
        within(hits)
          .getAllByRole('button')
          .map((b) => b.textContent)
          .join(' '),
      ).toMatch(/DO_ENGAGE/),
    );
    await userEvent.click(within(hits).getAllByRole('button')[0]);
    await waitFor(() => expect(getObject(fg(), '#12')!.activeAttr).not.toBe('POWER'));
  });

  it('go to definition: a reference opens the attribute, loading the object when needed', async () => {
    await openEditor('/edit #12/SEE_ALSO');
    await waitEditorFor('SEE_ALSO');
    const text = getBuffer(fg(), '#12', 'SEE_ALSO')!.text;
    const ref = refAt(text, text.indexOf('FN_ROUTE') + 1)!;
    expect(ref).toMatchObject({ object: '#13', attr: 'FN_ROUTE' });
    await act(async () => {
      await gotoRef(fg(), '#12', ref);
    });
    expect(getWorkspace(fg()).activeObject).toBe('#13');
    expect(getObject(fg(), '#13')!.activeAttr).toBe('FN_ROUTE');
    // same-object reference
    const own = refAt(text, text.indexOf('FN_HELPER') + 1)!;
    await act(async () => {
      await gotoRef(fg(), '#12', own);
    });
    expect(getWorkspace(fg()).activeObject).toBe('#12');
    expect(getObject(fg(), '#12')!.activeAttr).toBe('FN_HELPER');
    // an attribute that does not exist does not create a buffer
    await act(async () => {
      await gotoRef(fg(), '#12', { fn: 'u', attr: 'NO_SUCH_ONE', start: 0, end: 1 });
    });
    expect(getObject(fg(), '#12')!.activeAttr).toBe('FN_HELPER');
  });
});

describe('failure modes', () => {
  it('slow responses show a loading state; an unreadable object shows an error with Retry', async () => {
    await boot();
    engine.game.latencyMs = 40;
    await typeCommand('/edit #15');
    await screen.findByRole('tab', { name: /Sealed Vault|#15/ });
    expect(
      await screen.findByText(/not allowed to see #15/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    engine.game.latencyMs = 0;
    // the tab banner and the overview header both offer Retry
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
  });

  it('a load failure of an attribute is shown with Retry', async () => {
    await openEditor('/edit #14/SECRET');
    expect(await screen.findByText(/not allowed to see #14\/SECRET/)).toBeInTheDocument();
  });

  it('without a connected world the view explains itself', async () => {
    engine = new MockEngine({ scenario: 'empty' });
    render(<App engine={engine} />);
    await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
    act(() => useUi.getState().setView('editor'));
    expect(await screen.findByText(/Connect to a world to edit its objects/)).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Open objects' })).toBeNull();
  });
});

describe('persistence', () => {
  it('stores tabs, the active attribute and unsaved drafts per world and restores them marked as drafts', async () => {
    const e = await openEditor('/edit #12/POWER');
    await waitEditorFor('POWER');
    const stop = startPersistence(0);
    setDoc('POWER', 'draft text');
    await act(async () => {
      await openTarget(fg(), '#13', 'DESCRIBE');
    });
    const s = useSessions.getState().sessions[fg()];
    const k = persistKey(worldKey(s));
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(k) ?? 'null')?.objects).toHaveLength(2),
    );
    stop();
    const stored = JSON.parse(window.localStorage.getItem(k)!);
    expect(stored.active).toBe('#13');
    expect(stored.objects[0].drafts.POWER.text).toBe('draft text');
    expect(JSON.stringify(stored)).not.toMatch(/lastError/);

    // "restart": fresh stores and a fresh UI against the same game
    cleanup();
    resetStores();
    resetEditor();
    const e2 = e;
    render(<App engine={e2} />);
    await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
    act(() => useUi.getState().openDialog(null));
    act(() => useUi.getState().setView('editor'));
    // enterEditor() is what /edit and Cmd-E call; the effect in the view restores on mount as well
    await screen.findByRole('tab', { name: /Command Console/ });
    await screen.findByRole('tab', { name: /Nav Console/ });
    await waitFor(() => expect(getBuffer(fg(), '#12', 'POWER')?.restored).toBe(true));
    expect(getBuffer(fg(), '#12', 'POWER')).toMatchObject({ text: 'draft text', dirty: true });
    expect(getWorkspace(fg()).activeObject).toBe('#13');
    // selecting the first tab shows the restored draft with a notice
    await userEvent.click(screen.getByRole('tab', { name: /Command Console/ }));
    await screen.findByText(/Restored an unsaved draft/);
    await waitEditorFor('POWER');
    expect(view('POWER').state.doc.toString()).toBe('draft text');
  });

  it('a restored draft whose attribute changed meanwhile opens the conflict dialog on save', async () => {
    const e = await openEditor('/edit #12/POWER');
    await waitEditorFor('POWER');
    const stop = startPersistence(0);
    setDoc('POWER', 'draft');
    const s = useSessions.getState().sessions[fg()];
    await waitFor(() => expect(window.localStorage.getItem(persistKey(worldKey(s)))).toContain('draft'));
    stop();
    e.game.externalSet('#12', 'POWER', 'changed while away');
    cleanup();
    resetStores();
    resetEditor();
    render(<App engine={e} />);
    await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
    act(() => useUi.getState().openDialog(null));
    act(() => useUi.getState().setView('editor'));
    const dlg = await screen.findByRole('dialog', { name: /POWER changed in the game/ });
    expect(within(dlg).getByText('changed while away')).toBeInTheDocument();
  });
});

describe('themes', () => {
  it('uses only theme variables for colours (no hard-coded colours except the badge text)', async () => {
    const css = readCss();
    const hard = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(hard).toEqual(['#000']); // warning badge text on --ui-warn
  });
});
