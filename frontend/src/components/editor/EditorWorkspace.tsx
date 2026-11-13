import { useEffect } from 'react';
import { useSessions, useUi } from '../../state/stores';
import {
  getWorkspace,
  restoreWorkspace,
  save,
  saveAll,
  selectObjectIndex,
  showDetails,
  startPersistence,
  useEditor,
  useEditorUi,
} from '../../state/editorStore';
import {
  activeEditorSession,
  closeActiveEditorTab,
  leaveEditor,
  pickEditorSession,
  promptNewTab,
} from '../../lib/editor/view';
import { WorldTabs } from './WorldTabs';
import { ObjectTabs } from './ObjectTabs';
import { AttrList } from './AttrList';
import { AttrEditor } from './AttrEditor';
import { DetailsPane } from './DetailsPane';
import { OverviewHeader } from './OverviewHeader';
import { PlaceDialog } from './PlaceDialog';
import { PickDialog } from './PickDialog';
import { AttrMenu } from './AttrMenu';
import { AttrActionDialog } from './AttrActionDialog';
import { LockEditor } from './LockEditor';
import { ensureDetails, openPlaceDialog } from '../../state/detailsStore';
import { CloseConfirm, CompareDialog, ConflictDialog, QuickOpen } from './EditorDialogs';
import '../../styles/editorworkspace.css';

/** The `/edit` view: worlds, open objects, attribute list and code editor in one full-window workspace. */
export default function EditorWorkspace() {
  const sid = useSessions(pickEditorSession);
  const sessions = useSessions((s) => s.sessions);
  const state = sid ? sessions[sid]?.state : undefined;
  const ws = useEditor((s) => (sid ? s.ws[sid] : undefined));
  const obj = ws?.objects.find((o) => o.dbref === ws.activeObject);
  const quickOpen = useEditorUi((s) => s.quickOpen);
  const announcement = useEditor((s) => s.announcement);

  useEffect(() => startPersistence(), []);
  const activeDbref = obj?.dbref;
  useEffect(() => {
    if (sid && activeDbref && state === 'connected') ensureDetails(sid, activeDbref);
  }, [sid, activeDbref, state]);
  useEffect(() => {
    if (sid && state === 'connected') void restoreWorkspace(sid);
  }, [sid, state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (useUi.getState().view !== 'editor' || useUi.getState().dialog) return;
      if (document.querySelector('[role="dialog"]')) return;
      const w = activeEditorSession();
      const k = e.key.toLowerCase();
      const mod = (e.metaKey || e.ctrlKey) && !e.altKey;
      const active = w ? getWorkspace(w).activeObject : null;
      const o = w ? getWorkspace(w).objects.find((x) => x.dbref === active) : undefined;
      if (e.key === 'Escape') {
        const sel = window.getSelection()?.toString() ?? '';
        const inCm = !!(e.target as HTMLElement | null)?.closest?.('.cm-search,.cm-panels');
        if (!e.defaultPrevented && !sel && !inCm) {
          e.preventDefault();
          leaveEditor();
        }
        return;
      }
      if (!mod) return;
      if (k === 's' && !e.shiftKey) {
        e.preventDefault();
        if (w && o?.activeAttr) void save(w, o.dbref, o.activeAttr);
      } else if (k === 's' && e.shiftKey) {
        e.preventDefault();
        if (w && o) void saveAll(w, o.dbref);
      } else if (k === 'w' && !e.shiftKey) {
        e.preventDefault();
        closeActiveEditorTab();
      } else if (k === 'd' && e.shiftKey) {
        e.preventDefault();
        if (w && o) showDetails(w, o.dbref);
      } else if (k === 'm' && e.shiftKey) {
        e.preventDefault();
        if (w && o?.details && o.controls !== false) openPlaceDialog(w, o.dbref, 'move');
      } else if (k === 't' && !e.shiftKey) {
        e.preventDefault();
        promptNewTab();
      } else if (k === 'p' && !e.shiftKey) {
        e.preventDefault();
        if (o) useEditorUi.getState().set({ quickOpen: true });
      } else if (k === 'f' && e.shiftKey) {
        e.preventDefault();
        if (o) useEditorUi.getState().set({ searchPanel: true });
      } else if (/^[1-9]$/.test(e.key) && !e.shiftKey) {
        e.preventDefault();
        if (w) selectObjectIndex(w, Number(e.key) - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const conflictAttr = obj ? Object.keys(obj.buffers).find((a) => obj.buffers[a].conflict) : undefined;

  return (
    <main className="ew-root" aria-label="Object Editor" data-testid="editor-workspace">
      <WorldTabs sid={sid} />
      {sid ? (
        <>
          <ObjectTabs sid={sid} />
          {obj && <OverviewHeader sid={sid} obj={obj} />}
          <div className="ew-body">
            {obj ? (
              <>
                <div className="ew-side">
                  <AttrList key={obj.dbref} sid={sid} obj={obj} />
                </div>
                {obj.details ? <DetailsPane sid={sid} obj={obj} /> : <AttrEditor sid={sid} obj={obj} />}
              </>
            ) : (
              <div className="ew-welcome">
                <h1>Object Editor</h1>
                <p>Open an object to edit its attributes like files.</p>
                <p className="dim">
                  Use the + above, press Cmd/Ctrl-T, or type <code>/edit #123</code> or{' '}
                  <code>/edit #123/ATTRIBUTE</code> in the terminal.
                </p>
                <button type="button" className="primary" onClick={promptNewTab}>
                  Open an object
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="ew-welcome">
          <h1>Object Editor</h1>
          <p>Connect to a world to edit its objects. The editor works through the game connection.</p>
          <div className="actions">
            <button type="button" className="primary" onClick={() => useUi.getState().openDialog('worlds')}>
              Worlds
            </button>
            <button type="button" onClick={leaveEditor}>
              Back to the terminal
            </button>
          </div>
        </div>
      )}
      <div
        className="ew-sr"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="editor-announce"
      >
        {announcement && !announcement.urgent ? announcement.text : ''}
      </div>
      <div className="ew-sr" role="alert" data-testid="editor-alert">
        {announcement?.urgent ? announcement.text : ''}
      </div>
      {sid && conflictAttr && obj && <ConflictDialog sid={sid} dbref={obj.dbref} attr={conflictAttr} />}
      <CompareDialog />
      <PlaceDialog />
      <PickDialog />
      <AttrMenu />
      <AttrActionDialog />
      <LockEditor />
      <CloseConfirm />
      {quickOpen && sid && obj && <QuickOpenHost sid={sid} dbref={obj.dbref} />}
    </main>
  );
}

function QuickOpenHost({ sid, dbref }: { sid: string; dbref: string }) {
  return <QuickOpen sid={sid} dbref={dbref} />;
}
