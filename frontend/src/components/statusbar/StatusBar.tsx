import { useSessions, useSettings, useUi } from '../../state/stores';
import { formatClock } from '../../lib/humanize';
import { PRESETS, automationLabel, clientActive, currentPreset, describeControl, inputLabel } from '../../lib/tfcontrol';
import type { TFPreset } from '../../api/types';

const STATE_LABEL = { connecting: 'Connecting', connected: 'Connected', ended: 'Ended' } as const;
const LINK_LABEL = {
  attached: 'Attached',
  detached: 'Detached',
  unreachable: 'Squatter unreachable',
} as const;

export function StatusBar() {
  const fg = useSessions((s) => s.fg);
  const sessions = useSessions((s) => s.sessions);
  const status = useSessions((s) => (fg ? s.status[fg] : undefined));
  const paused = useSessions((s) => (fg ? s.paused[fg] : undefined));
  const now = useUi((s) => s.now);
  const suspended = useUi((s) => s.suspended);
  const engine = useUi((s) => s.engine);
  const cur = fg ? sessions[fg] : undefined;
  const timestamps = useSettings((s) => s.settings.timestamps);
  const toggleTimestamps = (): void => {
    const next = { ...useSettings.getState().settings, timestamps: !timestamps };
    useSettings.getState().set(next);
    void engine?.saveSettings(next).catch((e: unknown) => useUi.getState().toast('error', String(e instanceof Error ? e.message : e)));
  };
  const preset = (p: TFPreset): void => {
    if (!cur || !engine) return;
    void engine.controlPreset(cur.id, p).catch((e: unknown) => useUi.getState().toast('error', String(e instanceof Error ? e.message : e)));
  };
  const activity = Object.values(sessions).filter((s) => s.id !== fg && s.unread > 0).length;

  return (
    <footer className="statusbar" role="status" aria-label="Status">
      <span className="seg world">{cur ? cur.name : 'No session'}</span>
      {cur && <span className={`seg state ${cur.state}`}>{STATE_LABEL[cur.state]}</span>}
      {cur?.link && cur.link !== 'attached' && (
        <span className={`seg link ${cur.link}`} title="State of the connection to the squatter">
          {LINK_LABEL[cur.link]}
        </span>
      )}
      {cur?.tf && cur.state !== 'ended' && (
        <span
          className={`seg control ${clientActive(cur.tf) ? 'mine' : 'theirs'}`}
          title={describeControl(cur.tf)}
          data-testid="tf-control"
        >
          Keyboard: <strong>{inputLabel(cur.tf)}</strong> · Triggers: <strong>{automationLabel(cur.tf)}</strong>{' '}
          <select
            aria-label="Control of this TinyFugue connection"
            value={currentPreset(cur.tf) ?? ''}
            onChange={(e) => e.target.value && preset(e.target.value as TFPreset)}
          >
            {currentPreset(cur.tf) === undefined && <option value="">Custom</option>}
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id} title={p.hint}>
                {p.label}
              </option>
            ))}
          </select>
        </span>
      )}
      {suspended && (
        <span className="seg suspended">
          Suspended{' '}
          <button type="button" className="linkbtn" onClick={() => void engine?.resume()}>
            Resume
          </button>
        </span>
      )}
      {activity > 0 && (
        <span className="seg activity" title="Sessions with unread output">
          Active: {activity}
        </span>
      )}
      {paused?.paused && (
        <span className="seg more">--More-- {paused.unread > 0 ? `(${paused.unread})` : ''}</span>
      )}
      {(status ?? []).map((f) => (
        <span key={f.name} className={`seg field ${f.attrs ?? ''}`} data-field={f.name}>
          {f.text}
        </span>
      ))}
      <span className="grow" />
      <button
        type="button"
        className={`seg tsbtn${timestamps ? ' on' : ''}`}
        onClick={toggleTimestamps}
        aria-pressed={timestamps}
        title={timestamps ? 'Timestamps on: click to hide the time each line arrived' : 'Show the time each line arrived'}
        aria-label="Show line timestamps"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="8" cy="8" r="6.2" />
          <path d="M8 4.5V8l2.5 1.5" />
        </svg>
      </button>
      <span className="seg clock">{formatClock(now)}</span>
    </footer>
  );
}
