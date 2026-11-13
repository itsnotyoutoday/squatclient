import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  isReadOnlyObject,
  newAttribute,
  selectAttr,
  showDetails,
  useEditorUi,
} from '../../state/editorStore';
import { openAttrMenu } from '../../state/detailsStore';
import type { AttrEntry, OpenObject } from '../../state/editorStore';

export const ROW_H = 28;
const OVERSCAN = 6;

function LockIcon() {
  return (
    <svg className="ew-lock" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M4 7V5a4 4 0 1 1 8 0v2h1v7H3V7h1zm2 0h4V5a2 2 0 1 0-4 0v2z" fill="currentColor" />
    </svg>
  );
}

/** Left pane: filterable, virtualised listbox of the object's attributes. */
export function AttrList({ sid, obj }: { sid: string; obj: OpenObject }) {
  const [filter, setFilter] = useState('');
  const [cursor, setCursor] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLButtonElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  const items = useMemo<AttrEntry[]>(() => {
    const q = filter.trim().toLowerCase();
    return q ? obj.attrs.filter((a) => a.name.toLowerCase().includes(q)) : obj.attrs;
  }, [obj.attrs, filter]);

  // keep the cursor on the active attribute when it changes elsewhere
  const revealRef = useRef<(i: number) => void>(() => undefined);
  useEffect(() => {
    const i = items.findIndex((a) => a.name === obj.activeAttr);
    if (i >= 0) {
      setCursor(i);
      revealRef.current(i);
    }
  }, [obj.activeAttr, items]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = (): void => setHeight(el.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // jsdom (and the first paint) has no layout: assume a generous viewport so rows still render
  const viewport = height > 0 ? height : 480;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN);

  const reveal = (i: number): void => {
    const el = scroller.current;
    if (!el) return;
    const top = i * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + viewport) el.scrollTop = top + ROW_H - viewport;
    setScrollTop(el.scrollTop);
  };

  revealRef.current = reveal;

  const move = (i: number): void => {
    const n = Math.max(0, Math.min(items.length - 1, i));
    setCursor(n);
    reveal(n);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowDown') move(cursor + 1);
    else if (e.key === 'ArrowUp') {
      if (cursor === 0) pin.current?.focus();
      else move(cursor - 1);
    } else if (
      e.key === 'ContextMenu' ||
      (e.shiftKey && e.key === 'F10') ||
      (e.key === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey)
    ) {
      const a = items[cursor];
      if (a) {
        const r = document.getElementById(optId(a.name))?.getBoundingClientRect();
        openAttrMenu(sid, obj.dbref, a.name, (r?.left ?? 40) + 24, (r?.bottom ?? 120) - 4);
      }
    } else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if (e.key === 'PageDown') move(cursor + Math.max(1, Math.floor(viewport / ROW_H) - 1));
    else if (e.key === 'PageUp') move(cursor - Math.max(1, Math.floor(viewport / ROW_H) - 1));
    else if (e.key === 'Enter' || e.key === ' ') {
      const a = items[cursor];
      if (a)
        void selectAttr(sid, obj.dbref, a.name).then(() =>
          useEditorUi.getState().set({ focusTick: Date.now() }),
        );
    } else return;
    e.preventDefault();
  };

  const optId = (name: string): string => `ew-opt-${obj.dbref.slice(1)}-${name}`;
  const current = items[cursor];
  const readOnlyObj = isReadOnlyObject(obj);

  return (
    <div className="ew-attrs">
      <button
        type="button"
        ref={pin}
        className={`ew-pin${obj.details ? ' ew-active' : ''}`}
        aria-current={obj.details ? 'true' : undefined}
        title="Name, flags, powers, locks, location and more (Cmd/Ctrl-Shift-D)"
        onClick={() => showDetails(sid, obj.dbref)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            scroller.current?.focus();
          }
        }}
      >
        <span className="ew-pinicon" aria-hidden="true">
          &#9432;
        </span>
        Object details
      </button>
      <div className="ew-attrhead">
        <label className="ew-filterlabel">
          <span className="ew-sr">Filter attributes</span>
          <input
            type="search"
            className="ew-filter"
            placeholder="Filter attributes"
            value={filter}
            spellCheck={false}
            onChange={(e) => {
              setFilter(e.target.value);
              setScrollTop(0);
              if (scroller.current) scroller.current.scrollTop = 0;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filter) {
                e.preventDefault();
                e.stopPropagation();
                setFilter('');
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                scroller.current?.focus();
              }
            }}
          />
        </label>
        <span className="ew-count" aria-live="polite">
          {filter ? `${items.length} of ${obj.attrs.length}` : `${obj.attrs.length}`}
        </span>
      </div>
      <div
        ref={scroller}
        className="ew-attrscroll"
        role="listbox"
        tabIndex={0}
        aria-label={`Attributes of ${obj.name ?? obj.dbref}`}
        aria-activedescendant={current ? optId(current.name) : undefined}
        onKeyDown={onKey}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="ew-attrspace" style={{ height: items.length * ROW_H }}>
          {items.slice(first, last).map((a, k) => {
            const i = first + k;
            const b = obj.buffers[a.name];
            const active = a.name === obj.activeAttr;
            const ro = readOnlyObj || a.writable === false;
            const state = b?.saving
              ? 'saving'
              : b?.lastError
                ? 'error'
                : b?.dirty
                  ? 'modified'
                  : a.isNew
                    ? 'new'
                    : '';
            return (
              <div
                key={a.name}
                id={optId(a.name)}
                role="option"
                aria-selected={active}
                aria-posinset={i + 1}
                aria-setsize={items.length}
                className={`ew-attr${active ? ' ew-active' : ''}${i === cursor ? ' ew-cursor' : ''}${state ? ` ew-s-${state}` : ''}`}
                style={{ top: i * ROW_H, height: ROW_H }}
                title={a.flags ? `${a.name} (${a.flags})` : a.name}
                onMouseDown={(e) => e.preventDefault()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCursor(i);
                  openAttrMenu(sid, obj.dbref, a.name, e.clientX, e.clientY);
                }}
                onClick={() => {
                  setCursor(i);
                  scroller.current?.focus();
                  void selectAttr(sid, obj.dbref, a.name).then(() =>
                    useEditorUi.getState().set({ focusTick: Date.now() }),
                  );
                }}
              >
                <span className="ew-marker" aria-hidden="true">
                  {state === 'saving' ? (
                    <span className="ew-spin" />
                  ) : state === 'error' ? (
                    '!'
                  ) : state === 'modified' ? (
                    '●'
                  ) : state === 'new' ? (
                    '+'
                  ) : null}
                </span>
                <span className="ew-attrname">{a.name}</span>
                {a.flags && (
                  <span className="ew-aflags" aria-hidden="true">
                    {a.flags
                      .split(/\s+/)
                      .filter(Boolean)
                      .map((f) => (
                        <span key={f} className="ew-aflag" title={f}>
                          {f}
                        </span>
                      ))}
                  </span>
                )}
                {ro && (
                  <span className="ew-lockwrap" role="img" aria-label="read-only">
                    <LockIcon />
                  </span>
                )}
                <span className="ew-sr">
                  {[state && `(${state})`, ro && '(read-only)', a.flags && `(flags: ${a.flags})`]
                    .filter(Boolean)
                    .join(' ')}
                </span>
              </div>
            );
          })}
        </div>
        {items.length === 0 && (
          <p className="ew-empty">
            {obj.loading ? 'Loading...' : filter ? 'No attribute matches.' : 'No attributes.'}
          </p>
        )}
      </div>
      <div className="ew-attrfoot">
        {adding ? (
          <form
            className="ew-newform"
            onSubmit={(e) => {
              e.preventDefault();
              const name = (e.currentTarget.elements.namedItem('ew-newname') as HTMLInputElement).value;
              const r = newAttribute(sid, obj.dbref, name);
              if (r.ok) {
                setAdding(false);
                setAddErr('');
                useEditorUi.getState().set({ focusTick: Date.now() });
              } else setAddErr(r.error);
            }}
          >
            <input
              name="ew-newname"
              aria-label="New attribute name"
              placeholder="ATTRIBUTE_NAME"
              autoFocus
              spellCheck={false}
              onChange={() => setAddErr('')}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setAdding(false);
                  setAddErr('');
                }
              }}
            />
            <button type="submit">Add</button>
            {addErr && (
              <span role="alert" className="ew-promptfail">
                {addErr}
              </span>
            )}
          </form>
        ) : (
          <button
            type="button"
            className="ew-newbtn"
            disabled={readOnlyObj}
            title={readOnlyObj ? 'You do not control this object' : 'Create a new attribute'}
            onClick={() => setAdding(true)}
          >
            + new attribute
          </button>
        )}
      </div>
    </div>
  );
}
