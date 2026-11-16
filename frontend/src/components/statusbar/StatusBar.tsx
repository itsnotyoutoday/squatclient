import { useSessions, useSettings, useUi } from '../../state/stores';
import { WorldMuteButton } from '../SoundButtons';
import { formatClock } from '../../lib/humanize';
import {
  PRESETS,
  automationLabel,
  clientActive,
  currentPreset,
  describeControl,
  inputLabel,
} from '../../lib/tfcontrol';
import type { TFPreset } from '../../api/types';
import { LEVELS, useCmcpLevel, type CmcpLevel } from '../../cmcp/level';
import { useCmcpDom } from '../../cmcp/dom';

const STATE_LABEL = { connecting: 'Connecting', connected: 'Connected', ended: 'Ended' } as const;
const LINK_LABEL = {
  attached: 'Attached',
  detached: 'Detached',
  unreachable: 'Squatter unreachable',
} as const;

/** How far the client goes in drawing this game's screens. A testing control: it changes nothing on the wire, only what the window draws with,
 * so the same game can be seen as a full console, as plain widgets, or as text alone. */
function CmcpChip({ session }: { session: string }) {
  const dom = useCmcpDom((s) => s.by[session]);
  const cap = useCmcpLevel((s) => s.by[session] ?? 'scene');
  if (!dom?.on) return null;
  const allowed = LEVELS.find((l) => l.n === dom.serverLevel);
  return (
    <span
      className="seg cmcp"
      title={`The game allows up to ${allowed?.label ?? dom.serverLevel} for the screen in view; this client may go lower, never higher. Drawing at ${LEVELS.find((l) => l.n === dom.level)?.label ?? dom.level}.`}
    >
      CMCP {dom.proto}{' '}
      <select
        aria-label="How far this client may draw the game's screens"
        value={cap}
        onChange={(e) => useCmcpLevel.getState().set(session, e.target.value as CmcpLevel)}
      >
        {LEVELS.map((l) => (
          <option key={l.id} value={l.id} title={l.n > dom.serverLevel ? `The game allows only up to ${allowed?.label ?? dom.serverLevel} here` : l.hint}>
            {l.label}
            {l.n > dom.serverLevel ? ' (game allows less)' : ''}
          </option>
        ))}
      </select>
    </span>
  );
}

export function StatusBar() {
  const fg = useSessions((s) => s.fg);
  const sessions = useSessions((s) => s.sessions);
  const status = useSessions((s) => (fg ? s.status[fg] : undefined));
  const paused = useSessions((s) => (fg ? s.paused[fg] : undefined));
  const now = useUi((s) => s.now);
  const suspended = useUi((s) => s.suspended);
  const engine = useUi((s) => s.engine);
  const squatters = useUi((s) => s.squatters);
  const consoleOpen = useUi((s) => s.consoleOpen);
  const cur = fg && !consoleOpen ? sessions[fg] : undefined;
  const timestamps = useSettings((s) => s.settings.timestamps);
  const toggleTimestamps = (): void => {
    const next = { ...useSettings.getState().settings, timestamps: !timestamps };
    useSettings.getState().set(next);
    void engine?.saveSettings(next).catch((e: unknown) => useUi.getState().toast('error', String(e instanceof Error ? e.message : e)));
  };
  const gtf = !!cur && squatters.some((q) => q.id === cur.via && q.flavor === 'gtf');
  const preset = (p: TFPreset): void => {
    if (!cur || !engine) return;
    void engine
      .controlPreset(cur.id, p)
      .catch((e: unknown) => useUi.getState().toast('error', String(e instanceof Error ? e.message : e)));
  };
  const activity = Object.values(sessions).filter((s) => s.id !== fg && s.unread > 0).length;

  return (
    <footer className="statusbar" role="status" aria-label="Status">
      <span className="seg world">{cur ? cur.name : 'Home'}</span>
      {cur && <span className={`seg state ${cur.state}`}>{STATE_LABEL[cur.state]}</span>}
      {cur && cur.state !== 'ended' && <WorldMuteButton session={cur.id} />}
      {cur && cur.state !== 'ended' && <CmcpChip session={cur.id} />}
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
          {gtf ? (
            <>
              gtf: <strong>you and gtf both type</strong>, gtf runs the triggers
            </>
          ) : (
            <>
              Keyboard: <strong>{inputLabel(cur.tf)}</strong> · Triggers:{' '}
              <strong>{automationLabel(cur.tf)}</strong>{' '}
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
            </>
          )}
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
