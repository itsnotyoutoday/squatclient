import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: string;
  onClose(): void;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
  /** Let the user resize the dialog from its bottom-right corner (default: on for wide dialogs). */
  resizable?: boolean;
}

interface Pos {
  x: number;
  y: number;
}
interface Size {
  width: string;
  height: string;
}

/** Where each dialog was last left, kept for the lifetime of the app window (not saved to disk). */
const rememberedPos = new Map<string, Pos>();
const rememberedSize = new Map<string, Size>();
/** Keep at least this much of a dragged dialog inside the window. */
const KEEP_X = 80;
const KEEP_Y = 40;
const NUDGE = 24;

/**
 * Accessible modal: labelled, focus trapped, Escape closes, focus restored on close.
 * Drag it by its title bar (double-click the title bar to put it back); Alt+Shift+Arrow keys move
 * it too. Large dialogs can be resized from the bottom-right corner.
 */
export function Dialog({ title, onClose, children, wide, footer, resizable = wide }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [pos, setPos] = useState<Pos>(() => rememberedPos.get(title) ?? { x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    bl: number;
    bt: number;
    w: number;
  } | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  /** Clamp a translation so the title bar stays reachable. `bl`/`bt` = untranslated left/top. */
  const clampTo = (x: number, y: number, bl: number, bt: number, w: number): Pos => {
    if (w === 0) return { x, y }; // no layout (e.g. tests): nothing to clamp against
    const minX = KEEP_X - (bl + w);
    const maxX = window.innerWidth - bl - KEEP_X;
    const minY = -bt;
    const maxY = window.innerHeight - bt - KEEP_Y;
    return { x: Math.min(maxX, Math.max(minX, x)), y: Math.min(maxY, Math.max(minY, y)) };
  };
  const baseOf = (): { bl: number; bt: number; w: number } => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return { bl: 0, bt: 0, w: 0 };
    return { bl: r.left - posRef.current.x, bt: r.top - posRef.current.y, w: r.width };
  };

  const startDrag = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button,a,input,select,textarea')) return;
    e.preventDefault();
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, ...baseOf() };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent): void => {
      const d = drag.current;
      if (!d) return;
      setPos(clampTo(d.ox + e.clientX - d.sx, d.oy + e.clientY - d.sy, d.bl, d.bt, d.w));
    };
    const up = (): void => {
      drag.current = null;
      setDragging(false);
      rememberedPos.set(title, posRef.current);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [dragging, title]);

  const resetLayout = (): void => {
    rememberedPos.delete(title);
    rememberedSize.delete(title);
    setPos({ x: 0, y: 0 });
    const el = ref.current;
    if (el) {
      el.style.width = '';
      el.style.height = '';
    }
  };

  // Remember (and restore) a user-resized size for this dialog.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !resizable) return;
    const saved = rememberedSize.get(title);
    if (saved) {
      el.style.width = saved.width;
      el.style.height = saved.height;
    }
    return () => {
      if (el.style.width || el.style.height)
        rememberedSize.set(title, { width: el.style.width, height: el.style.height });
    };
  }, [title, resizable]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first =
      el?.querySelector<HTMLElement>('[data-autofocus],input,select,textarea') ??
      el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    return () => prev?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      onClose();
      return;
    }
    if (e.altKey && e.shiftKey && e.key.startsWith('Arrow')) {
      // keyboard alternative to dragging
      e.preventDefault();
      e.stopPropagation();
      const dx = e.key === 'ArrowLeft' ? -NUDGE : e.key === 'ArrowRight' ? NUDGE : 0;
      const dy = e.key === 'ArrowUp' ? -NUDGE : e.key === 'ArrowDown' ? NUDGE : 0;
      const b = baseOf();
      const next = clampTo(pos.x + dx, pos.y + dy, b.bl, b.bt, b.w);
      setPos(next);
      rememberedPos.set(title, next);
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      (x) => !x.hasAttribute('disabled'),
    );
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === firstEl || active === ref.current)) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && active === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`dialog${wide ? ' wide' : ''}${resizable ? ' resizable' : ''}${dragging ? ' dragging' : ''}`}
        style={pos.x || pos.y ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div
          className="dhead"
          title="Drag to move (double-click to reset)"
          onMouseDown={startDrag}
          onDoubleClick={(e) => {
            if (!(e.target as HTMLElement).closest('button,a,input')) resetLayout();
          }}
        >
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="x" aria-label="Close dialog" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="body">{children}</div>
        {footer && <div className="dfoot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="lbl">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
