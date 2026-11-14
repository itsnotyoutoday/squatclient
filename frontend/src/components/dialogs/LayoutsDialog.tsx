import { useCallback, useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import type { LayoutInfo, LayoutStarter } from '../../api/types';
import { BUILTIN_LAYOUTS } from '../../layout/builtin';
import { useSettings, useUi } from '../../state/stores';

/** Choose the default layout, make your own from a starter, edit and delete them (docs/LAYOUTS.md). */
export function LayoutsDialog() {
  const engine = useUi((s) => s.engine);
  const settings = useSettings((s) => s.settings);
  const [mine, setMine] = useState<LayoutInfo[]>([]);
  const [starters, setStarters] = useState<LayoutStarter[]>([]);
  const [dir, setDir] = useState('');
  const [editing, setEditing] = useState<{ id: string; source: string; isNew: boolean } | null>(null);
  const [err, setErr] = useState('');
  const close = (): void => useUi.getState().openDialog(null);
  const current = settings.layout || 'classic';

  const refresh = useCallback(async () => {
    if (!engine) return;
    try {
      setMine(await engine.listLayouts());
      setStarters(await engine.layoutStarters());
      setDir(await engine.layoutsDir());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [engine]);
  useEffect(() => {
    void refresh();
    return engine?.on('layouts-changed', () => void refresh());
  }, [engine, refresh]);

  const choose = async (id: string): Promise<void> => {
    if (!engine) return;
    const next = { ...settings, layout: id === 'classic' ? '' : id };
    try {
      await engine.saveSettings(next);
      useSettings.getState().set(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const edit = async (id: string): Promise<void> => {
    try {
      setErr('');
      setEditing({ id, source: (await engine?.readLayout(id)) ?? '', isNew: false });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async (): Promise<void> => {
    if (!editing || !engine) return;
    try {
      await engine.saveLayout(editing.id, editing.source);
      setErr('');
      setEditing(null);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e)); // the compile error, with the line
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await engine?.deleteLayout(id);
      if (settings.layout === id) await choose('classic');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const fromStarter = (s: LayoutStarter): void => {
    const used = new Set(mine.map((m) => m.id));
    let id = `my-${s.id}`;
    for (let i = 2; used.has(id); i++) id = `my-${s.id}-${i}`;
    setEditing({ id, source: s.source, isNew: true });
  };

  if (editing) {
    return (
      <Dialog
        title={editing.isNew ? 'New layout' : `Edit layout ${editing.id}`}
        onClose={() => setEditing(null)}
        wide
      >
        <div className="layouts-edit">
          {editing.isNew && (
            <label>
              Id{' '}
              <input
                aria-label="Layout id"
                value={editing.id}
                onChange={(e) => setEditing({ ...editing, id: e.target.value.toLowerCase() })}
              />
            </label>
          )}
          <textarea
            aria-label="Layout source"
            spellCheck={false}
            value={editing.source}
            onChange={(e) => setEditing({ ...editing, source: e.target.value })}
            rows={22}
          />
          {err && (
            <pre role="alert" className="err">
              {err}
            </pre>
          )}
          <div className="actions">
            <button type="button" className="primary" onClick={() => void save()}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Layouts" onClose={close} wide>
      <div className="layouts">
        <p className="dim">
          A layout arranges the output, the input line and panels such as gauges. The one chosen here is the
          default; a world can choose its own in Worlds.
        </p>
        <h3>Built in</h3>
        <ul className="layouts-list">
          {BUILTIN_LAYOUTS.map((l) => (
            <li key={l.id}>
              <label>
                <input
                  type="radio"
                  name="layout"
                  checked={current === l.id}
                  onChange={() => void choose(l.id)}
                />{' '}
                {l.name}
              </label>
              <span className="dim"> {l.description}</span>
            </li>
          ))}
        </ul>
        <h3>Yours</h3>
        {mine.length === 0 ? (
          <p className="dim">None yet. Copy a starter below, or put a file in the folder.</p>
        ) : (
          <ul className="layouts-list">
            {mine.map((l) => (
              <li key={l.id}>
                <label>
                  <input
                    type="radio"
                    name="layout"
                    checked={current === l.id}
                    onChange={() => void choose(l.id)}
                  />{' '}
                  {l.name}
                </label>
                {!l.allowed && <span className="badge"> needs your OK</span>}
                <span className="grow" />
                <button type="button" onClick={() => void edit(l.id)}>
                  Edit
                </button>
                <button type="button" onClick={() => void remove(l.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <h3>New from a starter</h3>
        <div className="actions">
          {starters.map((s) => (
            <button key={s.id} type="button" onClick={() => fromStarter(s)}>
              {s.name}
            </button>
          ))}
        </div>
        <p className="dim">
          Your layouts live in <code>{dir}</code> (<code>.layout</code>, <code>.tsx</code>, <code>.jsx</code>,{' '}
          <code>.ts</code> or <code>.js</code>
          files). They reload as you save them.
        </p>
        {err && (
          <p role="alert" className="err">
            {err}
          </p>
        )}
        <div className="actions">
          <button type="button" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
