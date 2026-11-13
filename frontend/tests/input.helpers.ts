import { act } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { waitFor } from '@testing-library/react';
import { pressKey } from './codeeditor.helpers';

export const content = (): HTMLElement => document.querySelector('.cm-content') as HTMLElement;
export const view = (): EditorView => {
  const v = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement);
  if (!v) throw new Error('no CodeMirror view');
  return v;
};
export const doc = (): string => view().state.doc.toString();
export const waitEditor = (): Promise<void> =>
  waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull());

/** Insert text at the selection like typing would (also replaces a selection). */
export function typeText(text: string): void {
  act(() => {
    const v = view();
    const s = v.state.selection.main;
    v.dispatch({
      changes: { from: s.from, to: s.to, insert: text },
      selection: { anchor: s.from + text.length },
      userEvent: 'input.type',
    });
  });
}
export function setSel(anchor: number, head = anchor): void {
  act(() => view().dispatch({ selection: { anchor, head } }));
}
export function setDoc(text: string): void {
  act(() => view().dispatch({ changes: { from: 0, to: view().state.doc.length, insert: text } }));
}
/** Dispatch a keydown on the editor's content element (CodeMirror keymaps listen there). */
export function press(
  key: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
  code = '',
): void {
  act(() => pressKey(content(), key, mods, code));
}
