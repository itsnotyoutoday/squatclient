/**
 * Undo / redo requested from outside the page (the native Edit menu, which on macOS must not claim
 * Cmd+Z itself: WebKit's own undo knows nothing about the code editor's history).
 *
 * In a code editor we replay the keystroke its own history keymap listens for; in plain text fields
 * the browser's built-in undo works.
 */
export function runUndoRedo(kind: 'undo' | 'redo'): void {
  const active = document.activeElement as HTMLElement | null;
  const editor = active?.closest?.('.cm-editor');
  if (editor) {
    const target = (editor.querySelector('.cm-content') as HTMLElement | null) ?? active;
    const mac = /Mac/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
    target?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        code: 'KeyZ',
        metaKey: mac,
        ctrlKey: !mac,
        shiftKey: kind === 'redo',
        bubbles: true,
        cancelable: true,
      }),
    );
    return;
  }
  try {
    document.execCommand(kind);
  } catch {
    /* nothing to undo in this context */
  }
}
