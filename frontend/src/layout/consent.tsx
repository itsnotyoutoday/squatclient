import { useState } from 'react';
import type { LayoutBundle } from '../api/types';
import { useUi } from '../state/stores';

/**
 * A layout is code that runs in the window with the app's full powers (it can send input to a game, read
 * the scrollback, change worlds). The first time a layout file loads, and whenever its contents change,
 * the user is asked; the app's own layouts and layouts saved from the app's editor are not asked about.
 */
export function LayoutConsent({ bundle, onUseClassic }: { bundle: LayoutBundle; onUseClassic(): void }) {
  const engine = useUi((s) => s.engine);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const allow = async (): Promise<void> => {
    try {
      await engine?.allowLayout(bundle.id, bundle.hash, true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="lay-consent" role="alertdialog" aria-label={`Allow the layout ${bundle.id}?`}>
      <p>
        The layout <strong>{bundle.id}</strong> is code that runs in this window and can send input to your
        games. Allow it only if you wrote it or trust whoever did.{' '}
        <span className="dim">(content {bundle.hash.slice(0, 10)})</span>
      </p>
      <div className="lay-consent-actions">
        <button type="button" onClick={() => setShow(!show)}>
          {show ? 'Hide source' : 'View source'}
        </button>
        <button type="button" className="primary" onClick={() => void allow()}>
          Allow and use
        </button>
        <button type="button" onClick={onUseClassic}>
          Use classic
        </button>
      </div>
      {err && <p role="alert">{err}</p>}
      {show && <pre className="lay-consent-source">{bundle.source}</pre>}
    </div>
  );
}
