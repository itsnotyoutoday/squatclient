import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog } from './Dialog';
import { useUi } from '../../state/stores';
import type { DiagStatus } from '../../api/types';
import { useHelp } from '../../help/store';
import {
  STEP_TITLES,
  WIZARD_STEPS,
  buildIssueUrl,
  canAdvance,
  formatBytes,
  initialWizard,
  issuesUrl,
  privateDeliveryText,
  stepNumber,
  wizardBack,
  wizardNext,
  wizardSetIncluded,
} from '../../lib/diaglog';
import type { WizardState } from '../../lib/diaglog';

type View = 'main' | 'view' | 'wizard';

/** Help > Send Diagnostics Log...: the log's status and switch, an in-app viewer, and a four-step walkthrough that saves a redacted zip and opens the GitHub issue form. Nothing is uploaded. */
export function DiagLogDialog() {
  const engine = useUi((s) => s.engine);
  const close = (): void => useUi.getState().openDialog(null);
  const [view, setView] = useState<View>('main');
  const [status, setStatus] = useState<DiagStatus | null>(null);
  const [msg, setMsg] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    if (!engine) return;
    try {
      setStatus(await engine.diagStatus());
    } catch (e) {
      setMsg(`Could not read the log state: ${String(e)}`);
    }
  }, [engine]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const info = status?.info;
  const logging = status?.log.enabled ?? false;

  const toggle = async (): Promise<void> => {
    if (!engine) return;
    try {
      await engine.diagSetEnabled(!logging);
      setMsg(!logging ? 'Diagnostics logging is on.' : 'Diagnostics logging is off. Nothing more is recorded until you turn it on again.');
    } catch (e) {
      setMsg(String(e));
    }
    await refresh();
  };
  const clear = async (): Promise<void> => {
    if (!engine) return;
    setConfirmClear(false);
    try {
      await engine.diagClear();
      setMsg('All diagnostics logs were deleted.');
    } catch (e) {
      setMsg(String(e));
    }
    await refresh();
  };

  const footer = (
    <div className="actions diag-actions">
      <span className="diag-note" role="status" aria-live="polite">
        {msg}
      </span>
      <button
        type="button"
        onClick={() => {
          useHelp.getState().go({ kind: 'topic', id: 'diagnostics' });
          useUi.getState().openDialog('help');
        }}
      >
        Help
      </button>
      <button type="button" className="primary" onClick={close} data-autofocus>
        Close
      </button>
    </div>
  );

  if (view === 'view') return <LogViewer onBack={() => setView('main')} footer={footer} />;
  if (view === 'wizard' && status) return <Wizard status={status} onBack={() => { setView('main'); void refresh(); }} footer={footer} />;

  return (
    <Dialog title="Send Diagnostics Log" onClose={close} wide footer={footer}>
      <p className="dim diag-intro">
        SquatClient keeps a log of what it does (connections, sounds, packs, settings, errors). It stays on this computer. If something goes wrong, you can pack
        it into a zip and attach it to a bug report. Nothing is ever uploaded by the app.
      </p>
      {status ? (
        <div className="diaglog-box" aria-label="Diagnostics log status">
          <p>
            <strong>Logging is {logging ? 'ON' : 'OFF'}.</strong>{' '}
            {info?.mode === 'always' && 'This is an alpha build: it logs from the first start unless you turn it off here.'}
            {info?.mode === 'optin' && 'It stays off until you turn it on.'}
          </p>
          <table className="diaglog-sizes">
            <tbody>
              {status.log.sessions.length === 0 && (
                <tr>
                  <td colSpan={3}>No log on disk.</td>
                </tr>
              )}
              {status.log.sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.current ? 'This session' : 'Previous session'}</td>
                  <td>{formatBytes(s.bytes)}</td>
                  <td className="dim">{s.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="dim">
            Only this session and the one before are kept, up to {formatBytes(status.log.budget)} together. {status.redactions} secrets were removed from the log
            as it was written.
          </p>
        </div>
      ) : (
        <p>Reading the log state...</p>
      )}
      <div className="actions diaglog-actions">
        <button type="button" className="primary" onClick={() => setView('wizard')} disabled={!status || status.log.sessions.length === 0}>
          Send...
        </button>
        <button type="button" onClick={() => setView('view')} disabled={!status || status.log.sessions.length === 0}>
          View log
        </button>
        <button type="button" onClick={() => void toggle()} disabled={!status}>
          {logging ? 'Turn diagnostics off' : 'Turn diagnostics on'}
        </button>
        <button type="button" onClick={() => void engine?.diagSnapshot().then(() => setMsg('A state snapshot was written to the log.'))} disabled={!logging}>
          Snapshot now
        </button>
        {confirmClear ? (
          <span role="alertdialog" aria-label="Confirm clearing the logs">
            Delete all logs?{' '}
            <button type="button" onClick={() => void clear()}>
              Yes, delete them
            </button>{' '}
            <button type="button" onClick={() => setConfirmClear(false)}>
              No
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmClear(true)} disabled={!status || status.log.sessions.length === 0}>
            Clear logs...
          </button>
        )}
      </div>
    </Dialog>
  );
}

/** The in-app viewer: the tail of this session's log with a search box. */
function LogViewer({ onBack, footer }: { onBack(): void; footer: React.ReactNode }) {
  const engine = useUi((s) => s.engine);
  const [filter, setFilter] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const load = useCallback(async () => {
    if (!engine) return;
    try {
      setLines(await engine.diagView(500, filter));
    } catch (e) {
      setLines([`Could not read the log: ${String(e)}`]);
    }
  }, [engine, filter]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 150);
    return () => clearTimeout(t);
  }, [load]);
  return (
    <Dialog title="Send Diagnostics Log" onClose={() => useUi.getState().openDialog(null)} wide footer={footer}>
      <div className="actions diaglog-actions">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <input type="search" aria-label="Search the log" placeholder="Search (case-insensitive)" value={filter} onChange={(e) => setFilter(e.target.value)} data-autofocus />
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <textarea className="diag-report" readOnly spellCheck={false} wrap="off" aria-label="Diagnostics log, newest lines last" value={lines.join('\n')} />
      <p className="dim">Showing the last {lines.length} matching lines of this session. The log can contain text the game sent you.</p>
    </Dialog>
  );
}

function Wizard({ status, onBack, footer }: { status: DiagStatus; onBack(): void; footer: React.ReactNode }) {
  const engine = useUi((s) => s.engine);
  const [w, setW] = useState<WizardState>(initialWizard);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const info = status.info;
  const sessions = status.log.sessions.filter((s) => !w.currentOnly || s.current);
  const total = useMemo(() => sessions.reduce((n, s) => n + s.bytes, 0), [sessions]);

  const save = async (saveAs: boolean): Promise<void> => {
    if (!engine) return;
    setBusy(true);
    setErr('');
    try {
      const r = await engine.diagBuildZip({ currentOnly: w.currentOnly, note: w.note, dest: '' }, saveAs);
      if (r) setW((x) => ({ ...x, zip: { path: r.path, size: r.size } }));
    } catch (e) {
      setErr(`Could not save the zip: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const openForm = async (): Promise<void> => {
    if (!engine) return;
    setErr('');
    try {
      const errors = await engine.diagSummary().catch(() => [] as string[]);
      const url = buildIssueUrl({ repoSlug: info.repoSlug, build: info.build, os: info.os, arch: info.arch, mode: info.mode, errors, note: w.note });
      await engine.diagOpenUrl(url);
      setW((x) => ({ ...x, issueOpened: true }));
    } catch (e) {
      setErr(`Could not open the browser: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Dialog
      title="Send Diagnostics Log"
      onClose={() => useUi.getState().openDialog(null)}
      wide
      footer={
        <div className="actions diag-actions">
          {footer}
          <button type="button" onClick={() => (w.step === 'included' ? onBack() : setW(wizardBack(w)))}>
            Back
          </button>
          {w.step !== 'done' && (
            <button type="button" className="primary" disabled={!canAdvance(w)} onClick={() => setW(wizardNext(w))}>
              Next
            </button>
          )}
        </div>
      }
    >
      <ol className="diaglog-steps" aria-label="Steps">
        {WIZARD_STEPS.map((s) => (
          <li key={s} aria-current={s === w.step ? 'step' : undefined} className={s === w.step ? 'on' : ''}>
            {stepNumber(s)}. {STEP_TITLES[s]}
          </li>
        ))}
      </ol>
      {err && (
        <p role="alert" className="err">
          {err}
        </p>
      )}

      {w.step === 'included' && (
        <section aria-label={STEP_TITLES.included}>
          <p>The zip will contain:</p>
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                {s.current ? 'This session' : 'The previous session'}: {formatBytes(s.bytes)} ({s.segments} file{s.segments === 1 ? '' : 's'})
              </li>
            ))}
            <li>Your build, operating system and settings summary (no passwords).</li>
            <li>Your note, if you write one below.</li>
          </ul>
          <p>
            About {formatBytes(total)} before compression. {status.redactions} secrets (passwords, pairing codes, keys, tokens) were removed from the log.
          </p>
          <p className="diaglog-warn" role="note">
            <strong>Check it before you share it.</strong> The log can contain text the game sent you (room descriptions, chat, mail). Only secrets of your own are
            removed, not what other people said.
          </p>
          <label className="check">
            <input type="checkbox" checked={w.currentOnly} onChange={(e) => setW(wizardSetIncluded(w, { currentOnly: e.target.checked }))} /> Current session only
          </label>
          <label className="diaglog-note">
            Add a note (optional)
            <textarea aria-label="Add a note" rows={3} value={w.note} onChange={(e) => setW(wizardSetIncluded(w, { note: e.target.value }))} placeholder="What were you doing when it went wrong?" />
          </label>
        </section>
      )}

      {w.step === 'save' && (
        <section aria-label={STEP_TITLES.save}>
          <p>SquatClient builds the zip on this computer and saves it for you. Nothing is sent anywhere.</p>
          <div className="actions diaglog-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void save(false)}>
              Save to Downloads
            </button>
            <button type="button" disabled={busy} onClick={() => void save(true)}>
              Save as...
            </button>
          </div>
          {w.zip && (
            <div className="diaglog-box" role="status">
              <p>
                Saved: <code>{w.zip.path}</code> ({formatBytes(w.zip.size)})
              </p>
              <button type="button" onClick={() => void engine?.diagReveal(w.zip!.path).catch((e: unknown) => setErr(String(e)))}>
                Show in folder
              </button>
            </div>
          )}
        </section>
      )}

      {w.step === 'tell' && (
        <section aria-label={STEP_TITLES.tell}>
          <div className="actions diaglog-actions">
            <button type="button" className="primary" onClick={() => void openForm()}>
              Open GitHub issue form
            </button>
          </div>
          <p className="dim">The form opens in your browser with the title, build, system, a short summary and your note already filled in. The log itself is not part of the address.</p>
          <ol>
            <li>Describe the problem in the form.</li>
            <li>Drag the zip you just saved{w.zip ? ` (${w.zip.path.split(/[\\/]/).pop()})` : ''} into the box for the diagnostics log.</li>
            <li>Press &ldquo;Submit new issue&rdquo;.</li>
          </ol>
          <p className="diaglog-warn" role="note">
            <strong>A GitHub issue on this project is public.</strong> Anyone can read it and the files attached to it. If the log may hold anything private, do not attach it.
          </p>
          <p>{privateDeliveryText(info)}</p>
          <button type="button" onClick={() => useUi.getState().openQuick(info.contactHost, info.contactPort)}>
            Connect to {info.contactHost} {info.contactPort}...
          </button>
        </section>
      )}

      {w.step === 'done' && (
        <section aria-label={STEP_TITLES.done}>
          <p>That is all. You can keep the saved zip in case you are asked for it, or delete it now.</p>
          <div className="actions diaglog-actions">
            <button
              type="button"
              disabled={!w.zip}
              onClick={() =>
                void engine
                  ?.diagDeleteZip(w.zip!.path)
                  .then(() => setW((x) => ({ ...x, zip: null })))
                  .catch((e: unknown) => setErr(String(e)))
              }
            >
              Done: delete the saved zip
            </button>
            <button type="button" onClick={() => void engine?.diagOpenUrl(issuesUrl(info.repoSlug))}>
              Open the issue list
            </button>
          </div>
          {!w.zip && <p className="dim">The saved zip is gone.</p>}
        </section>
      )}
    </Dialog>
  );
}
