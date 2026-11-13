import type { BalanceIssue } from '../../lib/mushcode';

export interface CursorInfo {
  /** 1-based line and column of the cursor (selection head). */
  line: number;
  col: number;
  /** Offset of the cursor from the start of the document. */
  offset: number;
  /** Length of the selection (0 when it is just a cursor). */
  selected: number;
  /** Total number of lines. */
  lines: number;
}

export interface CodeEditorProps {
  value: string;
  onChange?(value: string): void;
  readOnly?: boolean;
  /** Soft-wrap long lines (default false). */
  wrap?: boolean;
  /** Show line numbers (default true). */
  lineNumbers?: boolean;
  /** Mod-Shift-Enter: the line holding the cursor (with its continuation lines), or the selection. */
  onSendLine?(text: string): void;
  /** Mod-Enter: the selection, or the whole document. */
  onSend?(text: string): void;
  autoFocus?: boolean;
  /** CSS height (number = px). Omit to grow with the content (min 6 lines). */
  height?: number | string;
  ariaLabel?: string;
  /** Bracket checking mode for the linter (default 'code'). */
  balanceMode?: 'code' | 'lenient';
  /** Called whenever the set of balance issues may have changed (initially and after edits). */
  onIssues?(issues: BalanceIssue[]): void;
  /** Called when the cursor or selection moves, or the document changes. */
  onCursor?(info: CursorInfo): void;
  className?: string;
}

export interface CodeEditorHandle {
  focus(): void;
  getValue(): string;
  setValue(value: string): void;
  /** Replace the selection with `text` and put the cursor after it. */
  insertAtCursor(text: string): void;
  getSelection(): string;
  getCursor(): CursorInfo;
  getIssues(): BalanceIssue[];
  /** Expand the selection, or the whole document when nothing is selected. */
  expand(): void;
  /** Collapse the selection (every newline removed) or, with no selection, join continuation lines. */
  collapse(): void;
}
