import { useEffect, useState } from 'react';
import { useSessions, useUi } from '../state/stores';
import { useCmcpDom } from './dom';
import { TreeView } from './TreeView';
import type { CmcpPane } from './types';

// CMCP 2 contexts drawn as part of the page (not a scene): the main context when it is a place or a ship room is a card above the game text, with a
// row of exit buttons below it when the room lists its exits; a context the game wants on a panel or dock is a column beside the workspace (foldable),
// and a float is a window over it. The game's dock side, size and resizable are hints. The player's choices (folded, position) are remembered per type.

const mem = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(`cmcp-pane:${k}`);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown): void {
    try {
      localStorage.setItem(`cmcp-pane:${k}`, JSON.stringify(v));
    } catch {
      /* no storage: not remembered */
    }
  },
};

function Head({
  title,
  folded,
  onFold,
  onClose,
}: {
  title: string;
  folded?: boolean;
  onFold?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="cmcp-pane-head">
      {onFold && (
        <button
          type="button"
          className="cmcp-pane-btn"
          aria-expanded={!folded}
          aria-label={`${folded ? 'Open' : 'Fold'} ${title}`}
          onClick={onFold}
        >
          {folded ? '▸' : '▾'}
        </button>
      )}
      <span className="cmcp-pane-title">{title}</span>
      {onClose && (
        <button
          type="button"
          className="cmcp-pane-btn"
          aria-label={`Hide ${title}`}
          title="Hide for now"
          onClick={onClose}
        >
          &times;
        </button>
      )}
    </div>
  );
}

function usePageSend(session: string) {
  const engine = useUi((s) => s.engine);
  const toast = useUi((s) => s.toast);
  return {
    event:
      (pane: string | null) =>
      (path: string, event: string, value?: unknown): void => {
        const p =
          pane === null
            ? engine?.cmcpEvent(session, path, event, value)
            : engine?.cmcpPaneEvent(session, pane, path, event, value);
        void p
          ?.then((r) => {
            for (const er of r.errors ?? []) toast('error', er);
          })
          .catch((e: unknown) => toast('error', String(e instanceof Error ? e.message : e)));
      },
    say: (text: string): void => {
      void engine?.input(session, text).catch(() => undefined);
    },
  };
}

function MainCard({ session }: { session: string }) {
  const dom = useCmcpDom((s) => s.by[session]);
  const send = usePageSend(session);
  const type = dom?.main?.screen ?? '';
  const [folded, setFolded] = useState(() => mem.get(`${type}:folded`, false));
  useEffect(() => setFolded(mem.get(`${type}:folded`, false)), [type]);
  if (!dom?.main) return null;
  const title = dom.main.title || dom.title;
  return (
    <section className="cmcp-card" aria-label={title}>
      <Head
        title={title}
        folded={folded}
        onFold={() => {
          setFolded(!folded);
          mem.set(`${type}:folded`, !folded);
        }}
      />
      {!folded && (
        <>
          <TreeView tree={dom.main} readonly={dom.readonly} send={send.event(null)} />
          {dom.exits.length > 0 && (
            <div className="cmcp-exits" role="group" aria-label="Exits">
              {dom.exits.map((e) => (
                <button
                  key={e.cmd}
                  type="button"
                  className="cmcp-btn tone-accent"
                  onClick={() => send.say(e.cmd)}
                >
                  {e.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function DockPane({ session, pane, hide }: { session: string; pane: CmcpPane; hide: () => void }) {
  const send = usePageSend(session);
  const [folded, setFolded] = useState(() => mem.get(`${pane.type}:folded`, false));
  const title = pane.title || pane.name || pane.id || pane.type;
  return (
    <section className={`cmcp-pane cmcp-${pane.surface}`} aria-label={title}>
      <Head
        title={title}
        folded={folded}
        onFold={() => {
          setFolded(!folded);
          mem.set(`${pane.type}:folded`, !folded);
        }}
        onClose={hide}
      />
      {!folded &&
        (pane.tree ? (
          <TreeView tree={pane.tree} readonly={pane.readonly} send={send.event(pane.key)} />
        ) : (
          <p className="hint cmcp-pane-wait">Loading...</p>
        ))}
    </section>
  );
}

function FloatPane({ session, pane, hide }: { session: string; pane: CmcpPane; hide: () => void }) {
  const send = usePageSend(session);
  const [pos, setPos] = useState(() => mem.get(`${pane.type}:pos`, { x: 80, y: 80 }));
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const title = pane.title || pane.name || pane.id || pane.type;
  return (
    <section
      className="cmcp-pane cmcp-float"
      aria-label={title}
      style={{ left: pos.x, top: pos.y, width: Math.max(240, Number(pane.size?.w) || 320) }}
    >
      <div
        className="cmcp-float-drag"
        onPointerDown={(e) => {
          setDrag({ dx: e.clientX - pos.x, dy: e.clientY - pos.y });
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag) setPos({ x: Math.max(0, e.clientX - drag.dx), y: Math.max(0, e.clientY - drag.dy) });
        }}
        onPointerUp={() => {
          if (drag) {
            setDrag(null);
            mem.set(`${pane.type}:pos`, pos);
          }
        }}
      >
        <Head title={title} onClose={hide} />
      </div>
      {pane.tree ? (
        <TreeView tree={pane.tree} readonly={pane.readonly} send={send.event(pane.key)} />
      ) : (
        <p className="hint cmcp-pane-wait">Loading...</p>
      )}
    </section>
  );
}

/** The CMCP 2 surfaces of the foreground session around `children` (the workspace). */
export function PaneHosts({ children }: { children: React.ReactNode }) {
  const fg = useSessions((s) => s.fg);
  const dom = useCmcpDom((s) => (fg ? s.by[fg] : undefined));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const panes = dom?.panes ?? [];
  useEffect(() => {
    // a context that left the stack and came back is shown again (hiding lasts for the visit)
    setHidden((h) => {
      const keep = new Set([...h].filter((k) => panes.some((p) => p.key === k)));
      return keep.size === h.size ? h : keep;
    });
  }, [panes]);
  const shown = panes.filter((p) => !hidden.has(p.key));
  const hide = (k: string) => () => setHidden((h) => new Set(h).add(k));
  if (!fg || (!dom?.main && shown.length === 0)) return <>{children}</>;
  const side = shown.filter((p) => p.surface !== 'float');
  const floats = shown.filter((p) => p.surface === 'float');
  const column = (list: CmcpPane[], cls: string) =>
    list.length > 0 && (
      <aside
        className={`cmcp-dock ${cls}`}
        aria-label="Game panes"
        style={{ width: Math.max(...list.map((p) => Math.max(240, Number(p.size?.w) || 320))) }}
      >
        {list.map((p) => (
          <DockPane key={p.key} session={fg} pane={p} hide={hide(p.key)} />
        ))}
      </aside>
    );
  return (
    <div className="with-panes">
      {column(
        side.filter((p) => p.dock === 'left'),
        'cmcp-dock-left',
      )}
      <div className="with-panes-main">
        <MainCard session={fg} />
        {children}
      </div>
      {column(
        side.filter((p) => p.dock !== 'left'),
        'cmcp-dock-right',
      )}
      {floats.map((p) => (
        <FloatPane key={p.key} session={fg} pane={p} hide={hide(p.key)} />
      ))}
    </div>
  );
}
