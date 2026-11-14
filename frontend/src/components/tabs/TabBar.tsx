import { openHelp } from '../../help/command';
import { toggleEditorView } from '../../lib/editor/view';
import { useState } from 'react';
import { useSessions, useUi } from '../../state/stores';
import { TabMenu } from './TabMenu';
import type { SessionInfo, SquatterConfig } from '../../api/types';
import { OBJECT_EDITOR, fgHasModule } from '../../lib/modules';
import { useControllerRef } from '../../state/controller-context';
import { clientActive, describeControl, inputShort } from '../../lib/tfcontrol';

/** The hover text of a tab: the world, its address and which squatter holds the connection. */
function tabTitle(s: SessionInfo, i: number, squatters: SquatterConfig[]): string {
  let route = '';
  if (s.via && s.via !== 'direct') {
    const q = squatters.find((x) => x.id === s.via);
    route = q ? ` \u2022 ${q.kind === 'tf-squatterd' ? 'TinyFugue' : 'squatter'}: ${q.name} (${q.host}:${q.port})` : ` \u2022 via ${s.via}`;
  }
  return `${s.name} (${s.host}:${s.port})${route} - Alt-${i + 1}`;
}

export function TabBar() {
  const order = useSessions((s) => s.order);
  const sessions = useSessions((s) => s.sessions);
  const fg = useSessions((s) => s.fg);
  const engine = useUi((s) => s.engine);
  const canEdit = useSessions(fgHasModule(OBJECT_EDITOR));
  const view = useUi((s) => s.view);
  const controller = useControllerRef();
  const squatters = useUi((s) => s.squatters);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

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
          <div
            key={id}
            className={`tab ${s.state}${active ? ' active' : ''}`}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ id, x: e.clientX, y: e.clientY });
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="tabmain"
              title={tabTitle(s, i, squatters)}
              onClick={() => controller?.switchTo(id)}
              onKeyDown={(e) => {
                if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu({ id, x: r.left, y: r.bottom });
                }
              }}
            >
              {s.state === 'connecting' && <span className="spinner" aria-label="connecting" role="img" />}
              <span className="tabname">{s.name}</span>
              {s.tf && (
                <span className="tfmark" aria-label="through TinyFugue">
                  (tf)
                </span>
              )}
              {unread > 0 && (
                <span className="badge unread" aria-label={`${unread} unread`}>
                  {unread > 999 ? '999+' : unread}
                </span>
              )}
              {s.tf && s.state !== 'ended' && (
                <span
                  className={`badge tf ${clientActive(s.tf) ? 'mine' : 'theirs'}`}
                  title={describeControl(s.tf)}
                  aria-label={`TinyFugue connection. ${describeControl(s.tf)}`}
                  data-testid={`tfbadge-${id}`}
                >
                  {inputShort(s.tf)}
                  {s.tf.automation === 'client' ? ' ⚙' : ''}
                </span>
              )}
              {s.state === 'ended' && <span className="badge ended">ended</span>}
              {s.state !== 'ended' && s.link && s.link !== 'attached' && (
                <span className={`badge link ${s.link}`} title={`Squatter link: ${s.link}`}>
                  {s.link}
                </span>
              )}
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
      {menu && sessions[menu.id] && (
        <TabMenu
          session={sessions[menu.id]}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onCloseSession={close}
        />
      )}
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
      {(canEdit || view === 'editor') && (
        <button
          type="button"
          className="tabadd"
          title="Object Editor (Cmd+E)"
          aria-label="Object Editor"
          onClick={() => toggleEditorView()}
        >
          Object Editor
        </button>
      )}
      <button
        type="button"
        className="tabadd"
        title="Settings (Ctrl-,)"
        aria-label="Settings"
        onClick={() => useUi.getState().openDialog('settings')}
      >
        &#9881;
      </button>
      <button type="button" className="tabadd" title="Help (F1)" aria-label="Help" onClick={() => openHelp()}>
        ?
      </button>
    </div>
  );
}
