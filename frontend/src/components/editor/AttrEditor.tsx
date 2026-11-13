import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { LazyCodeEditor } from '../codeeditor';
import type { CodeEditorHandle } from '../codeeditor';
import type { BalanceIssue } from '../../lib/mushcode';
import { refAt } from '../../lib/editor/refs';
import {
  gotoRef,
  isReadOnlyAttr,
  isReadOnlyObject,
  loadObject,
  refresh,
  revert,
  save,
  selectAttr,
  setText,
  toggleMode,
  useEditorUi,
} from '../../state/editorStore';
import type { Buffer, OpenObject } from '../../state/editorStore';
import { openAttrMenu } from '../../state/detailsStore';
import { SearchPanel } from './SearchPanel';

const MAX_MOUNTED = 6;
const WRAP_KEY = 'squat.editor.wrap';

function readWrap(): boolean {
  try {
    return localStorage.getItem(WRAP_KEY) === '1';
  } catch {
    return false;
  }
}

/** The editing pane of the active object: banners, toolbar, one CodeEditor per visited attribute, bottom strip. */
export function AttrEditor({ sid, obj }: { sid: string; obj: OpenObject }) {
  const attr = obj.activeAttr;
  const buf = attr ? obj.buffers[attr] : undefined;
  const key = attr ? `${obj.dbref}/${attr}` : '';
  const handles = useRef<Record<string, CodeEditorHandle | null>>({});
  const [wrap, setWrap] = useState(readWrap);
  const [issues, setIssues] = useState<Record<string, BalanceIssue[]>>({});
  const [showProblems, setShowProblems] = useState(false);
  const focusTick = useEditorUi((s) => s.focusTick);
  const searchOpen = useEditorUi((s) => s.searchPanel);
  // editors stay mounted (hidden) so undo history survives switching; the least recent are dropped
  const [mounted, setMounted] = useState<string[]>([]);

  useEffect(() => {
    if (!key) return;
    setMounted((m) => [key, ...m.filter((k) => k !== key)].slice(0, MAX_MOUNTED));
  }, [key]);

  useEffect(() => {
    if (focusTick) handles.current[key]?.focus();
  }, [focusTick, key]);

  const setWrapPref = (v: boolean): void => {
    setWrap(v);
    try {
      localStorage.setItem(WRAP_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const goToDefinition = useCallback(
    (e?: ReactMouseEvent) => {
      const h = handles.current[key];
      const b = obj.buffers[obj.activeAttr ?? ''];
      if (!h || !b) return;
      const c = h.getCursor();
      const ref = refAt(b.text, c.offset);
      if (!ref) return;
      e?.preventDefault();
      h.goTo(c.offset); // drop the extra cursor a Cmd-click adds
      void gotoRef(sid, obj.dbref, ref);
    },
    [key, obj, sid],
  );

  if (!attr || !buf) {
    return (
      <section
        className="ew-main"
        id="ew-panel"
        role="tabpanel"
        aria-labelledby={`ew-tab-${obj.dbref.slice(1)}`}
      >
        <ObjectBanners sid={sid} obj={obj} />
        <div className="ew-placeholder">
          {obj.loading
            ? 'Loading...'
            : obj.error
              ? null
              : obj.attrs.length > 0
                ? 'Choose an attribute on the left.'
                : 'This object has no attributes. Add one with "+ new attribute".'}
        </div>
      </section>
    );
  }

  const readOnly = isReadOnlyAttr(obj, attr);
  const mine = issues[key] ?? [];
  const canFormat = buf.mode === 'code' && !readOnly;
  const entry = obj.attrs.find((a) => a.name === attr);

  return (
    <section
      className="ew-main"
      id="ew-panel"
      role="tabpanel"
      aria-labelledby={`ew-tab-${obj.dbref.slice(1)}`}
    >
      <ObjectBanners sid={sid} obj={obj} />
      {entry?.writable === false && !isReadOnlyObject(obj) && (
        <div className="ew-banner ew-warn" role="status">
          {attr} is protected{entry.flags ? ` (${entry.flags})` : ''}; it is read-only here.
        </div>
      )}
      {buf.loadError && (
        <div className="ew-banner ew-bad" role="alert">
          {buf.loadError}{' '}
          <button type="button" onClick={() => void selectAttr(sid, obj.dbref, attr).then(() => undefined)}>
            Retry
          </button>
        </div>
      )}
      {buf.restored && (
        <div className="ew-banner ew-info" role="status">
          Restored an unsaved draft from your last session.{' '}
          <button type="button" onClick={() => revert(sid, obj.dbref, attr)}>
            Discard draft
          </button>
        </div>
      )}
      {buf.lastError && (
        <div className="ew-banner ew-bad" role="alert" data-testid="save-error">
          <strong>{buf.lastCode === 'mismatch' ? 'Not stored as written: ' : 'Not saved: '}</strong>
          <span className="ew-reply">{buf.lastError}</span>
          <span className="ew-banner-note"> Your text is kept; fix it or save again.</span>
        </div>
      )}
      {buf.notice && !buf.lastError && (
        <div
          className={`ew-banner ${buf.notice.kind === 'saved' ? 'ew-ok' : 'ew-warn'}`}
          role="status"
          data-testid="save-notice"
        >
          {buf.notice.kind === 'saved' ? '✓ ' : ''}
          {buf.notice.text}
        </div>
      )}

      <div className="ew-toolbar" role="toolbar" aria-label={`Tools for ${attr}`}>
        <h2 className="ew-attrtitle">
          <span className="ew-attrtitle-name">&amp;{attr}</span> <span className="dim">{obj.dbref}</span>
          {readOnly && <span className="ew-ro"> read-only</span>}
          {buf.saving ? (
            <span className="ew-status"> saving...</span>
          ) : buf.dirty ? (
            <span className="ew-status ew-unsaved"> &#9679; unsaved</span>
          ) : null}
        </h2>
        <span className="ew-grow" />
        <button
          type="button"
          aria-haspopup="menu"
          aria-label={`Actions for attribute ${attr}`}
          title="Flags, lock, owner, rename, delete, copy (also: right-click the attribute, or press Shift+F10 in the list)"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openAttrMenu(sid, obj.dbref, attr, r.left, r.bottom + 2);
          }}
        >
          ...
        </button>
        <button
          type="button"
          className="primary"
          disabled={readOnly || !buf.dirty || buf.saving}
          title="Save (Cmd/Ctrl-S)"
          onClick={() => void save(sid, obj.dbref, attr)}
        >
          Save
        </button>
        <button
          type="button"
          disabled={!buf.dirty || buf.saving}
          title="Throw away your changes"
          onClick={() => revert(sid, obj.dbref, attr)}
        >
          Revert
        </button>
        <button
          type="button"
          disabled={!canFormat}
          title={
            buf.mode === 'lines'
              ? 'Formatting is off while %r is shown as line breaks'
              : 'Indent nested calls (Cmd/Ctrl-Alt-])'
          }
          onClick={() => handles.current[key]?.expand()}
        >
          Expand
        </button>
        <button
          type="button"
          disabled={!canFormat}
          title="Join continuation lines (Cmd/Ctrl-Alt-[)"
          onClick={() => handles.current[key]?.collapse()}
        >
          Collapse
        </button>
        <label className="ew-check" title="Soft-wrap long lines">
          <input type="checkbox" checked={wrap} onChange={(e) => setWrapPref(e.target.checked)} /> Wrap
        </label>
        <label className="ew-check" title="Show %r as line breaks and %t as tabs; saving turns them back">
          <input
            type="checkbox"
            checked={buf.mode === 'lines'}
            onChange={() => toggleMode(sid, obj.dbref, attr)}
          />{' '}
          %r as line breaks
        </label>
        <button
          type="button"
          title="Compare with the game's current value"
          onClick={() => useEditorUi.getState().set({ compare: { sid, dbref: obj.dbref, attr } })}
        >
          Compare
        </button>
        <button
          type="button"
          title="Search all attributes (Cmd/Ctrl-Shift-F)"
          onClick={() => useEditorUi.getState().set({ searchPanel: true })}
        >
          Search
        </button>
        <button
          type="button"
          title="Reload the object and its attributes from the game"
          disabled={obj.loading}
          onClick={() => void refresh(sid, obj.dbref)}
        >
          Refresh
        </button>
      </div>

      {searchOpen && (
        <SearchPanel
          sid={sid}
          dbref={obj.dbref}
          onJump={(a, offset) => setTimeout(() => handles.current[`${obj.dbref}/${a}`]?.goTo(offset), 60)}
        />
      )}
      <div
        className="ew-editors"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) goToDefinition(e);
        }}
        onKeyDown={(e) => {
          if (e.key === 'F12') {
            e.preventDefault();
            goToDefinition();
          }
        }}
      >
        {mounted.map((k) => {
          const [d, ...rest] = k.split('/');
          const a = rest.join('/');
          const b: Buffer | undefined = d === obj.dbref ? obj.buffers[a] : undefined;
          if (!b) return null;
          return (
            <div key={k} className="ew-editorhost" hidden={k !== key}>
              <LazyCodeEditor
                ref={(h) => {
                  handles.current[k] = h;
                }}
                value={b.text}
                onChange={(t) => setText(sid, obj.dbref, a, t)}
                onIssues={(i) => setIssues((m) => (m[k] === i ? m : { ...m, [k]: i }))}
                readOnly={isReadOnlyAttr(obj, a)}
                wrap={wrap}
                height="100%"
                ariaLabel={`Value of ${a} on ${obj.dbref}`}
                balanceMode="code"
                autoFocus={k === key}
              />
            </div>
          );
        })}
      </div>

      <div className="ew-bottom">
        <button
          type="button"
          className={`ew-problems${mine.length ? ' ew-hasproblems' : ''}`}
          aria-expanded={showProblems}
          onClick={() => setShowProblems((v) => !v)}
        >
          Problems ({mine.length})
        </button>
        <span className="ew-info" title="Owner, type and flags of the object">
          {obj.owner && <>Owner: {obj.owner} </>}
          {obj.type && <>Type: {obj.type} </>}
          {obj.flags && <>Flags: {obj.flags} </>}
          <span>
            You control it: {obj.controls === true ? 'yes' : obj.controls === false ? 'no' : 'unknown'}
          </span>
        </span>
        <span className="ew-grow" />
        <span className="ew-reply-line" role="status">
          {buf.lastError
            ? `Game: ${buf.lastError}`
            : buf.notice?.kind === 'saved'
              ? 'Game: saved and verified'
              : ''}
        </span>
      </div>
      {showProblems && (
        <ul className="ew-problemlist" aria-label="Problems">
          {mine.length === 0 && <li className="dim">No problems found.</li>}
          {mine.slice(0, 50).map((p, i) => (
            <li key={i}>
              <button type="button" onClick={() => handles.current[key]?.goTo(p.index)}>
                {p.line}:{p.col} {p.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Permission and error banners of the object (spec 4.2). */
function ObjectBanners({ sid, obj }: { sid: string; obj: OpenObject }) {
  return (
    <>
      {obj.error && (
        <div className="ew-banner ew-bad" role="alert">
          {obj.error}{' '}
          <button type="button" onClick={() => void loadObject(sid, obj.dbref)}>
            Retry
          </button>
        </div>
      )}
      {obj.controls === false && (
        <div className="ew-banner ew-warn" role="status" data-testid="readonly-banner">
          You do not control {obj.dbref}
          {obj.owner ? ` (owner: ${obj.owner})` : ''}; editing is disabled. You can still read and copy.
        </div>
      )}
      {obj.controls === 'unknown' && !obj.loading && !obj.error && (
        <div className="ew-banner ew-info" role="status" data-testid="unknown-banner">
          Could not check whether you control {obj.dbref}. You can edit; the game decides when you save.
        </div>
      )}
    </>
  );
}
