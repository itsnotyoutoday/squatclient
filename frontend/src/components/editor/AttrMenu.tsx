import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useUi } from '../../state/stores';
import { isReadOnlyObject, selectAttr, useEditor, useEditorUi } from '../../state/editorStore';
import {
  closeAttrMenu,
  loadAttrFlags,
  openAttrAction,
  toggleAttrFlag,
  useDetails,
} from '../../state/detailsStore';
import { ATTR_FLAG_HELP, ATTR_FLAG_NAMES } from '../../lib/editor/props';
import { Busy, FieldError } from './PropWidgets';

function LockGlyph() {
  return (
    <svg className="ew-lock" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M4 7V5a4 4 0 1 1 8 0v2h1v7H3V7h1zm2 0h4V5a2 2 0 1 0-4 0v2z" fill="currentColor" />
    </svg>
  );
}

async function copyText(text: string, what: string): Promise<void> {
  const toast = useUi.getState().toast;
  try {
    await navigator.clipboard.writeText(text);
    toast('info', `Copied ${what}.`);
  } catch {
    toast('error', `Could not copy ${what}: the clipboard is not available.`);
  }
}

/**
 * The attribute context menu: flags with check marks, lock/unlock, change owner, rename, delete, copy name,
 * copy as a command, open. Opened by right-click, Shift+F10, the Menu key, F in the list, or the "..." button.
 * Every action goes through the silent Edit* calls and shows the game's exact reply when refused.
 */
export function AttrMenu() {
  const m = useDetails((s) => s.attrMenu);
  if (!m) return null;
  return <MenuBody key={`${m.sid}|${m.dbref}|${m.attr}`} {...m} />;
}

function MenuBody({
  sid,
  dbref,
  attr,
  x,
  y,
}: {
  sid: string;
  dbref: string;
  attr: string;
  x: number;
  y: number;
}) {
  const engine = useUi((s) => s.engine);
  const obj = useEditor((s) => s.ws[sid]?.objects.find((o) => o.dbref === dbref));
  const entry = obj?.attrs.find((a) => a.name === attr);
  const readOnly = !obj || isReadOnlyObject(obj);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [loading, setLoading] = useState(entry?.flags === undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ text: string } | null>(null);
  const current = (entry?.flags ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((f) => f.toLowerCase());
  const locked = current.includes('locked');
  const extra = current.filter((f) => !(ATTR_FLAG_NAMES as readonly string[]).includes(f));

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus();
    return () => prev?.focus?.();
  }, []);
  useEffect(() => {
    if (entry?.flags !== undefined) return;
    let live = true;
    void loadAttrFlags(sid, dbref, attr).then(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // keep the menu inside the window
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y, loading, extra.length]);
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) closeAttrMenu();
    };
    const key = (): void => closeAttrMenu();
    document.addEventListener('mousedown', down, true);
    window.addEventListener('resize', key);
    return () => {
      document.removeEventListener('mousedown', down, true);
      window.removeEventListener('resize', key);
    };
  }, []);

  const items = (): HTMLElement[] =>
    [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])].filter(
      (e) => !e.hasAttribute('disabled'),
    );
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus();
    else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus();
    else if (e.key === 'Home') list[0]?.focus();
    else if (e.key === 'End') list[list.length - 1]?.focus();
    else if (e.key === 'Escape') {
      e.stopPropagation();
      closeAttrMenu();
    } else if (e.key === 'Tab') closeAttrMenu();
    else return;
    e.preventDefault();
  };

  const toggle = async (flag: string, on: boolean): Promise<void> => {
    setBusy(flag);
    setErr(null);
    const r = await toggleAttrFlag(sid, dbref, attr, flag, on);
    setBusy(null);
    if (!r.ok) setErr({ text: `${flag}: ${r.text}` });
  };
  const lockToggle = async (): Promise<void> => {
    if (!engine) return;
    setBusy('@lock');
    setErr(null);
    const r = await engine.editSetAttrLock(sid, dbref, attr, !locked);
    if (r.ok) await loadAttrFlags(sid, dbref, attr);
    else setErr({ text: r.reply || r.error || 'The game refused.' });
    setBusy(null);
  };
  const copyCommand = async (): Promise<void> => {
    const r = await engine?.editFetchAttr(sid, dbref, attr);
    if (!r || !r.ok) {
      setErr({ text: r?.error ? r.error.replace(/^engine: [^:]*: /, '') : 'Could not read the attribute.' });
      return;
    }
    await copyText(`&${attr} ${dbref}=${r.value}`, `&${attr} ${dbref}=...`);
    closeAttrMenu();
  };
  const why = readOnly ? 'You do not control this object' : undefined;

  return (
    <div
      ref={ref}
      className="ew-menu"
      role="menu"
      aria-label={`Actions for attribute ${attr}`}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKey}
      data-testid="attr-menu"
    >
      <div className="ew-menutitle" aria-hidden="true">
        &amp;{attr} {loading && <Busy label="Loading flags" />}
      </div>
      <div role="group" aria-label="Flags" className="ew-menugroup">
        <div className="ew-menuhead" aria-hidden="true">
          Flags
        </div>
        {[...ATTR_FLAG_NAMES, ...extra].map((f) => {
          const on = current.includes(f);
          return (
            <button
              key={f}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              className="ew-menuitem"
              title={why ?? ATTR_FLAG_HELP[f]}
              disabled={readOnly || loading || busy !== null}
              onClick={() => void toggle(f, !on)}
            >
              <span className="ew-menucheck" aria-hidden="true">
                {busy === f ? <Busy label={`Updating ${f}`} /> : on ? '✓' : ''}
              </span>
              {f}
            </button>
          );
        })}
      </div>
      <div className="ew-menusep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="ew-menuitem"
        disabled={readOnly || busy !== null}
        title={why ?? '@atrlock'}
        onClick={() => void lockToggle()}
      >
        <span className="ew-menucheck" aria-hidden="true">
          {busy === '@lock' ? <Busy label="Working" /> : locked ? <LockGlyph /> : ''}
        </span>
        {locked ? 'Unlock attribute' : 'Lock attribute'}
      </button>
      <button
        type="button"
        role="menuitem"
        className="ew-menuitem"
        disabled={readOnly}
        title={why}
        onClick={() => openAttrAction(sid, dbref, attr, 'owner')}
      >
        <span className="ew-menucheck" aria-hidden="true" />
        Change owner...
      </button>
      <button
        type="button"
        role="menuitem"
        className="ew-menuitem"
        disabled={readOnly}
        title={why}
        onClick={() => openAttrAction(sid, dbref, attr, 'rename')}
      >
        <span className="ew-menucheck" aria-hidden="true" />
        Rename...
      </button>
      <button
        type="button"
        role="menuitem"
        className="ew-menuitem"
        disabled={readOnly}
        title={why}
        onClick={() => openAttrAction(sid, dbref, attr, 'delete')}
      >
        <span className="ew-menucheck" aria-hidden="true" />
        Delete attribute...
      </button>
      <div className="ew-menusep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="ew-menuitem"
        onClick={() => {
          void copyText(attr, attr);
          closeAttrMenu();
        }}
      >
        <span className="ew-menucheck" aria-hidden="true" />
        Copy name
      </button>
      <button type="button" role="menuitem" className="ew-menuitem" onClick={() => void copyCommand()}>
        <span className="ew-menucheck" aria-hidden="true" />
        Copy as command
      </button>
      <button
        type="button"
        role="menuitem"
        className="ew-menuitem"
        onClick={() => {
          closeAttrMenu();
          void selectAttr(sid, dbref, attr).then(() => useEditorUi.getState().set({ focusTick: Date.now() }));
        }}
      >
        <span className="ew-menucheck" aria-hidden="true" />
        Open in the editor
      </button>
      {err && <FieldError text={err.text} />}
    </div>
  );
}
