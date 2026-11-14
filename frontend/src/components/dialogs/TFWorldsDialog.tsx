import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { TFWorld, TFWorldPut } from '../../api/types';
import { useUi } from '../../state/stores';
import { Dialog, Field } from './Dialog';

const blank = (): TFWorldPut => ({ name: '', host: '', port: '4201', type: '', char: '', save: true });

/** TinyFugue's own world records, edited in place (docs/TF-SQUATTER.md, world.*). */
export function TFWorldsDialog() {
  const engine = useUi((s) => s.engine);
  const sqId = useUi((s) => s.tfWorldsFor);
  const squatter = useUi((s) => s.squatters.find((q) => q.id === s.tfWorldsFor));
  const [worlds, setWorlds] = useState<TFWorld[]>([]);
  const [draft, setDraft] = useState<TFWorldPut | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [origName, setOrigName] = useState('');
  const [err, setErr] = useState('');
  const canEdit = squatter?.role !== 'viewer';
  const fail = (e: unknown): void => setErr(e instanceof Error ? e.message : String(e));

  const reload = useCallback(async (): Promise<void> => {
    if (!engine || !sqId) return;
    try {
      setWorlds(await engine.listTFWorlds(sqId));
      setErr('');
    } catch (e) {
      fail(e);
    }
  }, [engine, sqId]);

  useEffect(() => {
    void reload();
    // another device edited TinyFugue's worlds
    return engine?.on('tf-worlds', (p) => {
      if (p.squatter === sqId) void reload();
    });
  }, [engine, sqId, reload]);

  const close = (): void => useUi.getState().openDialog('squatters');
  const set = <K extends keyof TFWorldPut>(k: K, v: TFWorldPut[K]): void =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!engine || !sqId || !draft) return;
    try {
      if (!isNew && origName && draft.name !== origName) {
        await engine.renameTFWorld(sqId, origName, draft.name); // TinyFugue renames the record; sessions and local worlds follow
        setOrigName(draft.name);
      }
      await engine.putTFWorld(sqId, draft);
      setDraft(null);
      await reload();
    } catch (x) {
      fail(x);
    }
  };

  const connect = async (name: string): Promise<void> => {
    if (!engine || !sqId) return;
    try {
      const si = await engine.connectTFWorld(sqId, name);
      useUi.getState().openDialog(null);
      void engine.foreground(si.id).catch(() => undefined);
    } catch (x) {
      fail(x);
    }
  };

  return (
    <Dialog title={`TinyFugue worlds: ${squatter?.name ?? ''}`} onClose={close} wide>
      {draft ? (
        <form className="form grid" onSubmit={(e) => void save(e)}>
          <Field label="Name">
            <input required aria-label="Name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Host">
            <input required value={draft.host} onChange={(e) => set('host', e.target.value)} />
          </Field>
          <Field label="Port" hint="A number or a service name">
            <input required value={draft.port} onChange={(e) => set('port', e.target.value)} />
          </Field>
          <Field label="Character">
            <input value={draft.char ?? ''} onChange={(e) => set('char', e.target.value)} />
          </Field>
          <Field
            label="Password"
            hint={draft.passSet ? 'One is stored in TinyFugue; leave empty to keep it' : 'Stored in TinyFugue, never here'}
          >
            <input
              type="password"
              autoComplete="new-password"
              value={draft.password ?? ''}
              onChange={(e) => set('password', e.target.value)}
            />
          </Field>
          <Field label="Login type" hint="TinyFugue world type, e.g. tiny">
            <input value={draft.type ?? ''} onChange={(e) => set('type', e.target.value)} />
          </Field>
          <div className="checks">
            <label className="check">
              <input type="checkbox" checked={!!draft.tls} onChange={(e) => set('tls', e.target.checked)} /> TLS
            </label>
            <label className="check">
              <input type="checkbox" checked={!!draft.save} onChange={(e) => set('save', e.target.checked)} /> Keep
              after TinyFugue restarts (/saveworld)
            </label>
          </div>
          <div className="actions wide">
            <button type="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Save
            </button>
          </div>
        </form>
      ) : (
        <>
          {worlds.length === 0 ? (
            <p className="hint">TinyFugue has no world records.</p>
          ) : (
            <ul className="plain">
              {worlds.map((w) => (
                <li key={w.name} className="rowline">
                  <span>
                    <strong>{w.name}</strong>{' '}
                    <span className="dim">
                      {w.host}:{w.port}
                      {w.char ? ` · ${w.char}` : ''}
                      {w.passSet ? ' · password set' : ''}
                    </span>
                  </span>
                  <button type="button" aria-label={`Connect ${w.name}`} onClick={() => void connect(w.name)}>
                    Connect
                  </button>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        aria-label={`Edit ${w.name}`}
                        onClick={() => {
                          setIsNew(false);
                          setOrigName(w.name);
                          setDraft({ ...w, password: '', save: true });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="danger"
                        aria-label={`Delete ${w.name}`}
                        onClick={() =>
                          void engine
                            ?.deleteTFWorld(sqId ?? '', w.name)
                            .then(reload)
                            .catch(fail)
                        }
                      >
                        Delete
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="actions">
            <button type="button" onClick={close}>
              Back
            </button>
            {canEdit && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setIsNew(true);
                  setDraft(blank() as TFWorldPut);
                }}
              >
                Add world
              </button>
            )}
          </div>
        </>
      )}
      {err && (
        <p role="alert" className="err">
          {err}
        </p>
      )}
    </Dialog>
  );
}
