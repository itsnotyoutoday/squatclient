import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog } from './Dialog';
import { useSessions, useSettings, useUi } from '../../state/stores';
import { buildReport, gatherDiagnostics } from '../../lib/diagnostics';
import type { DiagData } from '../../lib/diagnostics';
import { useHelp } from '../../help/store';

/** Fallback when neither the native bridge nor the web clipboard works: select and copy. */
function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

/** Help > Diagnostics: a plain-text report testers can copy or save and send to us. */
export function DiagnosticsDialog() {
  const engine = useUi((s) => s.engine);
  const [data, setData] = useState<DiagData | null>(null);
  const [include, setInclude] = useState(false);
  const [note, setNote] = useState('');
  const close = (): void => useUi.getState().openDialog(null);

  const refresh = useCallback(async () => {
    setNote('');
    const ui = useUi.getState();
    const sessions = useSessions.getState();
    const d = await gatherDiagnostics({
      engine,
      settings: useSettings.getState().settings,
      squatters: ui.squatters,
      sessions: sessions.order.map((id) => sessions.sessions[id]).filter(Boolean),
      appVersion: await engine?.appVersion().catch(() => ''),
    });
    setData(d);
  }, [engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const text = useMemo(
    () => (data ? buildReport(data, { includeHostnames: include }) : 'Collecting...'),
    [data, include],
  );

  const copy = async (): Promise<void> => {
    try {
      if (engine) await engine.copyText(text);
      else throw new Error('no engine');
      setNote('Copied to the clipboard.');
      return;
    } catch {
      /* try the web clipboard */
    }
    try {
      await navigator.clipboard.writeText(text);
      setNote('Copied to the clipboard.');
    } catch {
      setNote(
        legacyCopy(text)
          ? 'Copied to the clipboard.'
          : 'Could not copy: select the text and copy it by hand.',
      );
    }
  };

  const save = async (): Promise<void> => {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    try {
      const path = (await engine?.saveTextFile(`squatclient-diagnostics-${stamp}.txt`, text)) ?? '';
      setNote(path ? `Saved to ${path}` : 'Save cancelled.');
    } catch (e) {
      setNote(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Dialog
      title="Diagnostics"
      onClose={close}
      wide
      footer={
        <div className="actions diag-actions">
          <label className="diag-host">
            <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} /> Include
            hostnames
          </label>
          <span className="diag-note" role="status" aria-live="polite">
            {note}
          </span>
          <button type="button" onClick={() => void refresh()}>
            Refresh
          </button>
          <button type="button" onClick={() => void copy()} data-autofocus>
            Copy
          </button>
          <button type="button" onClick={() => void save()}>
            Save as file...
          </button>
          <button
            type="button"
            onClick={() => {
              useHelp.getState().go({ kind: 'topic', id: 'diagnostics' });
              useUi.getState().openDialog('help');
            }}
          >
            Help
          </button>
          <button type="button" className="primary" onClick={close}>
            Close
          </button>
        </div>
      }
    >
      <p className="dim diag-intro">
        Send this to whoever is helping you. It holds no passwords, keys or tokens; hostnames are left out
        unless you tick the box.
      </p>
      <textarea
        className="diag-report"
        readOnly
        spellCheck={false}
        aria-label="Diagnostics report"
        value={text}
        wrap="off"
      />
    </Dialog>
  );
}
