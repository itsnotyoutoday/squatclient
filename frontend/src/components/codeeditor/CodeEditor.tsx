import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers as cmLineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { indentUnit } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { linter, lintGutter } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import { checkBalance } from '../../lib/mushcode';
import type { BalanceIssue } from '../../lib/mushcode';
import { currentChunk } from '../../lib/softcode';
import '../../styles/codeeditor.css';
import { collapseCommand, collapseSelection, expandCommand, expandSelection } from './commands';
import { mushBracketMatch, mushHighlight } from './extensions';
import type { CodeEditorHandle, CodeEditorProps, CursorInfo } from './types';

export { collapseSelection, expandSelection };
export type { CodeEditorHandle, CodeEditorProps, CursorInfo };

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const cursorOf = (state: EditorState): CursorInfo => {
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  return {
    line: line.number,
    col: sel.head - line.from + 1,
    offset: sel.head,
    selected: sel.to - sel.from,
    lines: state.doc.lines,
  };
};

const toDiagnostics = (issues: BalanceIssue[], docLen: number): Diagnostic[] =>
  issues.map((i) => ({
    from: Math.min(i.index, docLen),
    to: Math.min(i.index + 1, docLen),
    severity: 'error',
    message: i.message,
    source: 'brackets',
  }));

const contentAttrs = (label: string): Extension =>
  EditorView.contentAttributes.of({
    'aria-label': label,
    'aria-multiline': 'true',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocorrect: 'off',
  });

/**
 * MUSH softcode editor on CodeMirror 6. Import it through `LazyCodeEditor` so CodeMirror stays out of
 * the main bundle until the first editor is shown.
 */
export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(props, ref) {
  const {
    value,
    readOnly = false,
    wrap = false,
    lineNumbers = true,
    height,
    ariaLabel = 'Softcode editor',
    balanceMode = 'code',
    className,
  } = props;

  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cb = useRef(props);
  cb.current = props;
  const issues = useRef<BalanceIssue[]>([]);
  const ext = useRef({
    readOnly: new Compartment(),
    wrap: new Compartment(),
    numbers: new Compartment(),
    aria: new Compartment(),
    lint: new Compartment(),
  });

  const lintExt = useCallback(
    (mode: 'code' | 'lenient'): Extension =>
      linter((v) => toDiagnostics(checkBalance(v.state.doc.toString(), { mode }), v.state.doc.length), {
        delay: 150,
      }),
    [],
  );

  // create once; every later prop change goes through a compartment or a transaction
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const c = ext.current;
    // Escape then Tab leaves the editor (Tab is otherwise indentation, which would trap keyboard focus)
    let escaped = false;
    const refreshIssues = (state: EditorState): void => {
      issues.current = checkBalance(state.doc.toString(), { mode: cb.current.balanceMode ?? 'code' });
      cb.current.onIssues?.(issues.current);
    };
    const send =
      (line: boolean) =>
      (view: EditorView): boolean => {
        const handler = line ? cb.current.onSendLine : cb.current.onSend;
        if (!handler) return false;
        const s = view.state.selection.main;
        const text = view.state.doc.toString();
        handler(line ? currentChunk(text, s.from, s.to, true) : s.empty ? text : text.slice(s.from, s.to));
        return true;
      };

    const state = EditorState.create({
      doc: cb.current.value,
      extensions: [
        EditorView.domEventHandlers({
          keydown(e) {
            if (e.key === 'Escape') escaped = true;
            else if (e.key !== 'Tab' && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) escaped = false;
            return false;
          },
          blur() {
            escaped = false;
            return false;
          },
        }),
        keymap.of([
          { key: 'Mod-Alt-]', run: expandCommand, preventDefault: true },
          { key: 'Mod-Alt-[', run: collapseCommand, preventDefault: true },
          { key: 'Mod-Enter', run: send(false) },
          { key: 'Mod-Shift-Enter', run: send(true) },
          {
            key: 'Tab',
            run: (v) => !escaped && !v.state.readOnly && indentMore(v),
            shift: (v) => !escaped && !v.state.readOnly && indentLess(v),
          },
          ...closeBracketsKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        history(),
        drawSelection({ cursorBlinkRate: prefersReducedMotion() ? 0 : 1200 }),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        search({ top: true }),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        // only real brackets are auto-closed: no quotes (apostrophes are everywhere in MUSH text)
        closeBrackets(),
        EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{'] } }]),
        mushHighlight,
        mushBracketMatch,
        lintGutter(),
        c.lint.of(lintExt(cb.current.balanceMode ?? 'code')),
        c.readOnly.of(EditorState.readOnly.of(!!cb.current.readOnly)),
        c.wrap.of(cb.current.wrap ? EditorView.lineWrapping : []),
        c.numbers.of(cb.current.lineNumbers === false ? [] : cmLineNumbers()),
        c.aria.of(contentAttrs(cb.current.ariaLabel ?? 'Softcode editor')),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            refreshIssues(u.state);
            cb.current.onChange?.(u.state.doc.toString());
          }
          if (u.docChanged || u.selectionSet) cb.current.onCursor?.(cursorOf(u.state));
        }),
      ],
    });
    const view = new EditorView({ state, parent });
    viewRef.current = view;
    refreshIssues(state);
    cb.current.onCursor?.(cursorOf(state));
    if (cb.current.autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [lintExt]);

  // controlled value
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur !== value) {
      view.dispatch({
        changes: { from: 0, to: cur.length, insert: value },
        selection: { anchor: Math.min(view.state.selection.main.anchor, value.length) },
      });
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: ext.current.readOnly.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: ext.current.wrap.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: ext.current.numbers.reconfigure(lineNumbers ? cmLineNumbers() : []),
    });
  }, [lineNumbers]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: ext.current.aria.reconfigure(contentAttrs(ariaLabel)) });
  }, [ariaLabel]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: ext.current.lint.reconfigure(lintExt(balanceMode)) });
    issues.current = checkBalance(view.state.doc.toString(), { mode: balanceMode });
    cb.current.onIssues?.(issues.current);
  }, [balanceMode, lintExt]);

  useImperativeHandle(
    ref,
    (): CodeEditorHandle => ({
      focus: () => viewRef.current?.focus(),
      getValue: () => viewRef.current?.state.doc.toString() ?? '',
      setValue: (v) => {
        const view = viewRef.current;
        if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
      },
      insertAtCursor: (text) => {
        const view = viewRef.current;
        if (!view) return;
        const s = view.state.selection.main;
        view.dispatch({
          changes: { from: s.from, to: s.to, insert: text },
          selection: { anchor: s.from + text.length },
          scrollIntoView: true,
          userEvent: 'input.paste',
        });
        view.focus();
      },
      getSelection: () => {
        const view = viewRef.current;
        if (!view) return '';
        const s = view.state.selection.main;
        return view.state.sliceDoc(s.from, s.to);
      },
      getCursor: () =>
        viewRef.current
          ? cursorOf(viewRef.current.state)
          : { line: 1, col: 1, offset: 0, selected: 0, lines: 1 },
      getIssues: () => issues.current,
      goTo: (offset) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          selection: { anchor: Math.max(0, Math.min(offset, view.state.doc.length)) },
          scrollIntoView: true,
        });
        view.focus();
      },
      expand: () => {
        if (viewRef.current) expandSelection(viewRef.current);
      },
      collapse: () => {
        if (viewRef.current) collapseSelection(viewRef.current);
      },
    }),
    [],
  );

  const style =
    height === undefined ? undefined : { height: typeof height === 'number' ? `${height}px` : height };
  return (
    <div
      ref={host}
      className={`codeeditor${height === undefined ? ' codeeditor-auto' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      data-testid="codeeditor"
    />
  );
});

export default CodeEditor;
