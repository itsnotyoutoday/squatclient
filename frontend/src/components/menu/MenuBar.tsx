import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { handleMenuAction } from '../../state/controller';
import { useControllerRef } from '../../state/controller-context';
import { useSessions } from '../../state/stores';
import type { Platform } from '../../lib/platform';

interface MenuItem {
  label: string;
  /** Underlined access key (press the letter inside the open menu). */
  key?: string;
  shortcut?: string;
  action?: string;
  run?: () => void;
  needsSession?: boolean;
}
type Entry = MenuItem | 'sep';
interface Menu {
  label: string;
  key: string;
  items: Entry[];
}

const exec = (cmd: string) => () => {
  try {
    document.execCommand(cmd);
  } catch {
    /* the webview refused (clipboard access): nothing to do */
  }
};

/** The menus of the Windows and Linux builds (macOS uses the native menu bar). */
export const MENUS: readonly Menu[] = [
  {
    label: 'File',
    key: 'F',
    items: [
      { label: 'New Connection...', key: 'N', shortcut: 'Ctrl+Shift+N', action: 'quick-connect' },
      { label: 'Worlds...', key: 'W', shortcut: 'Ctrl+O', action: 'worlds' },
      {
        label: 'Connection Settings...',
        key: 'C',
        shortcut: 'Alt+Enter',
        action: 'session-settings',
        needsSession: true,
      },
      'sep',
      { label: 'Suspend (detach from squatters)', key: 'S', shortcut: 'Ctrl+Shift+D', action: 'suspend' },
      { label: 'Resume', key: 'R', shortcut: 'Ctrl+Shift+R', action: 'resume' },
      'sep',
      {
        label: 'Close Session',
        key: 'l',
        shortcut: 'Ctrl+Shift+W',
        action: 'close-session',
        needsSession: true,
      },
      'sep',
      { label: 'Settings...', key: 'e', shortcut: 'Ctrl+,', action: 'settings' },
      'sep',
      { label: 'Exit', key: 'x', shortcut: 'Ctrl+Q', action: 'quit' }, // Windows: Alt+F4 (the window system)
    ],
  },
  {
    label: 'Edit',
    key: 'E',
    items: [
      { label: 'Undo', key: 'U', shortcut: 'Ctrl+Z', action: 'undo' },
      { label: 'Redo', key: 'R', shortcut: 'Ctrl+Shift+Z', action: 'redo' },
      'sep',
      { label: 'Cut', key: 't', shortcut: 'Ctrl+X', run: exec('cut') },
      { label: 'Copy', key: 'C', shortcut: 'Ctrl+C', run: exec('copy') },
      { label: 'Paste', key: 'P', shortcut: 'Ctrl+V', run: exec('paste') },
      { label: 'Select All', key: 'A', shortcut: 'Ctrl+A', run: exec('selectAll') },
    ],
  },
  {
    label: 'View',
    key: 'V',
    items: [
      { label: 'Find...', key: 'F', shortcut: 'Ctrl+Shift+F', action: 'search' },
      { label: 'Object Editor', key: 'O', shortcut: 'Ctrl+E', action: 'editor', needsSession: true },
      { label: 'Layouts...', key: 'L', action: 'layouts' },
    ],
  },
  {
    label: 'Help',
    key: 'H',
    items: [
      { label: 'SquatClient Help', key: 'H', shortcut: 'F1', action: 'help' },
      'sep',
      { label: 'About SquatClient', key: 'A', action: 'about' },
    ],
  },
];

/**
 * An in-window menu bar in the style of the platform ('windows' or 'linux'): drawn by the page so it
 * looks the same everywhere and can be themed. Click, hover while open, arrow keys, Enter, Escape,
 * access keys and Alt+letter all work.
 */
export function MenuBar({ platform }: { platform: Exclude<Platform, 'mac'> }) {
  const controller = useControllerRef();
  const hasSession = useSessions((s) => s.order.length > 0);
  const [open, setOpen] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const away = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);

  // Alt+letter opens a menu (Alt alone is left to the window system)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key.length !== 1) return;
      const i = MENUS.findIndex((m) => m.key.toLowerCase() === e.key.toLowerCase());
      if (i < 0) return;
      e.preventDefault();
      setOpen(i);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open !== null)
      root.current?.querySelector<HTMLButtonElement>('.mb-drop button:not(:disabled)')?.focus();
  }, [open]);

  const choose = (it: MenuItem): void => {
    setOpen(null);
    if (it.run) it.run();
    else if (it.action && controller) handleMenuAction(it.action, controller);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (open === null) return;
    const btns = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>('.mb-drop button:not(:disabled)') ?? []),
    ];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(null);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setOpen((open + (e.key === 'ArrowRight' ? 1 : -1) + MENUS.length) % MENUS.length);
    } else if (e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const m = MENUS[open].items.find(
        (x): x is MenuItem => x !== 'sep' && x.key?.toLowerCase() === e.key.toLowerCase(),
      );
      if (m && !(m.needsSession && !hasSession)) {
        e.preventDefault();
        choose(m);
      }
    }
  };

  return (
    <div
      ref={root}
      className={`menubar ${platform}`}
      role="menubar"
      aria-label="Application menu"
      onKeyDown={onKey}
    >
      {MENUS.map((m, mi) => (
        <div key={m.label} className="mb-menu">
          <button
            type="button"
            role="menuitem"
            aria-label={m.label}
            aria-haspopup="menu"
            aria-expanded={open === mi}
            className={open === mi ? 'mb-top on' : 'mb-top'}
            onClick={() => setOpen(open === mi ? null : mi)}
            onMouseEnter={() => open !== null && setOpen(mi)}
          >
            <span className="mb-label">
              {m.label.split('').map((c, i) => (c === m.key && i === 0 ? <u key={i}>{c}</u> : c))}
            </span>
          </button>
          {open === mi && (
            <div className="mb-drop" role="menu" aria-label={m.label}>
              {m.items.map((it, i) =>
                it === 'sep' ? (
                  <hr key={i} role="separator" />
                ) : (
                  <button
                    key={it.label}
                    type="button"
                    role="menuitem"
                    disabled={!!it.needsSession && !hasSession}
                    onClick={() => choose(it)}
                  >
                    <span className="mb-text">{it.label}</span>
                    {it.shortcut && <span className="mb-key">{it.shortcut}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
