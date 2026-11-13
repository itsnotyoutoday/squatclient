import { useMemo, useRef } from 'react';
import type { ClipboardEvent, KeyboardEvent, RefObject, SyntheticEvent } from 'react';
import { lineCol } from '../../lib/softcode';
import type { BlockProgress } from '../../lib/blocksender';

export interface EditorPaneProps {
  textareaRef: RefObject<HTMLTextAreaElement>;
  text: string;
  cursor: number;
  height: number;
  wrap: boolean;
  lineNumbers: boolean;
  disabled?: boolean;
  progress: BlockProgress | null;
  onText(value: string, cursor: number): void;
  onSelect(cursor: number): void;
  onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void;
  onPaste?(e: ClipboardEvent<HTMLTextAreaElement>): void;
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

/** The large multi-line code editor: toolbar, optional line-number gutter, status line. */
export function EditorPane(p: EditorPaneProps) {
  const gutter = useRef<HTMLPreElement>(null);
  const lines = useMemo(() => p.text.split('\n').length, [p.text]);
  const numbers = useMemo(() => Array.from({ length: lines }, (_, i) => i + 1).join('\n'), [lines]);
  const { line, col } = lineCol(p.text, p.cursor);
  const showNumbers = p.lineNumbers && !p.wrap; // wrapped lines would misalign the gutter
  const mod = modLabel();
  const prog = p.progress;
  const sending = prog !== null;
  const hasText = p.text.trim() !== '';

  const sync = (e: SyntheticEvent<HTMLTextAreaElement>): void => {
    if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
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
      <div className="editor-body" style={{ height: p.height }}>
        {showNumbers && (
          <pre
            ref={gutter}
            className="gutter"
            aria-hidden="true"
            style={{ minWidth: `${String(lines).length + 1}ch` }}
          >
            {numbers}
          </pre>
        )}
        <textarea
          ref={p.textareaRef}
          aria-label="Command editor"
          className={p.wrap ? 'wrap' : 'nowrap'}
          value={p.text}
          disabled={p.disabled}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          wrap={p.wrap ? 'soft' : 'off'}
          onChange={(e) => p.onText(e.target.value, e.target.selectionStart)}
          onKeyDown={p.onKeyDown}
          onPaste={p.onPaste}
          onScroll={sync}
          onSelect={(e) => p.onSelect(e.currentTarget.selectionStart)}
        />
      </div>
    </>
  );
}
