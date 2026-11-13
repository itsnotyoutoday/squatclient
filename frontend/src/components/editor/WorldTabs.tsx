import { useSessions } from '../../state/stores';
import { useControllerRef } from '../../state/controller-context';
import { useEditor } from '../../state/editorStore';
import { leaveEditor } from '../../lib/editor/view';
import { OBJECT_EDITOR, hasModule } from '../../lib/modules';
import { tabListKeys } from './roving';

/** Row 1: the connected worlds. Clicking switches the world the editor (and the terminal) shows. */
export function WorldTabs({ sid }: { sid: string | null }) {
  const order = useSessions((s) => s.order);
  const sessions = useSessions((s) => s.sessions);
  const ws = useEditor((s) => s.ws);
  const controller = useControllerRef();
  const shown = order.filter(
    (id) => sessions[id] && sessions[id].state !== 'ended' && hasModule(OBJECT_EDITOR, sessions[id]),
  );

  const pick = (id: string): void => {
    if (controller) controller.switchTo(id);
    else useSessions.getState().setFg(id);
  };

  return (
    <div className="ew-worlds">
      <div className="ew-tablist" role="tablist" aria-label="Worlds" onKeyDown={tabListKeys}>
        {shown.map((id, i) => {
          const s = sessions[id];
          const active = id === sid;
          const dirty = (ws[id]?.objects ?? []).reduce(
            (n, o) => n + Object.values(o.buffers).filter((b) => b.dirty).length,
            0,
          );
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`ew-world-${id}`}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`ew-worldtab${active ? ' ew-active' : ''}`}
              title={`${s.name} (${s.host}:${s.port}) - Alt-${i + 1}`}
              onClick={() => pick(id)}
            >
              <span className="ew-tabname">{s.name}</span>
              {dirty > 0 && (
                <span className="ew-badge" aria-label={`${dirty} unsaved`}>
                  {dirty}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <span className="ew-grow" />
      <button
        type="button"
        className="ew-termbtn"
        title="Back to the terminal (Cmd/Ctrl-E, Escape)"
        onClick={leaveEditor}
      >
        Terminal
      </button>
    </div>
  );
}
