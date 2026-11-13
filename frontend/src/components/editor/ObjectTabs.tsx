import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  moveObject,
  openTarget,
  requestCloseObject,
  selectObject,
  useEditor,
  useEditorUi,
} from '../../state/editorStore';
import type { OpenObject } from '../../state/editorStore';
import { parseEditCommand } from '../../lib/editor/command';
import { tabListKeys } from './roving';

const label = (o: OpenObject): string => `${o.name ?? o.dbref} (${o.dbref})`;

/** Row 2: the objects open in this world, with close buttons, drag-to-reorder and the `[+]` prompt. */
export function ObjectTabs({ sid }: { sid: string }) {
  const w = useEditor((s) => s.ws[sid]);
  const prompt = useEditorUi((s) => s.prompt);
  const drag = useRef<number | null>(null);
  const objects = w?.objects ?? [];

  return (
    <div className="ew-objects">
      <div className="ew-tablist" role="tablist" aria-label="Open objects" onKeyDown={tabListKeys}>
        {objects.map((o, i) => {
          const active = o.dbref === w?.activeObject;
          const dirty = Object.values(o.buffers).some((b) => b.dirty);
          return (
            <div
              key={o.dbref}
              className={`ew-objtab${active ? ' ew-active' : ''}`}
              draggable
              onDragStart={() => (drag.current = i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag.current !== null) moveObject(sid, drag.current, i);
                drag.current = null;
              }}
            >
              <button
                type="button"
                role="tab"
                id={`ew-tab-${o.dbref.slice(1)}`}
                aria-selected={active}
                aria-controls="ew-panel"
                tabIndex={active ? 0 : -1}
                className="ew-objmain"
                title={`${label(o)} - Cmd/Ctrl-${i + 1}`}
                onClick={() => selectObject(sid, o.dbref)}
                onAuxClick={(e) => e.button === 1 && requestCloseObject(sid, o.dbref)}
              >
                {o.loading && <span className="ew-spin" role="img" aria-label="loading" />}
                <span className="ew-tabname">{label(o)}</span>
                {dirty && (
                  <span className="ew-dot" role="img" aria-label="unsaved changes">
                    &#9679;
                  </span>
                )}
              </button>
              <button
                type="button"
                className="ew-objclose"
                aria-label={`Close ${o.name ?? o.dbref}`}
                onClick={() => requestCloseObject(sid, o.dbref)}
              >
                &times;
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="ew-add"
          aria-label="Open another object"
          title="Open an object (Cmd/Ctrl-T)"
          aria-expanded={prompt}
          onClick={() => useEditorUi.getState().set({ prompt: !prompt })}
        >
          +
        </button>
      </div>
      {prompt && <OpenPrompt sid={sid} />}
    </div>
  );
}

function OpenPrompt({ sid }: { sid: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => ref.current?.focus(), []);

  const close = (): void => useEditorUi.getState().set({ prompt: false });
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const text = value.trim();
    if (!text || busy) return;
    const cmd = parseEditCommand(`/edit ${text}`);
    if (!cmd || cmd.kind === 'bad') {
      setError(cmd?.kind === 'bad' ? cmd.message : 'Enter an object');
      return;
    }
    if (!cmd.target) return;
    setBusy(true);
    setError('');
    const r = await openTarget(sid, cmd.target, cmd.attr);
    setBusy(false);
    if (r.ok) close();
    else setError(r.error);
  };

  return (
    <form className="ew-prompt" onSubmit={(e) => void submit(e)} role="search" aria-label="Open object">
      <label className="ew-promptlabel">
        <span className="ew-promptcap">Open object</span>
        <input
          ref={ref}
          value={value}
          disabled={busy}
          placeholder="#123, me, here or a name (optionally /ATTRIBUTE)"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'ew-prompt-error' : undefined}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        />
      </label>
      <button type="submit" className="primary" disabled={busy || !value.trim()}>
        {busy ? 'Opening...' : 'Open'}
      </button>
      <button type="button" onClick={close}>
        Cancel
      </button>
      {error && (
        <span id="ew-prompt-error" role="alert" className="ew-promptfail">
          {error}
        </span>
      )}
    </form>
  );
}
