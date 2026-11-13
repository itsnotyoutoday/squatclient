import type { Command, EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { collapse, expand, joinContinuations } from '../../lib/mushcode';
import type { ExpandOptions } from '../../lib/mushcode';

/**
 * Expand the selection, or the whole document when the selection is empty.
 * Returns false (and changes nothing) when the text is already as expanded as it gets.
 */
export function expandSelection(view: EditorView, opts?: ExpandOptions): boolean {
  return transform(view, (t) => expand(t, opts));
}

/**
 * Collapse the selection (every newline and the whitespace after it is removed). With an empty
 * selection the whole document is processed with the send-side rule instead (continuation lines are
 * joined to the line above), so separate commands on separate lines are never merged by accident.
 */
export function collapseSelection(view: EditorView): boolean {
  const sel = view.state.selection.main;
  return transform(view, sel.empty ? joinContinuations : collapse);
}

function transform(view: EditorView, fn: (text: string) => string): boolean {
  const { state } = view;
  const sel = state.selection.main;
  const from = sel.empty ? 0 : sel.from;
  const to = sel.empty ? state.doc.length : sel.to;
  const before = state.sliceDoc(from, to);
  const after = fn(before);
  if (after === before) return false;
  view.dispatch({
    changes: { from, to, insert: after },
    selection: sel.empty
      ? EditorSelection.cursor(Math.min(sel.head, from + after.length))
      : EditorSelection.range(from, from + after.length),
    userEvent: 'input.format',
    scrollIntoView: true,
  });
  return true;
}

export const expandCommand: Command = (view) => {
  expandSelection(view);
  return true;
};
export const collapseCommand: Command = (view) => {
  collapseSelection(view);
  return true;
};
