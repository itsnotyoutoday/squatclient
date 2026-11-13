import { useSessions, useUi } from '../../state/stores';
import { useControllerRef } from '../../state/controller-context';
import { humanizeReason, formatAgo } from '../../lib/humanize';
import { Dialog } from './Dialog';

export function AwayDialog() {
  const ids = useUi((s) => s.awayIds);
  const now = useUi((s) => s.now);
  const sessions = useSessions((s) => s.sessions);
  const controller = useControllerRef();
  const close = (): void => useUi.getState().openDialog(null);
  const list = ids.map((id) => sessions[id]).filter(Boolean);

  return (
    <Dialog
      title="While you were away"
      onClose={close}
      wide
      footer={
        <button type="button" className="primary" onClick={close}>
          Close
        </button>
      }
    >
      {list.length === 0 ? (
        <p className="hint">Nothing needs your attention.</p>
      ) : (
        <ul className="plain away">
          {list.map((s) => (
            <li key={s.id} className={`awayitem ${s.state}`}>
              <div>
                <strong>{s.name}</strong>{' '}
                {s.state === 'ended' ? (
                  <span className="badge ended">
                    ended: {humanizeReason(s.endReason)}
                    {s.endedAt ? `, ${formatAgo(s.endedAt, now)}` : ''}
                  </span>
                ) : (
                  <span className="badge unread">{s.unread} new</span>
                )}
                {s.lastText && <div className="dim last">{s.lastText}</div>}
              </div>
              <div className="actions">
                <button
                  type="button"
                  onClick={() => {
                    controller?.switchTo(s.id);
                    close();
                  }}
                >
                  Go to
                </button>
                {s.state === 'ended' && (
                  <button type="button" onClick={() => void controller?.dismiss(s.id)}>
                    Dismiss
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
