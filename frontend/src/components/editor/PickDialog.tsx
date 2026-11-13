import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../dialogs/Dialog';
import { useUi } from '../../state/stores';
import { chown, closePickDialog, setParent, setZone, useDetails } from '../../state/detailsStore';
import { describeFailure } from '../../state/editorStore';
import { checkObject } from '../../lib/editor/validate';
import { Busy, FieldError } from './PropWidgets';

const TEXT = {
  owner: {
    title: 'Change owner',
    label: 'New owner (a player: #number or name)',
    verb: 'Give',
    note: 'Most games only let you give an object away to yourself, or when you are a wizard.',
  },
  parent: {
    title: 'Change parent',
    label: 'New parent (#number or name)',
    verb: 'Set',
    note: 'The object inherits attributes from its parent.',
  },
  zone: {
    title: 'Change zone',
    label: 'New zone object (#number or name)',
    verb: 'Set',
    note: 'A zone object controls everything in its zone.',
  },
} as const;

/** Pick an object for the owner, parent or zone; the game's name for it is shown before anything changes. */
export function PickDialog() {
  const p = useDetails((s) => s.pick);
  if (!p) return null;
  return <PickBody key={`${p.sid}|${p.dbref}|${p.field}`} sid={p.sid} dbref={p.dbref} field={p.field} />;
}

function PickBody({ sid, dbref, field }: { sid: string; dbref: string; field: 'owner' | 'parent' | 'zone' }) {
  const engine = useUi((s) => s.engine);
  const t = TEXT[field];
  const [text, setText] = useState('');
  const [found, setFound] = useState<{ dbref: string; name: string } | null>(null);
  const [err, setErr] = useState('');
  const [checking, setChecking] = useState(false);
  const failure = useDetails((s) => s.entries[`${sid}|${dbref}`]?.failed[field]);
  const busy = useDetails((s) => !!s.entries[`${sid}|${dbref}`]?.busy[field]);
  const token = useRef(0);

  useEffect(() => {
    const q = text.trim();
    setFound(null);
    if (!engine || !q) {
      setErr('');
      return;
    }
    const bad = checkObject(q);
    if (bad) {
      setErr(bad);
      return;
    }
    setErr('');
    const mine = ++token.current;
    setChecking(true);
    const timer = setTimeout(() => {
      void engine.editResolve(sid, q).then((r) => {
        if (token.current !== mine) return;
        setChecking(false);
        if (r.ok) setFound({ dbref: r.dbref, name: r.name });
        else setErr(describeFailure(r, q));
      });
    }, 250);
    return () => {
      clearTimeout(timer);
      setChecking(false);
    };
  }, [engine, sid, text]);

  const apply = async (): Promise<void> => {
    if (!found) return;
    const ok =
      field === 'owner'
        ? await chown(sid, dbref, found.dbref)
        : field === 'parent'
          ? await setParent(sid, dbref, found.dbref)
          : await setZone(sid, dbref, found.dbref);
    if (ok) closePickDialog();
  };

  return (
    <Dialog
      title={t.title}
      onClose={closePickDialog}
      footer={
        <>
          <button type="button" onClick={closePickDialog}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!found || busy} onClick={() => void apply()}>
            {busy ? <Busy label="Working" /> : 'Apply'}
          </button>
        </>
      }
    >
      <form
        className="ew-pickform"
        onSubmit={(e) => {
          e.preventDefault();
          void apply();
        }}
      >
        <label className="ew-picklabel">
          {t.label}
          <input value={text} spellCheck={false} data-autofocus onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="ew-pickstate" role="status" aria-live="polite">
          {checking && <Busy label="Looking it up" />}
          {found && (
            <strong>
              {t.verb} {found.name} ({found.dbref}) as the {field}?
            </strong>
          )}
        </div>
        {err && <FieldError text={err} />}
        {failure && <FieldError text={failure.text} reply={failure.reply} />}
        <p className="dim ew-note">{t.note}</p>
      </form>
    </Dialog>
  );
}
