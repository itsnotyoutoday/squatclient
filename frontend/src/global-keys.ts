import { useEffect } from 'react';
import type { Controller } from './state/controller';
import type { OutputHandle } from './components/output/handle';
import { useSessions, useUi } from './state/stores';

/** UI-level shortcuts only. Everything else typed goes to engine.input untouched. */
export function useGlobalKeys(controller: Controller | null, getOutput: () => OutputHandle | null): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ui = useUi.getState();
      if (ui.dialog) return;
      const inInput = !!(e.target as HTMLElement | null)?.closest?.('.inputline');
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
      const isF = e.key.toLowerCase() === 'f';
      if (
        (e.metaKey && isF) ||
        (e.ctrlKey && e.shiftKey && isF) ||
        (e.ctrlKey && !e.shiftKey && !e.altKey && isF && !inInput)
      ) {
        e.preventDefault();
        ui.setSearch(true);
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
