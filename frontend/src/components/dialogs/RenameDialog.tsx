import { useState } from 'react';
import type { FormEvent } from 'react';
import { useSessions, useUi } from '../../state/stores';
import { Dialog, Field } from './Dialog';

/** Rename the world behind a TinyFugue connection: TinyFugue's record is renamed, and the tab and
 *  this app's world follow. */
export function RenameDialog() {
  const engine = useUi((s) => s.engine);
  const id = useUi((s) => s.renameSession);
  const s = useSessions((st) => (id ? st.sessions[id] : undefined));
  const temp = !!s?.tf?.world.startsWith('(');
  const [name, setName] = useState(temp ? '' : (s?.name ?? ''));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const close = (): void => useUi.getState().openDialog(null);
  if (!s || !id) return null;
  const bad = /\s/.test(name) || name.startsWith('(') || name === 'default';
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!engine || bad || !name || (!temp && name === s.name)) return;
    setBusy(true);
    try {
      await engine.renameTFSession(id, name);
      close();
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={temp ? 'Save as a world in TinyFugue' : 'Rename in TinyFugue'} onClose={close}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <p className="hint">
          {temp
            ? 'This connection was opened by address. Naming it makes it a world in TinyFugue (kept after the connection closes) and a world in your list, and the tab follows.'
            : 'Renames the world in TinyFugue too. The tab, and a world of yours routed through TinyFugue, follow.'}
        </p>
        <Field label="Name" hint={bad ? 'No spaces, and not starting with ( or called default' : undefined}>
          <input data-autofocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || bad || !name || (!temp && name === s.name)}>
            {temp ? 'Save world' : 'Rename'}
          </button>
        </div>
        {err && (
          <p role="alert" className="err">
            {err}
          </p>
        )}
      </form>
    </Dialog>
  );
}
