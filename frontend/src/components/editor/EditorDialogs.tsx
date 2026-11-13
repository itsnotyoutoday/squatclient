import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../dialogs/Dialog';
import { SideBySide } from './SideBySide';
import { expand } from '../../lib/mushcode';
import { expandEscapes } from '../../lib/editor/escapes';
import { fuzzyFilter } from '../../lib/editor/fuzzy';
import { pack } from '../../lib/editor/serialize';
import type { ViewMode } from '../../lib/editor/serialize';
import {
  closeObject,
  fetchTheirs,
  getBuffer,
  getObject,
  resolveConflict,
  saveAll,
  selectAttr,
  useEditor,
  useEditorUi,
} from '../../state/editorStore';

/** A value as shown for comparison: formatted code (code view) or `%r` as line breaks (line-break view). */
const shown = (mode: ViewMode, raw: string): string => (mode === 'lines' ? expandEscapes(raw) : expand(raw));

/** Somebody changed the attribute since it was opened: choose Overwrite / Reload theirs / Keep editing. */
export function ConflictDialog({ sid, dbref, attr }: { sid: string; dbref: string; attr: string }) {
  const buf = useEditor((s) => s.ws[sid]?.objects.find((o) => o.dbref === dbref)?.buffers[attr]);
  if (!buf?.conflict) return null;
  const mine = pack(buf.mode, buf.text);
  const mineRaw = mine.ok ? mine.raw : buf.text;
  const theirs = buf.conflict.theirs;
  const close = (): void => void resolveConflict(sid, dbref, attr, 'keep');
  return (
    <Dialog
      title={`${attr} changed in the game`}
      wide
      onClose={close}
      footer={
        <>
          <button
            type="button"
            className="danger"
            onClick={() => void resolveConflict(sid, dbref, attr, 'overwrite')}
          >
            Overwrite
          </button>
          <button type="button" onClick={() => void resolveConflict(sid, dbref, attr, 'reload')}>
            Reload theirs
          </button>
          <button type="button" className="primary" data-autofocus onClick={close}>
            Keep editing
          </button>
        </>
      }
    >
      <p>
        {dbref}/{attr} was changed by someone or something else after you opened it. Nothing has been saved.
        <strong> Overwrite</strong> stores your version, <strong>Reload theirs</strong> discards your changes
        and
        <strong> Keep editing</strong> goes back to the editor (your next save will then overwrite).
        {!buf.conflict.theirsExists && ' The attribute no longer exists in the game.'}
      </p>
      <SideBySide
        a={shown(buf.mode, theirs)}
        b={shown(buf.mode, mineRaw)}
        leftLabel="Game now (theirs)"
        rightLabel="Your version"
      />
    </Dialog>
  );
}

/** Compare the buffer with the game's current value (fetched when opened). */
export function CompareDialog() {
  const c = useEditorUi((s) => s.compare);
  const [theirs, setTheirs] = useState<{ value: string; exists: boolean } | null | undefined>(undefined);
  useEffect(() => {
    setTheirs(undefined);
    if (!c) return;
    let live = true;
    void fetchTheirs(c.sid, c.dbref, c.attr).then((r) => live && setTheirs(r));
    return () => {
      live = false;
    };
  }, [c]);
  const buf = c ? getBuffer(c.sid, c.dbref, c.attr) : undefined;
  if (!c || !buf) return null;
  const close = (): void => useEditorUi.getState().set({ compare: null });
  const mine = pack(buf.mode, buf.text);
  return (
    <Dialog
      title={`Compare ${c.attr} on ${c.dbref}`}
      wide
      onClose={close}
      footer={
        <button type="button" data-autofocus onClick={close}>
          Close
        </button>
      }
    >
      {theirs === undefined && <p role="status">Reading the game&apos;s current value...</p>}
      {theirs === null && <p role="alert">Could not read the current value from the game.</p>}
      {theirs && (
        <SideBySide
          a={shown(buf.mode, theirs.value)}
          b={shown(buf.mode, mine.ok ? mine.raw : buf.text)}
          leftLabel="Game now"
          rightLabel="Editor"
        />
      )}
    </Dialog>
  );
}

/** Cmd/Ctrl-P: jump to an attribute of the active object by fuzzy name. */
export function QuickOpen({ sid, dbref }: { sid: string; dbref: string }) {
  const attrs = useEditor((s) => s.ws[sid]?.objects.find((o) => o.dbref === dbref)?.attrs);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const list = useMemo(() => fuzzyFilter(q, attrs ?? [], (a) => a.name).slice(0, 50), [q, attrs]);
  const close = (): void => useEditorUi.getState().set({ quickOpen: false });
  const choose = (name: string | undefined): void => {
    if (!name) return;
    close();
    void selectAttr(sid, dbref, name).then(() => useEditorUi.getState().set({ focusTick: Date.now() }));
  };
  return (
    <Dialog title="Go to attribute" onClose={close}>
      <input
        className="ew-quickinput"
        role="combobox"
        aria-expanded="true"
        aria-controls="ew-quick-list"
        aria-activedescendant={list[i] ? `ew-quick-${list[i].name}` : undefined}
        aria-label="Attribute name"
        placeholder="Type to filter attributes"
        value={q}
        spellCheck={false}
        data-autofocus
        onChange={(e) => {
          setQ(e.target.value);
          setI(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setI((x) => Math.min(list.length - 1, x + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setI((x) => Math.max(0, x - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(list[i]?.name);
          }
        }}
      />
      <ul id="ew-quick-list" className="ew-quicklist" role="listbox" aria-label="Matching attributes">
        {list.map((a, k) => (
          <li
            key={a.name}
            id={`ew-quick-${a.name}`}
            role="option"
            aria-selected={k === i}
            className={k === i ? 'ew-cursor' : undefined}
            onMouseEnter={() => setI(k)}
            onClick={() => choose(a.name)}
          >
            {a.name}
          </li>
        ))}
        {list.length === 0 && <li className="dim">No attribute matches.</li>}
      </ul>
    </Dialog>
  );
}

/** Closing a tab with unsaved attributes: save them, discard them, or stay. */
export function CloseConfirm() {
  const c = useEditorUi((s) => s.closeConfirm);
  const [busy, setBusy] = useState(false);
  if (!c) return null;
  const name = getObject(c.sid, c.dbref)?.name ?? c.dbref;
  const cancel = (): void => useEditorUi.getState().set({ closeConfirm: null });
  return (
    <Dialog
      title={`Unsaved changes in ${name}`}
      onClose={cancel}
      footer={
        <>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void saveAll(c.sid, c.dbref).then(() => {
                setBusy(false);
                const r = closeObject(c.sid, c.dbref);
                useEditorUi.getState().set({
                  closeConfirm: r.closed ? null : { ...c, dirty: r.dirty },
                });
              });
            }}
          >
            Save all and close
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              closeObject(c.sid, c.dbref, true);
              useEditorUi.getState().set({ closeConfirm: null });
            }}
          >
            Discard changes
          </button>
          <button type="button" data-autofocus onClick={cancel}>
            Cancel
          </button>
        </>
      }
    >
      <p>
        {c.dirty.length === 1 ? 'This attribute has' : 'These attributes have'} changes that are not saved:
      </p>
      <ul>
        {c.dirty.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </Dialog>
  );
}
