import { useState } from 'react';
import type { FormEvent } from 'react';
import { useUi } from '../../state/stores';
import { Dialog, Field } from './Dialog';

export function QuickConnect() {
  const engine = useUi((s) => s.engine);
  const close = (): void => useUi.getState().openDialog(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4201');
  const [tls, setTls] = useState(false);
  const [err, setErr] = useState('');
  const portNum = Number(port);
  const valid = host.trim() !== '' && Number.isInteger(portNum) && portNum > 0 && portNum < 65536;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!engine || !valid) return;
    try {
      await engine.connect({ host: host.trim(), port: portNum, tls });
      close();
    } catch (x) {
      setErr(String(x));
    }
  };

  return (
    <Dialog title="Quick connect" onClose={close}>
      <form onSubmit={(e) => void submit(e)} className="form">
        <Field label="Host">
          <input
            data-autofocus
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="mush.example.com"
          />
        </Field>
        <Field label="Port">
          <input value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value)} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} /> Use TLS
        </label>
        {err && (
          <p role="alert" className="err">
            {err}
          </p>
        )}
        <div className="actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            Connect
          </button>
        </div>
      </form>
    </Dialog>
  );
}
