import { useRef } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

export interface ResizeHandleProps {
  /** Current height of the controlled area (px), for assistive technology and keyboard steps. */
  value: number;
  /** The area's real height right now (px): the starting point of a drag. */
  measure(): number;
  min: number;
  max: number;
  lineHeight: number;
  /** `commit` is false while dragging and true when the change is final (persist it). */
  onChange(px: number, commit: boolean): void;
  /** Double-click: back to the default height. */
  onReset(): void;
}

/** Drag handle on the top edge of the command window. Also a keyboard-operable separator. */
export function ResizeHandle({ value, measure, min, max, lineHeight, onChange, onReset }: ResizeHandleProps) {
  const drag = useRef<{ y: number; h: number } | null>(null);
  const clamp = (v: number): number => Math.min(max, Math.max(min, Math.round(v)));

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { y: e.clientY, h: measure() };
    drag.current = start;
    document.body.classList.add('resizing');
    const move = (m: MouseEvent): void => onChange(clamp(start.h + (start.y - m.clientY)), false);
    const up = (m: MouseEvent): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing');
      drag.current = null;
      onChange(clamp(start.h + (start.y - m.clientY)), true);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      e.key === 'ArrowUp'
        ? lineHeight
        : e.key === 'ArrowDown'
          ? -lineHeight
          : e.key === 'PageUp'
            ? lineHeight * 5
            : e.key === 'PageDown'
              ? -lineHeight * 5
              : 0;
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      onChange(e.key === 'Home' ? max : min, true);
      return;
    }
    if (!step) return;
    e.preventDefault();
    onChange(clamp(value + step), true);
  };

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize command window"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      title="Drag to resize; double-click to reset"
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
