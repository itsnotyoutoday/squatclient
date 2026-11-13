import { useSessions, useUi } from '../../state/stores';
import { useControllerRef } from '../../state/controller-context';

export function TabBar() {
  const order = useSessions((s) => s.order);
  const sessions = useSessions((s) => s.sessions);
  const fg = useSessions((s) => s.fg);
  const engine = useUi((s) => s.engine);
  const controller = useControllerRef();

  const close = (id: string): void => {
    const s = sessions[id];
    if (!s) return;
    if (s.state === 'ended') void controller?.dismiss(id);
    else void engine?.disconnect(id);
  };

  return (
    <div className="tabbar" role="tablist" aria-label="Sessions">
      {order.map((id, i) => {
        const s = sessions[id];
        if (!s) return null;
        const active = id === fg;
        const unread = active ? 0 : s.unread;
        return (
          <div key={id} className={`tab ${s.state}${active ? ' active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="tabmain"
              title={`${s.name} (${s.host}:${s.port}) - Alt-${i + 1}`}
              onClick={() => controller?.switchTo(id)}
            >
              {s.state === 'connecting' && <span className="spinner" aria-label="connecting" role="img" />}
              <span className="tabname">{s.name}</span>
              {unread > 0 && (
                <span className="badge unread" aria-label={`${unread} unread`}>
                  {unread > 999 ? '999+' : unread}
                </span>
              )}
              {s.state === 'ended' && <span className="badge ended">ended</span>}
            </button>
            <button
              type="button"
              className="tabclose"
              aria-label={s.state === 'ended' ? `Dismiss ${s.name}` : `Disconnect ${s.name}`}
              onClick={() => close(id)}
            >
              &times;
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="tabadd"
        aria-label="New connection"
        title="Worlds (Ctrl-O)"
        onClick={() => useUi.getState().openDialog('worlds')}
      >
        +
      </button>
      <span className="grow" />
      <button
        type="button"
        className="tabadd"
        title="Quick connect"
        aria-label="Quick connect"
        onClick={() => useUi.getState().openDialog('quick')}
      >
        &#9889;
      </button>
      <button
        type="button"
        className="tabadd"
        title="Squatters"
        aria-label="Squatters"
        onClick={() => useUi.getState().openDialog('squatters')}
      >
        &#9729;
      </button>
      <button
        type="button"
        className="tabadd"
        title="Search (Cmd-F)"
        aria-label="Search"
        onClick={() => useUi.getState().setSearch(true)}
      >
        &#9906;
      </button>
      <button
        type="button"
        className="tabadd"
        title="Settings (Ctrl-,)"
        aria-label="Settings"
        onClick={() => useUi.getState().openDialog('settings')}
      >
        &#9881;
      </button>
      <button
        type="button"
        className="tabadd"
        title="Keyboard help"
        aria-label="Help"
        onClick={() => useUi.getState().openDialog('help')}
      >
        ?
      </button>
    </div>
  );
}
