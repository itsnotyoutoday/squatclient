import { useState } from 'react';
import { Dialog } from '../dialogs/Dialog';
import { useUi } from '../../state/stores';
import {
  describeFailure,
  forgetAttr,
  getBuffer,
  loadObject,
  announce,
  gameText,
} from '../../state/editorStore';
import { closeAttrAction, useDetails } from '../../state/detailsStore';
import { checkAttrName } from '../../lib/editor/validate';
import { checkObject } from '../../lib/editor/validate';
import { Busy, FieldError } from './PropWidgets';

/** Rename, delete or change the owner of an attribute, with a confirmation sentence and the game's reply on refusal. */
export function AttrActionDialog() {
  const a = useDetails((s) => s.attrAction);
  if (!a) return null;
  return <Body key={`${a.sid}|${a.dbref}|${a.attr}|${a.kind}`} {...a} />;
}

function Body({
  sid,
  dbref,
  attr,
  kind,
}: {
  sid: string;
  dbref: string;
  attr: string;
  kind: 'rename' | 'delete' | 'owner';
}) {
  const engine = useUi((s) => s.engine);
  const [text, setText] = useState(kind === 'rename' ? attr : '');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<{ text: string; reply: string } | null>(null);
  const dirty = !!getBuffer(sid, dbref, attr)?.dirty;
  const bad =
    kind === 'rename'
      ? text === attr
        ? 'Type the new name.'
        : checkAttrName(text.toUpperCase())
      : kind === 'owner'
        ? text.trim()
          ? checkObject(text.trim())
          : 'Type a player: #number or name.'
        : null;
  const title =
    kind === 'rename'
      ? 'Rename attribute'
      : kind === 'delete'
        ? 'Delete attribute'
        : 'Change attribute owner';
  const sentence =
    kind === 'rename'
      ? `Rename ${attr} to ${text.toUpperCase()} on ${dbref}? The value is copied to the new name and checked, then ${attr} is cleared.`
      : kind === 'delete'
        ? `Delete ${attr} from ${dbref}? Its value is cleared in the game; you can only get it back from a copy.`
        : `Give ${attr} on ${dbref} to ${text.trim() || '...'}?`;

  const run = async (): Promise<void> => {
    if (!engine) return;
    setBusy(true);
    setFail(null);
    const name = text.trim().toUpperCase();
    const r =
      kind === 'rename'
        ? await engine.editRenameAttr(sid, dbref, attr, name)
        : kind === 'delete'
          ? await engine.editDeleteAttr(sid, dbref, attr)
          : await engine.editAttrChown(sid, dbref, attr, text.trim());
    setBusy(false);
    if (!r.ok) {
      const reply = r.reply || gameText(r.error);
      setFail({ text: r.code === 'invalid' ? reply : describeFailure(r, attr), reply });
      announce(`${title} failed. ${reply}`, true);
      return;
    }
    announce(kind === 'owner' ? `Owner of ${attr} changed.` : `${title}: done.`);
    if (kind === 'delete') {
      forgetAttr(sid, dbref, attr);
      await loadObject(sid, dbref);
    } else if (kind === 'rename') {
      forgetAttr(sid, dbref, attr);
      await loadObject(sid, dbref, { select: name });
    }
    closeAttrAction();
  };

  return (
    <Dialog
      title={title}
      onClose={closeAttrAction}
      footer={
        <>
          <button type="button" onClick={closeAttrAction}>
            Cancel
          </button>
          <button
            type="button"
            className={kind === 'delete' ? 'danger' : 'primary'}
            disabled={busy || !!bad || dirty}
            onClick={() => void run()}
          >
            {busy ? <Busy label="Working" /> : kind === 'delete' ? 'Delete' : 'Apply'}
          </button>
        </>
      }
    >
      <form
        className="ew-pickform"
        onSubmit={(e) => {
          e.preventDefault();
          if (!bad && !dirty && kind !== 'delete') void run();
        }}
      >
        {kind !== 'delete' && (
          <label className="ew-picklabel">
            {kind === 'rename' ? 'New name' : 'New owner (a player)'}
            <input value={text} spellCheck={false} data-autofocus onChange={(e) => setText(e.target.value)} />
          </label>
        )}
        <p role="status" aria-live="polite">
          <strong>{sentence}</strong>
        </p>
        {dirty && kind !== 'owner' && (
          <FieldError text={`You have unsaved changes in ${attr}. Save or revert them first.`} />
        )}
        {bad && text !== attr && text !== '' && <FieldError text={bad} />}
        {fail && <FieldError text={fail.text} reply={fail.reply} />}
      </form>
    </Dialog>
  );
}
