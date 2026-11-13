/**
 * Unsent editor text ("draft") and the editor-mode flag, kept per WORLD so a big piece of code survives
 * tab switches and restarts. localStorage can be missing or throw (private windows, blocked storage):
 * everything falls back to memory and never throws.
 */
export interface InputDraft {
  editor: boolean;
  text: string;
}

const PREFIX = 'squat.input.';
const mem = new Map<string, InputDraft>();

export function loadDraft(key: string): InputDraft {
  const m = mem.get(key);
  if (m) return m;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw) {
      const v = JSON.parse(raw) as Partial<InputDraft>;
      const d = { editor: v.editor === true, text: typeof v.text === 'string' ? v.text : '' };
      mem.set(key, d);
      return d;
    }
  } catch {
    /* storage unavailable or corrupt: start empty */
  }
  return { editor: false, text: '' };
}

export function saveDraft(key: string, d: InputDraft): void {
  mem.set(key, d);
  try {
    if (!d.editor && d.text === '') window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, JSON.stringify(d));
  } catch {
    /* quota or storage disabled: the in-memory copy still survives tab switches */
  }
}

export function clearDrafts(): void {
  mem.clear();
}

const PREF = 'squat.editor.prefs';
export interface EditorPrefs {
  wrap: boolean;
  lineNumbers: boolean;
}
export function loadEditorPrefs(): EditorPrefs {
  try {
    const v = JSON.parse(window.localStorage.getItem(PREF) ?? '{}') as Partial<EditorPrefs>;
    return { wrap: v.wrap === true, lineNumbers: v.lineNumbers !== false };
  } catch {
    return { wrap: false, lineNumbers: true };
  }
}
export function saveEditorPrefs(p: EditorPrefs): void {
  try {
    window.localStorage.setItem(PREF, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
