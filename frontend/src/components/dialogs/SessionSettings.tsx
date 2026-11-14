import { useState } from 'react';
import type { FormEvent } from 'react';
import { Dialog } from './Dialog';
import { useSessions, useUi } from '../../state/stores';
import { GAME_TYPES } from '../../lib/modules';
import { squatterLabel } from '../../lib/tfcontrol';
import type { WorldConfig } from '../../api/types';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="sset-row">
    <span className="sset-label">{label}</span>
    <span className="sset-value">{children}</span>
  </div>
);

/**
 * Settings of ONE connection (the tab's): what it is connected to, the game type, saving a quick
 * connect as a world, and, once it has ended, the route to reconnect through. The connection
 * itself (host, port, TLS, encoding and the squatter route) is locked while it is live: change it
 * in Worlds, or disconnect first. The application's own settings are in Settings.
 */
export function SessionSettings() {
  const engine = useUi((s) => s.engine);
  const sid = useUi((s) => s.sessionDialog);
  const squatters = useUi((s) => s.squatters);
  const worlds = useUi((s) => s.worlds);
  const s = useSessions((st) => (sid ? st.sessions[sid] : undefined));
  const [name, setName] = useState(s?.name ?? '');
  const [route, setRoute] = useState(s?.via ?? 'direct');
  const [msg, setMsg] = useState('');
  const close = (): void => useUi.getState().openDialog(null);

  if (!s || !engine) {
    return (
      <Dialog title="Connection settings" onClose={close}>
        <p>This connection is gone.</p>
      </Dialog>
    );
  }
  const live = s.state !== 'ended';
  const routeName = (via: string): string => {
    if (via === 'direct') return 'Direct';
    const q = squatters.find((x) => x.id === via);
    return q ? squatterLabel(q) : `Squatter: ${via}`;
  };
  const world = s.worldId ? worlds.find((w) => w.id === s.worldId) : undefined;
  const fail = (e: unknown): void => setMsg(e instanceof Error ? e.message : String(e));

  const saveAsWorld = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const nm = name.trim();
    if (!nm) return setMsg('Give the world a name.');
    try {
      const w: WorldConfig = {
        id: '',
        name: nm,
        host: s.host,
        port: s.port,
        tls: s.tls,
        tlsVerify: s.tlsVerify === 'insecure' ? 'insecure' : 'strict',
        encoding: s.encoding === 'latin1' ? 'latin1' : 'utf-8',
        via: s.via || 'direct',
        ...(s.gameType && s.gameTypeSource !== 'banner' && s.gameTypeSource !== 'probe'
          ? { gameType: s.gameType }
          : {}),
      };
      const saved = await engine.saveWorld(w);
      await engine.setSessionWorld(s.id, saved.id);
      useUi.getState().setWorlds(await engine.listWorlds());
      useUi.getState().toast('info', `Saved ${saved.name} to your worlds.`);
      setMsg('');
    } catch (x) {
      fail(x);
    }
  };

  const reconnect = async (): Promise<void> => {
    try {
      if (s.worldId) await engine.connect({ worldId: s.worldId });
      else
        await engine.connect({
          host: s.host,
          port: s.port,
          tls: s.tls,
          name: s.name,
          ...(s.tlsVerify ? { tlsVerify: s.tlsVerify } : {}),
          ...(s.encoding ? { encoding: s.encoding } : {}),
          via: route,
        });
      close();
    } catch (x) {
      fail(x);
    }
  };

  const lock = (
    <span className="sset-lock" title="Locked while connected" aria-label="locked">
      &#128274;
    </span>
  );

  return (
    <Dialog title="Connection settings" onClose={close}>
      <div className="sset">
        <h3>{s.name}</h3>
        <fieldset>
          <legend>Connection {live && lock}</legend>
          <Row label="Host">
            {s.host}:{s.port}
          </Row>
          <Row label="TLS">
            {s.tls ? (s.tlsVerify === 'insecure' ? 'on, certificate not verified' : 'on') : 'off'}
          </Row>
          <Row label="Encoding">{s.encoding === 'latin1' ? 'Latin-1' : 'UTF-8'}</Row>
          <Row label="Route">
            {live || s.worldId ? (
              routeName(s.via || 'direct')
            ) : (
              <select aria-label="Route" value={route} onChange={(e) => setRoute(e.target.value)}>
                <option value="direct">Direct</option>
                {squatters.map((q) => (
                  <option key={q.id} value={q.id}>
                    {squatterLabel(q)}
                  </option>
                ))}
              </select>
            )}
          </Row>
          {live ? (
            <p className="dim">
              The connection is fixed while it is open, including how it reaches the game (direct or through a
              squatter). To change it, {s.worldId ? 'edit the world' : 'save it as a world'} and reconnect, or
              disconnect this tab first.
            </p>
          ) : s.worldId ? (
            <p className="dim">This connection belongs to a world: its route is part of the world.</p>
          ) : (
            <p className="dim">This connection has ended. Pick a route and reconnect.</p>
          )}
        </fieldset>

        <fieldset>
          <legend>Game</legend>
          <Row label="Game type">
            <select
              aria-label="Game type"
              value={s.gameTypeSource === 'user' || s.gameTypeSource === 'world' ? (s.gameType ?? '') : ''}
              onChange={(e) => void engine.setGameType(s.id, e.target.value).catch(fail)}
            >
              <option value="">
                {s.gameType
                  ? `Detected: ${GAME_TYPES.find((g) => g.type === s.gameType)?.name ?? s.gameType}`
                  : 'Not detected yet'}
              </option>
              {GAME_TYPES.map((g) => (
                <option key={g.type} value={g.type}>
                  {g.name}
                </option>
              ))}
              <option value="other">Something else</option>
            </select>
          </Row>
          <p className="dim">
            Decides which tools apply (the Object Editor is for MU* games). Changing it affects this
            connection only; a world's own setting is in Worlds.
          </p>
        </fieldset>

        {!s.worldId && (
          <form onSubmit={(e) => void saveAsWorld(e)}>
            <fieldset>
              <legend>Save as world</legend>
              <p className="dim">
                Keeps this connection in your world list so you can open it again by name.
              </p>
              <label>
                Name <input aria-label="World name" value={name} onChange={(e) => setName(e.target.value)} />
              </label>{' '}
              <button type="submit" className="primary">
                Save as world
              </button>
            </fieldset>
          </form>
        )}
        {world && (
          <p>
            <button
              type="button"
              onClick={() => {
                useUi.getState().setEditWorld(world.id);
                useUi.getState().openDialog('worlds');
              }}
            >
              Edit world {world.name}...
            </button>
          </p>
        )}
        {msg && (
          <p role="alert" className="err">
            {msg}
          </p>
        )}
        <div className="actions">
          {!live && (
            <button type="button" className="primary" onClick={() => void reconnect()}>
              Reconnect
            </button>
          )}
          <button type="button" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
