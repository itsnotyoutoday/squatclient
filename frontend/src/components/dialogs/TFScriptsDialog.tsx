import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFScript } from '../../api/types';
import { useUi } from '../../state/stores';
import { Dialog } from './Dialog';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}\.tf$/;

/** Scripts sent from this app to TinyFugue: upload a macro file, activate it, replace it, delete it. */
export function TFScriptsDialog() {
  const engine = useUi((s) => s.engine);
  const sqId = useUi((s) => s.tfWorldsFor);
  const squatter = useUi((s) => s.squatters.find((q) => q.id === s.tfWorldsFor));
  const [scripts, setScripts] = useState<TFScript[]>([]);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [load, setLoad] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ loaded: boolean; out: string[] } | null>(null);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const fail = (e: unknown): void => setErr(e instanceof Error ? e.message : String(e));

  const reload = useCallback(async (): Promise<void> => {
    if (!engine || !sqId) return;
    try {
      setScripts(await engine.listTFScripts(sqId));
    } catch (e) {
      fail(e);
    }
  }, [engine, sqId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const pick = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    setContent(await f.text());
    if (!name) setName(f.name.endsWith('.tf') ? f.name : `${f.name.replace(/\.[^.]*$/, '')}.tf`);
    setResult(null);
  };

  const send = async (): Promise<void> => {
    if (!engine || !sqId) return;
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const r = await engine.putTFScript(sqId, name, content, load);
      setResult({ loaded: r.loaded, out: r.out });
      await reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const nameOk = NAME_RE.test(name);
  return (
    <Dialog
      title={`TinyFugue scripts: ${squatter?.name ?? ''}`}
      onClose={() => useUi.getState().openDialog('squatters')}
      wide
    >
      <p className="hint">
        Sends a TinyFugue macro file to TinyFugue and runs it there. What it may do is decided in TinyFugue:
        with <code>/set squat_scripts=safe</code> the script runs sandboxed (no shell, no files, no new
        connections, no Lua, also when its triggers fire later); <code>on</code> gives it TinyFugue&rsquo;s
        own rights; off refuses uploads.
      </p>
      <h3>Stored in TinyFugue</h3>
      {scripts.length === 0 ? (
        <p className="hint">No scripts yet.</p>
      ) : (
        <ul className="plain">
          {scripts.map((s) => (
            <li key={s.name} className="rowline">
              <span>
                <strong>{s.name}</strong> <span className="dim">{s.size} bytes</span>
              </span>
              <button
                type="button"
                className="danger"
                aria-label={`Delete ${s.name}`}
                onClick={() =>
                  void engine
                    ?.deleteTFScript(sqId ?? '', s.name)
                    .then(reload)
                    .catch(fail)
                }
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">
        Deleting removes the file only: triggers and macros the script already defined stay in TinyFugue until
        you undefine them or it restarts.
      </p>
      <h3>Send a script</h3>
      <div className="form grid">
        <label className="field">
          <span className="lbl">Name</span>
          <input
            aria-label="Script name"
            value={name}
            placeholder="myscript.tf"
            onChange={(e) => setName(e.target.value)}
          />
          <span className="hint">
            {name && !nameOk
              ? 'Letters, digits, . _ - and ending in .tf'
              : 'The same name replaces the old script'}
          </span>
        </label>
        <div className="field">
          <span className="lbl">File</span>
          <input
            ref={fileRef}
            type="file"
            aria-label="Choose a script file"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </div>
        <label className="field wide">
          <span className="lbl">Script</span>
          <textarea
            aria-label="Script text"
            rows={8}
            value={content}
            spellCheck={false}
            onChange={(e) => {
              setContent(e.target.value);
              setResult(null);
            }}
          />
        </label>
        <div className="checks wide">
          <label className="check">
            <input type="checkbox" checked={load} onChange={(e) => setLoad(e.target.checked)} /> Activate it
            now (load it in TinyFugue)
          </label>
        </div>
        <div className="actions wide">
          <button
            type="button"
            className="primary"
            disabled={busy || !nameOk || !content}
            onClick={() => void send()}
          >
            {load ? 'Send and load' : 'Send'}
          </button>
        </div>
      </div>
      {result && (
        <div role="status" className={result.loaded || !load ? '' : 'err'} data-testid="script-result">
          <strong>
            {load ? (result.loaded ? 'Loaded.' : 'Stored, but TinyFugue reported a problem.') : 'Stored.'}
          </strong>
          {result.out.length > 0 && <pre>{result.out.join('\n')}</pre>}
        </div>
      )}
      {err && (
        <p role="alert" className="err">
          {err}
        </p>
      )}
    </Dialog>
  );
}
