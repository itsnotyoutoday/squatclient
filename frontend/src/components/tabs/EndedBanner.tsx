import type { SessionInfo } from '../../api/types';
import { useSessions, useUi } from '../../state/stores';
import { useControllerRef } from '../../state/controller-context';
import { formatTime, humanizeReason } from '../../lib/humanize';

export function EndedBanner({ session }: { session: SessionInfo }) {
  const engine = useUi((s) => s.engine);
  const worlds = useUi((s) => s.worlds);
  const controller = useControllerRef();

  const reconnect = async (): Promise<void> => {
    if (!engine) return;
    const world =
      (session.worldId ? worlds.find((w) => w.id === session.worldId) : undefined) ??
      worlds.find((w) => w.host === session.host && w.port === session.port);
    try {
      const fresh = await engine.connect(
        world ? { worldId: world.id } : { host: session.host, port: session.port, tls: session.tls },
      );
      // show the world just reconnected BEFORE the ended tab is closed: closing the tab you were on picks whatever sat beside it,
      // and that choice would then be pushed to the engine and win
      useUi.getState().showConsole(false);
      useSessions.getState().setFg(fresh.id);
      await controller?.dismiss(session.id);
    } catch (e) {
      useUi.getState().toast('error', String(e));
    }
  };

  return (
    <div className="endbar" role="alert" data-testid="ended-banner">
      <div className="msg">
        <strong>{humanizeReason(session.endReason)}.</strong>
        {session.endedAt !== undefined && <span className="dim"> Ended {formatTime(session.endedAt)}.</span>}
        {session.endDetail && <span className="dim"> {session.endDetail}</span>}
        {session.lastText && <div className="last dim">Last text: {session.lastText}</div>}
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={() => void reconnect()}>
          Reconnect
        </button>
        <button type="button" onClick={() => void controller?.dismiss(session.id)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
