import { create } from 'zustand';
import type { EngineAPI, FileResult } from '../../api/types';
import { useSessions, useUi } from '../../state/stores';

export interface UploadTarget {
  /** The session the commands will be sent to (chosen when the upload starts, never changes). */
  sessionId: string;
  file: FileResult;
}

interface UploadState {
  target: UploadTarget | null;
  open(t: UploadTarget): void;
  close(): void;
}

/** Which file the upload dialog shows. Nothing is sent until the user clicks Send in the dialog. */
export const useUpload = create<UploadState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

export const uploadDialogOpen = (): boolean => useUpload.getState().target !== null;

const fail = (text: string): void => useUi.getState().toast('error', text);

/** Show the dialog for an already-read file (drop or tests). */
export function openUpload(sessionId: string, file: FileResult): void {
  const s = useSessions.getState().sessions[sessionId];
  if (!s) return fail('Open a session first: uploads are sent to the foreground world.');
  if (!file.ok) return fail(`Cannot upload ${file.name || file.path}: ${file.error ?? 'unreadable file'}`);
  useUpload.getState().open({ sessionId, file });
}

/**
 * `/upload [path]`: with no path the native picker opens; either way the file is read by the app
 * (never by the page) and shown in the upload dialog. Resolves once the dialog is open, the user
 * cancelled the picker, or an error was reported.
 */
export async function beginUpload(engine: EngineAPI | null, sessionId: string, path: string): Promise<void> {
  if (!engine) return;
  try {
    let p = path.trim();
    if (!p) {
      p = await engine.pickFile('Choose a text file to upload');
      if (!p) return; // cancelled
    }
    openUpload(sessionId, await engine.readTextFile(p));
  } catch (e) {
    fail(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
