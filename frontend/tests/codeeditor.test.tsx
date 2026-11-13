import { createRef, useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { CodeEditor } from '../src/components/codeeditor/CodeEditor';
import { LazyCodeEditor } from '../src/components/codeeditor';
import type { CodeEditorHandle, CodeEditorProps } from '../src/components/codeeditor';
import { installDomShims, pressKey } from './codeeditor.helpers';

beforeAll(installDomShims);

const content = (): HTMLElement => document.querySelector('.cm-content') as HTMLElement;

function setup(props: Partial<CodeEditorProps> = {}) {
  const ref = createRef<CodeEditorHandle>();
  const onChange = vi.fn();
  const utils = render(<CodeEditor ref={ref} value="" onChange={onChange} {...props} />);
  return { ref, onChange, ...utils };
}

describe('CodeEditor', () => {
  it('renders the initial value with an accessible name', () => {
    const { ref } = setup({ value: 'add(1,2)', ariaLabel: 'Attribute value' });
    expect(ref.current?.getValue()).toBe('add(1,2)');
    expect(content()).toHaveAttribute('aria-label', 'Attribute value');
    expect(content()).toHaveAttribute('role', 'textbox');
    expect(content()).toHaveAttribute('aria-multiline', 'true');
    expect(content().textContent).toBe('add(1,2)');
  });

  it('highlights tokens with the mc-* classes', () => {
    setup({ value: '&A me=$go *:@pemit %#=[add(1,#12)] [nosuchfn(1)]' });
    for (const cls of [
      'mc-attrdef',
      'mc-pattern',
      'mc-command',
      'mc-substitution',
      'mc-bracket',
      'mc-function',
      'mc-number',
      'mc-dbref',
      'mc-function-unknown',
    ]) {
      expect(content().querySelector(`.${cls}`), cls).not.toBeNull();
    }
    expect(content().querySelector('.mc-function')?.textContent).toBe('add');
    expect(content().querySelector('.mc-function-unknown')?.textContent).toBe('nosuchfn');
  });

  it('calls onChange for edits made through the handle', () => {
    const { ref, onChange } = setup({ value: 'a' });
    act(() => ref.current?.insertAtCursor('bc'));
    expect(onChange).toHaveBeenLastCalledWith('bca'); // the cursor starts at 0
    act(() => ref.current?.setValue('xyz'));
    expect(onChange).toHaveBeenLastCalledWith('xyz');
    expect(ref.current?.getValue()).toBe('xyz');
  });

  it('follows the controlled value without echoing onChange', () => {
    const onChange = vi.fn();
    const { rerender } = render(<CodeEditor value="one" onChange={onChange} />);
    rerender(<CodeEditor value="two" onChange={onChange} />);
    expect(content().textContent).toBe('two');
    expect(onChange).toHaveBeenCalledTimes(1); // the programmatic update reports the new doc once, nothing loops
  });

  it('works as a controlled component', () => {
    const ref = createRef<CodeEditorHandle>();
    let setExternal: (v: string) => void = () => {};
    let seen = '';
    function Host() {
      const [v, setV] = useState('start');
      setExternal = setV;
      seen = v;
      return <CodeEditor ref={ref} value={v} onChange={setV} />;
    }
    render(<Host />);
    act(() => ref.current?.insertAtCursor('>'));
    expect(seen).toBe('>start');
    act(() => setExternal('reset'));
    expect(content().textContent).toBe('reset');
    expect(ref.current?.getValue()).toBe('reset');
  });

  it('readOnly blocks edits through the keyboard path but not programmatic reads', () => {
    const { ref, rerender } = setup({ value: 'x', readOnly: true });
    expect(content().getAttribute('contenteditable')).toBe('true');
    expect(document.querySelector('.cm-editor')).not.toBeNull();
    pressKey(content(), 'Tab', {}, 'Tab');
    expect(ref.current?.getValue()).toBe('x');
    rerender(<CodeEditor ref={ref} value="x" readOnly={false} />);
    act(() => ref.current?.insertAtCursor('y'));
    expect(ref.current?.getValue()).toBe('yx');
  });

  it('toggles line numbers and soft wrap', () => {
    const { rerender } = setup({ value: 'a\nb' });
    expect(document.querySelector('.cm-lineNumbers')).not.toBeNull();
    expect(document.querySelector('.cm-lineWrapping')).toBeNull();
    rerender(<CodeEditor value="a\nb" lineNumbers={false} wrap />);
    expect(document.querySelector('.cm-lineNumbers')).toBeNull();
    expect(document.querySelector('.cm-lineWrapping')).not.toBeNull();
    rerender(<CodeEditor value="a\nb" lineNumbers wrap={false} />);
    expect(document.querySelector('.cm-lineNumbers')).not.toBeNull();
    expect(document.querySelector('.cm-lineWrapping')).toBeNull();
  });

  it('reports balance issues: add(1,2 is flagged, add(1,2) is not', async () => {
    const onIssues = vi.fn();
    const { ref, rerender } = setup({ value: 'add(1,2', onIssues });
    expect(ref.current?.getIssues()).toHaveLength(1);
    expect(ref.current?.getIssues()[0]).toMatchObject({ kind: 'unclosed', expected: ')' });
    expect(onIssues).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ kind: 'unclosed' })]),
    );
    await waitFor(() => expect(document.querySelector('.cm-lintRange-error')).not.toBeNull());
    expect(document.querySelector('.cm-lint-marker-error')).not.toBeNull();
    rerender(<CodeEditor ref={ref} value="add(1,2)" onIssues={onIssues} />);
    expect(ref.current?.getIssues()).toHaveLength(0);
    expect(onIssues).toHaveBeenLastCalledWith([]);
    await waitFor(() => expect(document.querySelector('.cm-lintRange-error')).toBeNull());
  });

  it('lenient mode tolerates smileys', () => {
    const { ref } = setup({ value: 'say hi :)', balanceMode: 'lenient' });
    expect(ref.current?.getIssues()).toHaveLength(0);
  });

  it('Ctrl+Alt+] expands and Ctrl+Alt+[ collapses (whole document without a selection)', () => {
    const long =
      'think add(aaaaaaaaaaaaaaaaaaaa,mul(bbbbbbbbbbbbbbbbbbbb,cccccccccccccccccccc),dddddddddddd)';
    const { ref } = setup({ value: long });
    pressKey(content(), ']', { ctrl: true, alt: true }, 'BracketRight');
    const expanded = ref.current?.getValue() ?? '';
    expect(expanded).toContain('\n');
    expect(expanded.split('\n')[0]).toBe('think add(');
    pressKey(content(), '[', { ctrl: true, alt: true }, 'BracketLeft');
    expect(ref.current?.getValue()).toBe(long);
  });

  it('exported helpers and handle apply to the whole document', () => {
    const long =
      'think add(aaaaaaaaaaaaaaaaaaaa,mul(bbbbbbbbbbbbbbbbbbbb,cccccccccccccccccccc),dddddddddddd)';
    const { ref } = setup({ value: long });
    act(() => ref.current?.expand());
    expect(ref.current?.getValue().split('\n').length).toBeGreaterThan(3);
    act(() => ref.current?.collapse());
    expect(ref.current?.getValue()).toBe(long);
  });

  it('cursor readout and selection API', () => {
    const onCursor = vi.fn();
    const { ref } = setup({ value: 'ab\ncd', onCursor });
    expect(ref.current?.getCursor()).toEqual({ line: 1, col: 1, offset: 0, selected: 0, lines: 2 });
    act(() => ref.current?.insertAtCursor('Z'));
    expect(ref.current?.getCursor()).toMatchObject({ line: 1, col: 2, offset: 1 });
    expect(onCursor).toHaveBeenCalled();
    expect(ref.current?.getSelection()).toBe('');
  });

  it('Mod-Enter / Mod-Shift-Enter send the document / the current logical line', () => {
    const onSend = vi.fn();
    const onSendLine = vi.fn();
    setup({ value: '@set a=1\n@set b=add(\n  1,\n  2)', onSend, onSendLine });
    pressKey(content(), 'Enter', { ctrl: true }, 'Enter');
    expect(onSend).toHaveBeenCalledWith('@set a=1\n@set b=add(\n  1,\n  2)');
    pressKey(content(), 'Enter', { ctrl: true, shift: true }, 'Enter');
    expect(onSendLine).toHaveBeenCalledWith('@set a=1');
  });

  it('Tab indents by two spaces; Escape then Tab is left to the browser (no focus trap)', () => {
    const { ref } = setup({ value: 'x' });
    pressKey(content(), 'Tab', {}, 'Tab');
    expect(ref.current?.getValue()).toBe('  x');
    pressKey(content(), 'Tab', { shift: true }, 'Tab');
    expect(ref.current?.getValue()).toBe('x');
    pressKey(content(), 'Escape', {}, 'Escape');
    const ev = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true });
    content().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(ref.current?.getValue()).toBe('x');
  });

  it('Ctrl+F opens the search panel inside the editor', () => {
    setup({ value: 'find me' });
    pressKey(content(), 'f', { ctrl: true }, 'KeyF');
    expect(document.querySelector('.cm-search')).not.toBeNull();
  });

  it('applies the height prop', () => {
    setup({ height: 200 });
    expect(screen.getByTestId('codeeditor')).toHaveStyle({ height: '200px' });
  });
});

describe('LazyCodeEditor', () => {
  it('shows a status placeholder, then loads the editor and forwards the ref', async () => {
    const ref = createRef<CodeEditorHandle>();
    render(<LazyCodeEditor ref={ref} value="[add(1,2)]" ariaLabel="Lazy editor" height={120} />);
    await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull());
    expect(ref.current?.getValue()).toBe('[add(1,2)]');
    expect(screen.queryByText('Loading editor...')).toBeNull();
  });
});
