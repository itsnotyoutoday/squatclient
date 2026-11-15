import { useEffect, useMemo, useState } from 'react';
import { GAME_TYPES } from '../../lib/modules';
import { BUILTIN_LAYOUTS } from '../../layout/builtin';
import type { LayoutInfo } from '../../api/types';
import type { FormEvent } from 'react';
import type { WorldConfig } from '../../api/types';
import { useUi } from '../../state/stores';
import { squatterLabel } from '../../lib/tfcontrol';
import { Dialog, Field } from './Dialog';

const blank = (): WorldConfig => ({
  id: '',
  name: '',
  host: '',
  port: 4201,
  tls: false,
  tlsVerify: 'strict',
  encoding: 'utf-8',
  via: 'direct',
  login: { template: 'connect {name} {password}', charName: '', hasPassword: false },
});

/** The group a world is in when it has not been put in another one (the engine applies the same default). */
export const DEFAULT_GROUP = 'My Worlds';

/** Worlds by group, the default group first. `extra` are empty groups made in this dialog (shown as drop targets, never filtered out). */
export function groupWorlds(
  worlds: readonly WorldConfig[],
  filter: string,
  extra: readonly string[] = [],
): [string, WorldConfig[]][] {
  const f = filter.trim().toLowerCase();
  const groups = new Map<string, WorldConfig[]>();
  if (!f) for (const g of [DEFAULT_GROUP, ...extra]) groups.set(g, []);
  for (const w of worlds) {
    const g = w.group || DEFAULT_GROUP;
    if (f && !`${w.name} ${w.host} ${g}`.toLowerCase().includes(f)) continue;
    groups.set(g, [...(groups.get(g) ?? []), w]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === DEFAULT_GROUP ? -1 : b === DEFAULT_GROUP ? 1 : a.localeCompare(b)))
    .map(([g, ws]) => [g, ws.sort((x, y) => x.name.localeCompare(y.name))]);
}

export function WorldManager() {
  const engine = useUi((s) => s.engine);
  const worlds = useUi((s) => s.worlds);
  const squatters = useUi((s) => s.squatters);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState<WorldConfig | null>(null);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [userLayouts, setUserLayouts] = useState<LayoutInfo[]>([]);
  useEffect(() => {
    void engine
      ?.listLayouts()
      .then(setUserLayouts)
      .catch(() => undefined);
  }, [engine]);
  const [extraGroups, setExtraGroups] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const groups = useMemo(() => groupWorlds(worlds, filter, extraGroups), [worlds, filter, extraGroups]);
  const groupNames = useMemo(() => groups.map(([g]) => g), [groups]);
  const close = (): void => useUi.getState().openDialog(null);
  const editWorldId = useUi((s) => s.editWorldId);
  useEffect(() => {
    // "Edit world..." from a tab: select that world when the dialog opens
    if (!editWorldId) return;
    const w = worlds.find((x) => x.id === editWorldId);
    if (w) setDraft(w);
    useUi.getState().setEditWorld(null);
  }, [editWorldId, worlds]);

  const refresh = async (): Promise<void> => {
    if (engine) useUi.getState().setWorlds(await engine.listWorlds());
  };
  const fail = (e: unknown): void => setErr(e instanceof Error ? e.message : String(e));

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!engine || !draft) return;
    try {
      const saved = await engine.saveWorld(draft);
      if (password) await engine.setWorldPassword(saved.id, password);
      setPassword('');
      await refresh();
      setDraft(saved);
      setErr('');
    } catch (x) {
      fail(x);
    }
  };

  // drag a world onto a group's heading or list to move it there
  const moveTo = async (id: string, group: string): Promise<void> => {
    const w = worlds.find((x) => x.id === id);
    if (!engine || !w || (w.group || DEFAULT_GROUP) === group) return;
    try {
      await engine.saveWorld({ ...w, group });
      await refresh();
      setDraft((d) => (d && d.id === id ? { ...d, group } : d));
      setErr('');
    } catch (x) {
      fail(x);
    }
  };

  const remove = async (): Promise<void> => {
    if (!engine || !draft?.id) return;
    try {
      await engine.deleteWorld(draft.id);
      setDraft(null);
      await refresh();
    } catch (x) {
      fail(x);
    }
  };

  const connect = async (w: WorldConfig): Promise<void> => {
    if (!engine || !w.id) return;
    try {
      await engine.connect({ worldId: w.id });
      close();
    } catch (x) {
      fail(x);
    }
  };

  const set = <K extends keyof WorldConfig>(k: K, v: WorldConfig[K]): void =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  const login = draft?.login ?? { template: 'connect {name} {password}', hasPassword: false };

  return (
    <Dialog title="Worlds" onClose={close} wide>
      <div className="worlds">
        <nav aria-label="World list" className="worldlist">
          <input
            type="search"
            aria-label="Search worlds"
            placeholder="Search worlds"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            data-autofocus
          />
          {groups.map(([g, ws]) => (
            <section
              key={g}
              aria-label={g}
              className={dragOver === g ? 'dropping' : ''}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('text/x-squat-world')) return;
                e.preventDefault();
                setDragOver(g);
              }}
              onDragLeave={() => setDragOver((d) => (d === g ? null : d))}
              onDrop={(e) => {
                const id = e.dataTransfer.getData('text/x-squat-world');
                setDragOver(null);
                if (!id) return;
                e.preventDefault();
                void moveTo(id, g);
              }}
            >
              <h3>{g}</h3>
              <ul>
                {ws.length === 0 && <li className="hint dropHint">Drag a world here</li>}
                {ws.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/x-squat-world', w.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      className={draft?.id === w.id ? 'sel' : ''}
                      onClick={() => {
                        setDraft(w);
                        setPassword('');
                      }}
                      onDoubleClick={() => void connect(w)}
                    >
                      {w.name}{' '}
                      <span className="dim">
                        {w.host}:{w.port}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {groups.length === 0 && <p className="hint">No worlds{filter ? ' match' : ' yet'}.</p>}
          {newGroup === null ? (
            <button type="button" onClick={() => setNewGroup('')}>
              + New group
            </button>
          ) : (
            <form
              className="newgroup"
              onSubmit={(e) => {
                e.preventDefault();
                const n = newGroup.trim();
                if (n && !groupNames.includes(n)) setExtraGroups((g) => [...g, n]);
                setNewGroup(null);
              }}
            >
              <input
                aria-label="New group name"
                placeholder="Group name"
                value={newGroup}
                autoFocus
                onChange={(e) => setNewGroup(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setNewGroup(null))}
              />
            </form>
          )}
          <button
            type="button"
            onClick={() => {
              setDraft({ ...blank(), group: DEFAULT_GROUP });
              setPassword('');
            }}
          >
            + Add world
          </button>
        </nav>
        <div className="worldedit">
          {draft ? (
            <form className="form grid" onSubmit={(e) => void save(e)} aria-label="Edit world">
              <Field label="Name">
                <input required value={draft.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="Group">
                <input
                  list="world-groups"
                  value={draft.group ?? ''}
                  placeholder={DEFAULT_GROUP}
                  onChange={(e) => set('group', e.target.value || undefined)}
                />
                <datalist id="world-groups">
                  {groupNames.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </Field>
              <Field label="Host">
                <input required value={draft.host} onChange={(e) => set('host', e.target.value)} />
              </Field>
              <Field label="Port">
                <input
                  required
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.port}
                  onChange={(e) => set('port', Number(e.target.value))}
                />
              </Field>
              <Field label="Connect via">
                <select value={draft.via} onChange={(e) => set('via', e.target.value)}>
                  <option value="direct">Direct</option>
                  {squatters.map((s) => (
                    <option key={s.id} value={s.id}>
                      {squatterLabel(s)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Layout" hint="How this world's window is arranged (Layouts in the View menu)">
                <select value={draft.layout ?? ''} onChange={(e) => set('layout', e.target.value)}>
                  <option value="">Default</option>
                  {BUILTIN_LAYOUTS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                  {userLayouts.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              {!squatters.some((s) => s.kind === 'tf-squatterd') && (
                <p className="hint wide">
                  To route through TinyFugue or gtf, pair it first: Squatters (cloud button), Add a squatter,
                  Type: TinyFugue or gtf (GoTinyFugue).
                </p>
              )}
              <Field
                label="Game type"
                hint="Decides which modules apply (the Object Editor is for MU* games; other kinds get their own tools)"
              >
                <select value={draft.gameType ?? ''} onChange={(e) => set('gameType', e.target.value)}>
                  <option value="">Detect automatically</option>
                  {GAME_TYPES.map((g) => (
                    <option key={g.type} value={g.type}>
                      {g.name}
                    </option>
                  ))}
                  <option value="other">Something else</option>
                </select>
              </Field>
              <Field
                label="Local echo"
                hint="Show what you type in this world's output. Follow the setting uses Settings > Show what I type."
              >
                <select
                  value={draft.localEcho ?? ''}
                  onChange={(e) => set('localEcho', e.target.value as WorldConfig['localEcho'])}
                >
                  <option value="">Follow the setting</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </Field>
              <Field
                label="CMCP version"
                hint="Which version of the console protocol this world speaks (never both). Default is 2; choose 1 for a game that has not moved to 2 yet. Takes effect on the next connection."
              >
                <select
                  aria-label="CMCP version"
                  value={draft.cmcp ?? ''}
                  onChange={(e) => set('cmcp', e.target.value as WorldConfig['cmcp'])}
                >
                  <option value="">Default (2)</option>
                  <option value="2">CMCP 2</option>
                  <option value="1">CMCP 1 (older games)</option>
                </select>
              </Field>
              <Field
                label="Local development game"
                hint="Tick this for a game running on this computer (localhost / 127.0.0.1) that serves its definition, packs and sounds over plain http. It only works when the host is local."
              >
                <label className="check">
                  <input
                    type="checkbox"
                    aria-label="Local development game"
                    checked={!!draft.devHttp}
                    onChange={(e) => set('devHttp', e.target.checked || undefined)}
                  />{' '}
                  Allow plain http from this game's own local server
                </label>
              </Field>
              <Field label="Encoding">
                <select
                  value={draft.encoding}
                  onChange={(e) => set('encoding', e.target.value as WorldConfig['encoding'])}
                >
                  <option value="utf-8">UTF-8</option>
                  <option value="latin1">Latin-1</option>
                </select>
              </Field>
              <div className="checks">
                <label className="check">
                  <input type="checkbox" checked={draft.tls} onChange={(e) => set('tls', e.target.checked)} />{' '}
                  TLS
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    disabled={!draft.tls}
                    checked={draft.tlsVerify === 'insecure'}
                    onChange={(e) => set('tlsVerify', e.target.checked ? 'insecure' : 'strict')}
                  />{' '}
                  Do not verify certificate
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!draft.autoConnect}
                    onChange={(e) => set('autoConnect', e.target.checked)}
                  />{' '}
                  Auto-connect at startup
                </label>
              </div>
              <Field label="Login template" hint="{name} and {password} are substituted">
                <input
                  value={login.template}
                  onChange={(e) => set('login', { ...login, template: e.target.value })}
                />
              </Field>
              <Field label="Character name">
                <input
                  value={login.charName ?? ''}
                  onChange={(e) => set('login', { ...login, charName: e.target.value })}
                />
              </Field>
              <Field
                label="Password"
                hint={
                  login.hasPassword
                    ? 'A password is stored. Type to replace it.'
                    : 'Stored in the OS keychain.'
                }
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="Notes">
                <input
                  value={draft.notes ?? ''}
                  onChange={(e) => set('notes', e.target.value || undefined)}
                />
              </Field>
              {err && (
                <p role="alert" className="err wide">
                  {err}
                </p>
              )}
              <div className="actions wide">
                {draft.id && (
                  <button type="button" className="danger" onClick={() => void remove()}>
                    Delete
                  </button>
                )}
                <span className="grow" />
                {draft.id && (
                  <button type="button" onClick={() => void connect(draft)}>
                    Connect
                  </button>
                )}
                <button type="submit" className="primary">
                  Save
                </button>
              </div>
            </form>
          ) : (
            <p className="hint">Select a world to edit, double-click to connect, or add a new one.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
