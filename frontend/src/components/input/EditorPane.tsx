import type { KeyboardEvent, RefObject } from 'react';
import { LazyCodeEditor } from '../codeeditor';
import type { CodeEditorHandle, CursorInfo } from '../codeeditor';
import type { BalanceIssue } from '../../lib/mushcode';
import { lineCol } from '../../lib/softcode';
import type { BlockProgress } from '../../lib/blocksender';
import '../../styles/upload.css';

export interface EditorPaneProps {
  editorRef: RefObject<CodeEditorHandle>;
  bodyRef: RefObject<HTMLDivElement>;
  text: string;
  cursor: number;
  height: number;
  wrap: boolean;
  lineNumbers: boolean;
  disabled?: boolean;
  progress: BlockProgress | null;
  /** Bracket problems currently reported by the editor's linter. */
  problems: number;
  onText(value: string): void;
  onCursor(info: CursorInfo): void;
  onIssues(issues: BalanceIssue[]): void;
  onSend(): void;
  onSendChunk(): void;
  onClear(): void;
  onCancel(): void;
  onWrap(v: boolean): void;
  onLineNumbers(v: boolean): void;
  onExit(): void;
  onHistory(): void;
}

const isMac = (): boolean => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
export const modLabel = (): string => (isMac() ? 'Cmd' : 'Ctrl');

/**
 * The large multi-line code editor: toolbar plus the CodeMirror softcode editor (loaded lazily).
 * Enter is a newline, Mod+Enter sends the buffer, Mod+Shift+Enter the selection / logical line,
 * Mod+F searches inside the editor, Escape (when no search panel is open) returns to the single line.
 */
export function EditorPane(p: EditorPaneProps) {
  const { line, col } = lineCol(p.text, p.cursor);
  const mod = modLabel();
  const prog = p.progress;
  const sending = prog !== null;
  const hasText = p.text.trim() !== '';

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // CodeMirror consumes Escape itself to close its search panel (defaultPrevented); otherwise leave editor mode.
    if (e.key === 'Escape' && !e.defaultPrevented && !e.nativeEvent.isComposing) {
      e.preventDefault();
      p.onExit(); // the text stays: nothing is lost by leaving editor mode
    }
  };

  return (
    <>
      <div className="editor-toolbar" role="toolbar" aria-label="Editor tools">
        <button
          type="button"
          className="primary"
          onClick={p.onSend}
          disabled={p.disabled || sending || !hasText}
          title={`Send the whole buffer (${mod}+Enter)`}
        >
          Send
        </button>
        <button
          type="button"
          onClick={p.onSendChunk}
          disabled={p.disabled || sending || !hasText}
          title={`Send the selection, or the current line (${mod}+Shift+Enter)`}
        >
          Send line / selection
        </button>
        <button
          type="button"
          onClick={() => p.editorRef.current?.expand()}
          disabled={p.disabled || !hasText}
          title={`Expand: break long function calls over indented lines, for the selection or everything (${mod}+Alt+])`}
        >
          Expand
        </button>
        <button
          type="button"
          onClick={() => p.editorRef.current?.collapse()}
          disabled={p.disabled || !hasText}
          title={`Collapse: join continuation lines again, for the selection or everything (${mod}+Alt+[)`}
        >
          Collapse
        </button>
        <button type="button" onClick={p.onClear} disabled={!p.text}>
          Clear
        </button>
        <label className="check">
          <input type="checkbox" checked={p.wrap} onChange={(e) => p.onWrap(e.target.checked)} /> Wrap
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={p.lineNumbers}
            onChange={(e) => p.onLineNumbers(e.target.checked)}
          />{' '}
          Line numbers
        </label>
        <span className="grow" />
        {prog ? (
          <span className="sendprog" role="status" aria-label="Sending block">
            <progress value={prog.sent} max={prog.total} aria-label="Block progress" />
            <span>
              Sending {prog.sent}/{prog.total}
            </span>
            <button type="button" onClick={p.onCancel}>
              Cancel
            </button>
          </span>
        ) : (
          <>
            {p.problems > 0 && (
              <span className="cw-problems" role="status" aria-label="Bracket problems">
                {p.problems} bracket {p.problems === 1 ? 'problem' : 'problems'}
              </span>
            )}
            {hasText && (
              <span className="draft" title="Unsent text is kept for this world">
                Draft
              </span>
            )}
            <span className="pos" aria-label="Cursor position">
              Ln {line}, Col {col}
            </span>
          </>
        )}
        <button type="button" onClick={p.onHistory} title="Command history (Ctrl+R)">
          History
        </button>
        <button type="button" onClick={p.onExit} title={`Back to the single line (Escape, ${mod}+Shift+E)`}>
          Single line
        </button>
      </div>
      <div
        ref={p.bodyRef}
        className="editor-body cw-editor-body"
        style={{ height: p.height }}
        onKeyDown={onKeyDown}
      >
        <LazyCodeEditor
          ref={p.editorRef}
          value={p.text}
          onChange={p.onText}
          onCursor={p.onCursor}
          onIssues={p.onIssues}
          wrap={p.wrap}
          lineNumbers={p.lineNumbers}
          readOnly={p.disabled}
          onSend={p.onSend}
          onSendLine={p.onSendChunk}
          autoFocus
          height="100%"
          ariaLabel="Command editor"
        />
      </div>
    </>
  );
}
