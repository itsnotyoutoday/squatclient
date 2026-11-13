import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { matchBracketAt, styledRanges, tokenize } from '../../lib/mushcode';

/** Above this many characters syntax highlighting is skipped (keeps typing responsive). */
export const HIGHLIGHT_LIMIT = 300_000;

const markCache = new Map<string, Decoration>();
const mark = (className: string): Decoration => {
  let d = markCache.get(className);
  if (!d) {
    d = Decoration.mark({ class: className });
    markCache.set(className, d);
  }
  return d;
};

/** Token-driven syntax highlighting (classes defined in styles/codeeditor.css). */
export const mushHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

function build(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const b = new RangeSetBuilder<Decoration>();
  if (doc.length > HIGHLIGHT_LIMIT) return b.finish();
  for (const r of styledRanges(tokenize(doc.toString()))) b.add(r.from, r.to, mark(r.className));
  return b.finish();
}

const matchMark = Decoration.mark({ class: 'mc-bracket-match' });

/** Highlights the bracket pair at the cursor. */
export const mushBracketMatch = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = compute(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.selectionSet) this.decorations = compute(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

function compute(view: EditorView): DecorationSet {
  const { doc, selection } = view.state;
  if (doc.length > HIGHLIGHT_LIMIT || !selection.main.empty) return Decoration.none;
  const m = matchBracketAt(doc.toString(), selection.main.head);
  if (!m) return Decoration.none;
  return Decoration.set([matchMark.range(m.open, m.open + 1), matchMark.range(m.close, m.close + 1)]);
}
