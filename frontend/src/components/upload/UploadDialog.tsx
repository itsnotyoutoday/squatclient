import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../dialogs/Dialog';
import { checkBalance } from '../../lib/mushcode';
import { sendBlock } from '../../lib/blocksender';
import type { BlockProgress, BlockSend } from '../../lib/blocksender';
import { splitLines } from '../../lib/softcode';
import { humanBytes } from '../../lib/upload/decode';
import { prepareUpload } from '../../lib/upload/prepare';
import { useUpload } from '../../lib/upload/store';
import type { UploadTarget } from '../../lib/upload/store';
import { recordHistory } from '../../state/history';
import { useSessions, useSettings, useUi } from '../../state/stores';
import { FileDrop } from './FileDrop';
import { VirtualLines } from './VirtualLines';
import '../../styles/upload.css';

const DEFAULT_DELAY = 50;
const BATCH = 200;
const MAX_PROBLEMS_SHOWN = 5;

type Phase = 'ready' | 'sending' | 'done';
interface Summary {
  sent: number;
  total: number;
  cancelled: boolean;
  skipped: number;
  error: string;
  ms: number;
}

const fmtTime = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};
const clip = (s: string, n = 90): string => (s.length > n ? `${s.slice(0, n)}...` : s);

export function UploadDialog({ target, onClose }: { target: UploadTarget; onClose(): void }) {
  const { file, sessionId } = target;
  const engine = useUi((s) => s.engine);
  const settings = useSettings((s) => s.settings);
  const session = useSessions((s) => s.sessions[sessionId]);

  const [join, setJoin] = useState(settings.softcodeJoin);
  const [strip, setStrip] = useState(settings.stripBlankLines);
  const [delay, setDelay] = useState(settings.sendLineDelayMs || DEFAULT_DELAY);
  const [prefix, setPrefix] = useState('');
  const [view, setView] = useState<'file' | 'prepared'>('file');
  const [phase, setPhase] = useState<Phase>('ready');
  const [progress, setProgress] = useState<BlockProgress>({ sent: 0, total: 0 });
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);

  const block = useRef<BlockSend | null>(null);
  const prog = useRef<BlockProgress>({ sent: 0, total: 0 });
  const t0 = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const failure = useRef('');
  const alive = useRef(true);

  const fileLines = useMemo(() => {
    const l = splitLines(file.text);
    if (l.length > 0 && l[l.length - 1] === '') l.pop();
    return l;
  }, [file.text]);
  const prepared = useMemo(
    () => prepareUpload(file.text, { join, stripBlank: strip, prefix, suffix: '' }),
    [file.text, join, strip, prefix],
  );
  const issues = useMemo(
    () => (prepared.lines.length === 0 ? [] : checkBalance(prepared.lines.join('\n'), { mode: 'code' })),
    [prepared.lines],
  );

  const stopTicker = (): void => {
    if (ticker.current !== undefined) clearInterval(ticker.current);
    ticker.current = undefined;
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      block.current?.cancel();
      stopTicker();
    };
  }, []);

  const connected = session?.state === 'connected';
  const total = prepared.lines.length;
  const warn = settings.warnUnbalanced && issues.length > 0;
  const canSend = phase === 'ready' && !!engine && connected && total > 0;

  const start = (): void => {
    if (!canSend || !engine) return;
    const sid = sessionId;
    const lines = prepared.lines;
    recordHistory(engine, sid, `/upload ${file.name}`); // one entry, never the whole file
    failure.current = '';
    prog.current = { sent: 0, total: lines.length };
    t0.current = Date.now();
    setProgress(prog.current);
    setElapsed(0);
    setPaused(false);
    setPhase('sending');
    ticker.current = setInterval(() => {
      setProgress({ ...prog.current });
      setElapsed(Date.now() - t0.current);
    }, 100);
    let b: BlockSend | null = null;
    const send = (l: string): void => {
      const fail = (e: unknown): void => {
        failure.current ||= e instanceof Error ? e.message : String(e);
        b?.cancel();
      };
      try {
        engine.input(sid, l).catch(fail);
      } catch (e) {
        fail(e);
        throw e;
      }
    };
    b = sendBlock(lines, delay, send, (p) => (prog.current = p), { batch: BATCH });
    block.current = b;
    void b.done.then((r) => {
      stopTicker();
      if (block.current === b) block.current = null;
      if (!alive.current) return;
      setProgress({ sent: r.sent, total: r.total });
      setElapsed(Date.now() - t0.current);
      setSummary({ ...r, skipped: prepared.stripped, error: failure.current, ms: Date.now() - t0.current });
      setPaused(false);
      setPhase('done');
    });
  };

  const togglePause = (): void => {
    const b = block.current;
    if (!b) return;
    if (b.paused) b.resume();
    else b.pause();
    setPaused(b.paused);
  };

  const close = (): void => {
    if (phase === 'sending') {
      const b = block.current;
      b?.cancel();
      if (b)
        useUi
          .getState()
          .toast('info', `Upload cancelled after ${prog.current.sent} of ${prog.current.total} commands`);
    }
    onClose();
  };

  const sending = phase === 'sending';
  const pct = progress.total ? Math.round((progress.sent / progress.total) * 100) : 0;
  const lastSent = progress.sent > 0 ? (prepared.lines[progress.sent - 1] ?? '') : '';

  const footer =
    phase === 'ready' ? (
      <>
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={!canSend} onClick={start}>
          {warn ? 'Send anyway' : 'Send'}
        </button>
      </>
    ) : phase === 'sending' ? (
      <>
        <button type="button" onClick={togglePause}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" onClick={() => block.current?.cancel()}>
          Cancel
        </button>
      </>
    ) : (
      <button type="button" className="primary" onClick={close} data-autofocus>
        Close
      </button>
    );

  return (
    <Dialog title={`Upload ${file.name}`} onClose={close} wide footer={footer}>
      <div className="cw-upload">
        <p className="cw-meta" aria-label="File details">
          <strong>{file.name}</strong> &middot; {humanBytes(file.size)} &middot; {fileLines.length}{' '}
          {fileLines.length === 1 ? 'line' : 'lines'} &middot;{' '}
          {file.encoding === 'latin1' ? 'Latin-1' : 'UTF-8'}
        </p>

        <div className="cw-tabs" role="tablist" aria-label="Preview">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'file'}
            className={view === 'file' ? 'cw-on' : ''}
            onClick={() => setView('file')}
          >
            File
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'prepared'}
            className={view === 'prepared' ? 'cw-on' : ''}
            onClick={() => setView('prepared')}
          >
            To be sent ({total})
          </button>
        </div>
        {view === 'file' ? (
          <VirtualLines key="file" lines={fileLines} ariaLabel="File preview" />
        ) : (
          <VirtualLines key="prepared" lines={prepared.lines} ariaLabel="Prepared commands preview" />
        )}

        <p className="cw-count" role="status" aria-label="Prepared result">
          {total === 0
            ? 'Nothing to send: the file has no commands after the rules below.'
            : `${total} ${total === 1 ? 'command' : 'commands'} will be sent` +
              (prepared.joined
                ? `, ${prepared.joined} continuation ${prepared.joined === 1 ? 'line' : 'lines'} joined`
                : '') +
              (prepared.stripped
                ? `, ${prepared.stripped} blank/comment ${prepared.stripped === 1 ? 'line' : 'lines'} skipped`
                : '') +
              '.'}
        </p>

        <fieldset className="cw-opts" disabled={phase !== 'ready'}>
          <legend>Options</legend>
          <label className="cw-check">
            <input type="checkbox" checked={join} onChange={(e) => setJoin(e.target.checked)} /> Join
            continuation lines
          </label>
          <label className="cw-check">
            <input type="checkbox" checked={strip} onChange={(e) => setStrip(e.target.checked)} /> Skip blank
            and @@ comment lines
          </label>
          <label className="cw-field">
            Delay per line (ms)
            <input
              type="number"
              min={0}
              max={10000}
              step={10}
              value={delay}
              onChange={(e) =>
                setDelay(Math.min(10000, Math.max(0, Math.floor(Number(e.target.value)) || 0)))
              }
            />
          </label>
          <label className="cw-field">
            Prefix for every command
            <input
              type="text"
              value={prefix}
              spellCheck={false}
              placeholder="(none)"
              onChange={(e) => setPrefix(e.target.value)}
            />
          </label>
        </fieldset>

        <p className="cw-target" aria-label="Target session">
          Send to: <strong>{session ? session.name : 'no session'}</strong>
          {session && !connected && <span className="cw-bad"> (not connected)</span>}
          {!session && <span className="cw-bad"> (the session is gone)</span>}
          {delay > 0 && total > 1 && phase === 'ready' && (
            <span className="cw-dim">
              {' '}
              &middot; about {fmtTime((total - 1) * delay)} at {delay} ms per line
            </span>
          )}
        </p>

        {issues.length > 0 && phase === 'ready' && (
          <div className="cw-warn" role="alert">
            <strong>
              {issues.length} bracket {issues.length === 1 ? 'problem' : 'problems'} in the code to be sent.
            </strong>
            <ul>
              {issues.slice(0, MAX_PROBLEMS_SHOWN).map((i, k) => (
                <li key={k}>
                  Command {i.line}: {i.message}
                </li>
              ))}
            </ul>
            {issues.length > MAX_PROBLEMS_SHOWN && (
              <span>and {issues.length - MAX_PROBLEMS_SHOWN} more.</span>
            )}
          </div>
        )}

        {(sending || phase === 'done') && (
          <div className="cw-progress" role="status" aria-label="Upload progress">
            <progress
              value={progress.sent}
              max={Math.max(1, progress.total)}
              aria-label="Upload progress bar"
            />
            <span>
              {paused ? 'Paused: ' : sending ? 'Sending ' : ''}
              {progress.sent}/{progress.total} ({pct}%) &middot; {fmtTime(elapsed)}
            </span>
            {sending && lastSent !== '' && (
              <code className="cw-cur">
                Line {progress.sent}: {clip(lastSent)}
              </code>
            )}
          </div>
        )}

        {summary && (
          <p className="cw-summary" role="status" aria-label="Upload summary">
            {summary.cancelled
              ? `Cancelled at command ${Math.min(summary.sent + 1, summary.total)} of ${summary.total}: ${summary.sent} sent`
              : `Done: sent ${summary.sent} ${summary.sent === 1 ? 'command' : 'commands'}`}
            , {summary.skipped} skipped (blank or comment lines) in {fmtTime(summary.ms)}.
            {summary.error && <span className="cw-bad"> Stopped by an error: {summary.error}</span>}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** Renders the upload dialog while one is open, and the window-wide file drop (mounted once, in App). */
export function UploadHost() {
  const target = useUpload((s) => s.target);
  const close = useUpload((s) => s.close);
  return (
    <>
      <FileDrop />
      {target && (
        <UploadDialog
          key={`${target.sessionId}:${target.file.path}:${target.file.size}`}
          target={target}
          onClose={close}
        />
      )}
    </>
  );
}
