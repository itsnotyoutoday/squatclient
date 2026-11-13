import { useEffect } from 'react';
import type { Controller } from './state/controller';
import type { OutputHandle } from './components/output/handle';
import { useSessions, useUi } from './state/stores';
import { openHelp } from './help/command';
import { toggleEditor } from './lib/inputevents';
import { toggleEditorView } from './lib/editor/view';
import { uploadDialogOpen } from './lib/upload/store';

/** UI-level shortcuts only. Everything else typed goes to engine.input untouched. */
export function useGlobalKeys(controller: Controller | null, getOutput: () => OutputHandle | null): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ui = useUi.getState();
      if (e.key === 'F1' || (e.metaKey && e.key === '?')) {
        e.preventDefault();
        if (ui.dialog !== 'help') openHelp();
        return;
      }
      if (ui.dialog || uploadDialogOpen()) return;
      const inInput = !!(e.target as HTMLElement | null)?.closest?.('.inputline');
      // the code editor (command window editor mode) has its own search on Mod-F: never steal it
      const inCodeEditor = !!(e.target as HTMLElement | null)?.closest?.('.cm-editor');
      const s = useSessions.getState();

      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code)) {
        const id = s.order[Number(e.code.slice(5)) - 1];
        if (id && controller) {
          e.preventDefault();
          controller.switchTo(id);
        }
        return;
      }
      if (e.ctrlKey && e.key === 'Tab' && controller && s.order.length > 1) {
        e.preventDefault();
        const i = s.fg ? s.order.indexOf(s.fg) : 0;
        controller.switchTo(s.order[(i + (e.shiftKey ? -1 : 1) + s.order.length) % s.order.length]);
        return;
      }
      // Cmd-E (Ctrl-E outside the input line, where it means end-of-line): flip terminal <-> editor view
      if (
        e.key.toLowerCase() === 'e' &&
        !e.shiftKey &&
        !e.altKey &&
        (e.metaKey || (e.ctrlKey && !inInput && !e.defaultPrevented))
      ) {
        e.preventDefault();
        toggleEditorView();
        return;
      }
      // the rest are terminal-only; the editor view has its own keys (components/editor)
      if (ui.view === 'editor') {
        if (e.ctrlKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'o') {
          e.preventDefault();
          ui.openDialog('worlds');
        } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
          e.preventDefault();
          ui.openDialog('settings');
        }
        return;
      }
      const isF = e.key.toLowerCase() === 'f';
      if (
        !inCodeEditor &&
        ((e.metaKey && isF) ||
          (e.ctrlKey && e.shiftKey && isF) ||
          (e.ctrlKey && !e.shiftKey && !e.altKey && isF && !inInput))
      ) {
        e.preventDefault();
        ui.setSearch(true);
        return;
      }
      const k = e.key.toLowerCase();
      if (
        s.fg &&
        ((e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && k === 'r') ||
          (e.metaKey && e.shiftKey && !e.altKey && k === 'h'))
      ) {
        e.preventDefault();
        ui.openDialog('history');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && k === 'e') {
        e.preventDefault();
        toggleEditor();
        return;
      }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        ui.openDialog('worlds');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        ui.openDialog('settings');
        return;
      }
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        const out = getOutput();
        if (e.key === 'PageUp') out?.pageUp();
        else out?.pageDown();
        return;
      }
      if (e.key === 'End' && !inInput && !e.shiftKey) {
        getOutput()?.jumpLive();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller, getOutput]);
}
