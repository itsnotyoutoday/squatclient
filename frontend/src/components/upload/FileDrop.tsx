import { useEffect, useState } from 'react';
import { readDroppedFile } from '../../lib/upload/decode';
import { openUpload, uploadDialogOpen } from '../../lib/upload/store';
import { useSessions, useUi } from '../../state/stores';

const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

/** Drop a text file anywhere on the window: it opens the upload dialog for the foreground session. */
export function FileDrop() {
  const [over, setOver] = useState(false);

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const overEv = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // allow the drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const ui = useUi.getState();
      const fg = useSessions.getState().fg;
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (uploadDialogOpen() || ui.dialog) {
        ui.toast('info', 'Close the open dialog before dropping a file.');
        return;
      }
      if (!fg) {
        ui.toast('error', 'Open a session first: uploads are sent to the foreground world.');
        return;
      }
      void readDroppedFile(file).then((r) => openUpload(fg, r));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overEv);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', overEv);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return over ? (
    <div className="cw-drop" aria-hidden="true">
      Drop a text file to upload it
    </div>
  ) : null;
}
