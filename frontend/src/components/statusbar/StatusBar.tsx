import { useSessions, useUi } from '../../state/stores';
import { formatClock } from '../../lib/humanize';

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
      <span className="seg clock">{formatClock(now)}</span>
    </footer>
  );
}
