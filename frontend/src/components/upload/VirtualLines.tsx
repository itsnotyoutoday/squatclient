import { useState } from 'react';
import type { UIEvent } from 'react';

export const ROW_H = 18;
const VIEW_H = 200;
const OVERSCAN = 6;

export interface VirtualLinesProps {
  lines: readonly string[];
  ariaLabel: string;
  /** Number shown for the first line (default 1). */
  first?: number;
}

/** Fixed-row-height windowed list with line numbers: only the visible rows are in the DOM. */
export function VirtualLines({ lines, ariaLabel, first = 1 }: VirtualLinesProps) {
  const [top, setTop] = useState(0);
  const start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
  const end = Math.min(lines.length, Math.ceil((top + VIEW_H) / ROW_H) + OVERSCAN);
  const width = `${String(first + lines.length).length + 1}ch`;
  const rows = [];
  for (let i = start; i < end; i++) {
    rows.push(
      <div key={i} className="cw-vl-row" style={{ top: i * ROW_H, height: ROW_H }} data-line={first + i}>
        <span className="cw-vl-n" style={{ width }} aria-hidden="true">
          {first + i}
        </span>
        <span className="cw-vl-t">{lines[i] === '' ? ' ' : lines[i]}</span>
      </div>,
    );
  }
  return (
    <div
      className="cw-vl"
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
      style={{ height: VIEW_H }}
      onScroll={(e: UIEvent<HTMLDivElement>) => setTop(e.currentTarget.scrollTop)}
    >
      <div className="cw-vl-space" style={{ height: lines.length * ROW_H }}>
        {rows}
      </div>
    </div>
  );
}
