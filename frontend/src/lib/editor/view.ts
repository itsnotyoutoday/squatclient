import { useSessions, useUi } from '../../state/stores';
import type { SessionsState } from '../../state/stores';
import {
  getWorkspace,
  openTarget,
  requestCloseObject,
  restoreWorkspace,
  useEditorUi,
} from '../../state/editorStore';
import type { EditCommand } from './command';

/** The world the editor works on: the foreground session while it is connected, else the first connected one. */
export function pickEditorSession(s: Pick<SessionsState, 'fg' | 'order' | 'sessions'>): string | null {
  const live = (id: string | null): boolean => !!id && !!s.sessions[id] && s.sessions[id].state !== 'ended';
  if (live(s.fg)) return s.fg;
  return s.order.find((id) => live(id)) ?? null;
}

export const activeEditorSession = (): string | null => pickEditorSession(useSessions.getState());

/** Show the editor view and restore the last tabs of the active world. The terminal keeps running underneath. */
export function enterEditor(): void {
  useUi.getState().setView('editor');
  const sid = activeEditorSession();
  if (sid) void restoreWorkspace(sid);
}

export function leaveEditor(): void {
  useUi.getState().setView('terminal');
}

export function toggleEditorView(): void {
  if (useUi.getState().view === 'editor') leaveEditor();
  else enterEditor();
}

/** Handle a parsed `/edit` command: flip to the editor and open what was asked. */
export async function runEditCommand(cmd: EditCommand): Promise<void> {
  const ui = useUi.getState();
  if (cmd.kind === 'bad') {
    ui.toast('warn', cmd.message);
    return;
  }
  const sid = activeEditorSession();
  if (cmd.target && !sid) {
    ui.toast('warn', 'Connect to a world first: /edit needs the game to look the object up');
    return;
  }
  enterEditor();
  if (!cmd.target || !sid) return;
  const r = await openTarget(sid, cmd.target, cmd.attr);
  if (!r.ok) useUi.getState().toast('warn', r.error);
}

/** Cmd/Ctrl+W (also the native "Close Session" menu item): close the active object tab. */
export function closeActiveEditorTab(): void {
  const sid = activeEditorSession();
  const w = sid ? getWorkspace(sid) : null;
  if (sid && w?.activeObject) requestCloseObject(sid, w.activeObject);
}

/** Open the `[+]` prompt (Cmd/Ctrl+T). */
export function promptNewTab(): void {
  useEditorUi.getState().set({ prompt: true });
}
