import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { useUi } from '../../state/stores';

/** About SquatClient: the same dialog on every platform (the native macOS About panel is not used). */
export function AboutDialog() {
  const engine = useUi((s) => s.engine);
  const [version, setVersion] = useState('');
  useEffect(() => {
    void engine
      ?.appVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, [engine]);
  const close = (): void => useUi.getState().openDialog(null);
  return (
    <Dialog title="About SquatClient" onClose={close}>
      <div className="about">
        <h2>SquatClient{version ? ` ${version}` : ''}</h2>
        <p>A graphical client for MUDs, MUSHes and other MU* games.</p>
        <p>
          Free software, licensed GPL-3.0-or-later. Its scripting language is inspired by TinyFugue by Ken
          Keys.
        </p>
        <p className="dim">Source: github.com/itsnotyoutoday/squatclient</p>
        <div className="actions">
          <button type="button" className="primary" onClick={close} data-autofocus>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
