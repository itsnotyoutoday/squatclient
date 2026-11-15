import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { SessionInfo } from '../../api/types';
import { useUi } from '../../state/stores';
import { setWorldMuted, useSoundMute } from '../../state/soundMute';

export interface TabMenuProps {
  session: SessionInfo;
  x: number;
  y: number;
  onClose(): void;
  onCloseSession(id: string): void;
}

interface Item {
  label: string;
  run(): void;
}

/** A session held by gtf: its worlds live in gtf, the app cannot rename them. */
function gtfSession(s: { via?: string }): boolean {
  return useUi.getState().squatters.some((q) => q.id === s.via && q.flavor === 'gtf');
}

/** The menu of a session tab (right-click, or Shift-F10 / the Menu key on the tab). */
export function TabMenu({ session: s, x, y, onClose, onCloseSession }: TabMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const ui = useUi.getState();
  const ended = s.state === 'ended';
  const items: (Item | 'sep')[] = [
    { label: 'Connection settings...', run: () => ui.openSessionSettings(s.id) },
    ...(!gtfSession(s)
      ? [
          {
            // a connection opened by address through TinyFugue is a temporary "(unnamedN)" world there: naming it keeps it
            label: s.tf?.world.startsWith('(') ? 'Save as a world in TinyFugue...' : 'Rename...',
            run: () => ui.openRename(s.id),
          },
        ]
      : []), // gtf holds its own worlds: the app cannot rename them
    ...(s.worldId
      ? [
          {
            label: 'Edit world...',
            run: () => {
              ui.setEditWorld(s.worldId ?? null);
              ui.openDialog('worlds');
            },
          },
        ]
      : [{ label: 'Save as world...', run: () => ui.openSessionSettings(s.id) }]),
    {
      label: useSoundMute.getState().by[s.id] === 'world' ? 'Unmute sound for this world' : 'Mute sound for this world',
      run: () => void setWorldMuted(ui.engine, s.id, useSoundMute.getState().by[s.id] !== 'world', (m) => ui.toast('error', m)),
    },
    'sep',
    { label: ended ? 'Dismiss' : 'Disconnect', run: () => onCloseSession(s.id) },
  ];

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const away = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const onKey = (e: KeyboardEvent): void => {
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      btns[(i + d + btns.length) % btns.length]?.focus();
    }
  };

  return (
    <div
      ref={ref}
      className="tabmenu"
      role="menu"
      aria-label={`${s.name} menu`}
      style={{ left: x, top: y }}
      onKeyDown={onKey}
    >
      {items.map((it, i) =>
        it === 'sep' ? (
          <hr key={`s${i}`} />
        ) : (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              it.run();
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}
