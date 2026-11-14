import { useState } from 'react';
import type { FormEvent } from 'react';
import { useUi } from '../../state/stores';
import type { SquatterKind } from '../../api/types';
import { Dialog, Field } from './Dialog';

export function SquattersDialog() {
  const engine = useUi((s) => s.engine);
  const squatters = useUi((s) => s.squatters);
  const [host, setHost] = useState('');
  const [kind, setKind] = useState<SquatterKind>('squatterd');
  const [port, setPort] = useState('10327');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<{ id: string; fingerprint: string } | null>(null);
  const [err, setErr] = useState('');
  const close = (): void => useUi.getState().openDialog(null);
  const refresh = async (): Promise<void> => {
    if (engine) useUi.getState().setSquatters(await engine.listSquatters());
  };

  const pickKind = (k: SquatterKind): void => {
    // keep a port the user typed; only swap the default of the other kind
    if (port === (kind === 'tf-squatterd' ? '10328' : '10327'))
      setPort(k === 'tf-squatterd' ? '10328' : '10327');
    setKind(k);
  };

  const pair = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!engine) return;
    try {
      setPending(
        await engine.pairSquatter(host.trim(), Number(port), name.trim() || host.trim(), code.trim(), kind),
      );
      setErr('');
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    }
  };

  const confirm = async (accept: boolean): Promise<void> => {
    if (!engine || !pending) return;
    try {
      await engine.confirmSquatter(pending.id, accept);
      setPending(null);
      if (accept) {
        setHost('');
        setName('');
        setCode('');
      }
      await refresh();
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    }
  };

  return (
    <Dialog title="Squatters" onClose={close} wide>
      <h3>Paired squatters</h3>
      {squatters.length === 0 ? (
        <p className="hint">None yet. A squatter keeps your sessions alive while the client is closed.</p>
      ) : (
        <ul className="plain">
          {squatters.map((s) => (
            <li key={s.id} className="rowline">
              <span>
                <strong>{s.name}</strong>{' '}
                <span className="dim">
                  {s.host}:{s.port}
                </span>
                {s.kind === 'tf-squatterd' && (
                  <span className="badge" data-testid={`sqkind-${s.id}`}>
                    TinyFugue{s.role ? ` · ${s.role}` : ''}
                  </span>
                )}
                {!s.paired && <em> (not paired)</em>}
                {s.state && (
                  <span className={`badge sqstate ${s.state}`} data-testid={`sqstate-${s.id}`}>
                    {s.state}
                  </span>
                )}
                {s.message && s.state !== 'connected' && <div className="err">{s.message}</div>}
                {s.kind === 'tf-squatterd' && s.paired && (
                  <label className="dim">
                    Triggers run in{' '}
                    <select
                      aria-label={`Automation for ${s.name}`}
                      value={s.automation ?? 'tf'}
                      onChange={(e) =>
                        void engine
                          ?.setSquatterAutomation(s.id, e.target.value as 'tf' | 'client')
                          .then(refresh)
                          .catch((x: unknown) => setErr(x instanceof Error ? x.message : String(x)))
                      }
                    >
                      <option value="tf">TinyFugue (this app only shows)</option>
                      <option value="client">this app (while connected)</option>
                    </select>
                  </label>
                )}
                {s.fingerprint && <code className="fp">{s.fingerprint}</code>}
              </span>
              {s.kind === 'tf-squatterd' && s.paired && s.state === 'connected' && (
                <button
                  type="button"
                  aria-label={`TinyFugue worlds of ${s.name}`}
                  onClick={() => useUi.getState().openTFWorlds(s.id)}
                >
                  Worlds…
                </button>
              )}
              {s.kind === 'tf-squatterd' && s.paired && s.state === 'connected' && s.role === 'admin' && (
                <button
                  type="button"
                  aria-label={`TinyFugue scripts of ${s.name}`}
                  onClick={() => useUi.getState().openTFScripts(s.id)}
                >
                  Scripts…
                </button>
              )}
              {s.paired && s.state !== 'connected' && s.state !== 'connecting' && s.state !== 'refused' && (
                <button
                  type="button"
                  aria-label={`Reconnect ${s.name}`}
                  onClick={() =>
                    void engine
                      ?.reconnectSquatter(s.id)
                      .then(refresh)
                      .catch((x: unknown) => setErr(x instanceof Error ? x.message : String(x)))
                  }
                >
                  Reconnect
                </button>
              )}
              <button
                type="button"
                className="danger"
                aria-label={`Remove ${s.name}`}
                onClick={() => void engine?.removeSquatter(s.id).then(refresh)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3>Add a squatter</h3>
      {pending ? (
        <div role="group" aria-label="Confirm fingerprint" className="form">
          <p>Confirm this is the fingerprint shown by your squatter (trust on first use):</p>
          <code className="fp big" data-testid="fingerprint">
            {pending.fingerprint}
          </code>
          <div className="actions">
            <button type="button" onClick={() => void confirm(false)}>
              Reject
            </button>
            <button type="button" className="primary" data-autofocus onClick={() => void confirm(true)}>
              Trust and pair
            </button>
          </div>
        </div>
      ) : (
        <form className="form grid" onSubmit={(e) => void pair(e)}>
          <Field label="Type">
            <select aria-label="Type" value={kind} onChange={(e) => pickKind(e.target.value as SquatterKind)}>
              <option value="squatterd">squatterd (stand-alone daemon)</option>
              <option value="tf-squatterd">TinyFugue (/squat pair)</option>
            </select>
          </Field>
          <p className="hint wide">
            {kind === 'tf-squatterd'
              ? 'In TinyFugue run /squat pair and enter the code it shows. You then see and control all of its connections.'
              : 'On the machine running squatterd, run squatterd pair and enter the code it shows.'}
          </p>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Home server" />
          </Field>
          <Field label="Host">
            <input required value={host} onChange={(e) => setHost(e.target.value)} />
          </Field>
          <Field label="Port">
            <input
              required
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </Field>
          <Field label="Pair code">
            <input required value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          </Field>
          <div className="actions wide">
            <button type="submit" className="primary">
              Pair
            </button>
          </div>
        </form>
      )}
      {err && (
        <p role="alert" className="err">
          {err}
        </p>
      )}
    </Dialog>
  );
}
