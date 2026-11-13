import { afterEach, describe, expect, it, vi } from 'vitest';
import { runUndoRedo } from '../src/lib/editcommands';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function codeEditor(): { content: HTMLElement; keys: KeyboardEvent[] } {
  document.body.innerHTML =
    '<div class="cm-editor"><div class="cm-content" contenteditable="true" tabindex="0"></div></div>';
  const content = document.querySelector('.cm-content') as HTMLElement;
  const keys: KeyboardEvent[] = [];
  content.addEventListener('keydown', (e) => keys.push(e));
  content.focus();
  return { content, keys };
}

describe('runUndoRedo (native Edit menu -> page)', () => {
  it('replays Cmd/Ctrl+Z for the code editor history on undo', () => {
    const { keys } = codeEditor();
    runUndoRedo('undo');
    expect(keys).toHaveLength(1);
    expect(keys[0].key).toBe('z');
    expect(keys[0].shiftKey).toBe(false);
    expect(keys[0].metaKey || keys[0].ctrlKey).toBe(true);
    expect(keys[0].cancelable).toBe(true);
  });

  it('replays Shift+Cmd/Ctrl+Z on redo', () => {
    const { keys } = codeEditor();
    runUndoRedo('redo');
    expect(keys).toHaveLength(1);
    expect(keys[0].key).toBe('z');
    expect(keys[0].shiftKey).toBe(true);
  });

  it('uses the browser undo/redo in ordinary text fields', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    (document.getElementById('t') as HTMLTextAreaElement).focus();
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true, writable: true });
    runUndoRedo('undo');
    runUndoRedo('redo');
    expect(exec.mock.calls).toEqual([['undo'], ['redo']]);
  });

  it('never throws when the browser has no execCommand', () => {
    document.body.innerHTML = '<input id="i" />';
    (document.getElementById('i') as HTMLInputElement).focus();
    Object.defineProperty(document, 'execCommand', {
      value: () => {
        throw new Error('nope');
      },
      configurable: true,
      writable: true,
    });
    expect(() => runUndoRedo('undo')).not.toThrow();
  });
});
