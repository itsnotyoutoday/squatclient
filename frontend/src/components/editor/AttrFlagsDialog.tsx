import { useEffect, useState } from 'react';
import { Dialog } from '../dialogs/Dialog';
import { isReadOnlyObject, useEditor } from '../../state/editorStore';
import { closeAttrFlags, loadAttrFlags, toggleAttrFlag, useDetails } from '../../state/detailsStore';
import { ATTR_FLAG_HELP, ATTR_FLAG_NAMES } from '../../lib/editor/props';
import { Busy, FieldError } from './PropWidgets';

/** Attribute flags (no_command, no_inherit, visual, safe, locked...) of one attribute, as checkboxes. */
export function AttrFlagsDialog() {
  const a = useDetails((s) => s.attrFlags);
  if (!a) return null;
  return <Body key={`${a.sid}|${a.dbref}|${a.attr}`} sid={a.sid} dbref={a.dbref} attr={a.attr} />;
}

function Body({ sid, dbref, attr }: { sid: string; dbref: string; attr: string }) {
  const obj = useEditor((s) => s.ws[sid]?.objects.find((o) => o.dbref === dbref));
  const entry = obj?.attrs.find((x) => x.name === attr);
  const [loading, setLoading] = useState(entry?.flags === undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ flag: string; text: string } | null>(null);
  const [note, setNote] = useState('');
  const readOnly = !!obj && isReadOnlyObject(obj);
  const current = (entry?.flags ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((f) => f.toLowerCase());
  const extra = current.filter((f) => !(ATTR_FLAG_NAMES as readonly string[]).includes(f));

  useEffect(() => {
    if (entry?.flags !== undefined) return;
    let live = true;
    void loadAttrFlags(sid, dbref, attr).then(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (flag: string, on: boolean): Promise<void> => {
    setBusy(flag);
    setErr(null);
    setNote('');
    const r = await toggleAttrFlag(sid, dbref, attr, flag, on);
    setBusy(null);
    if (r.ok) setNote(`${flag}: ${r.reply || 'done.'}`);
    else setErr({ flag, text: r.text });
  };

  return (
    <Dialog
      title="Attribute flags"
      onClose={closeAttrFlags}
      footer={
        <button type="button" className="primary" data-autofocus onClick={closeAttrFlags}>
          Close
        </button>
      }
    >
      <div className="ew-attrflags" data-testid="attr-flags">
        <p>
          Flags of <strong>&amp;{attr}</strong> <span className="dim">on {dbref}</span>{' '}
          {loading && <Busy label="Loading" />}
        </p>
        {readOnly && (
          <p className="dim ew-note">You do not control this object; the game will refuse changes.</p>
        )}
        <ul className="ew-flaglist">
          {[...ATTR_FLAG_NAMES, ...extra].map((f) => {
            const on = current.includes(f);
            return (
              <li key={f}>
                <label title={ATTR_FLAG_HELP[f] ?? ''}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={readOnly || loading || busy !== null}
                    onChange={(e) => void toggle(f, e.target.checked)}
                  />{' '}
                  <span className="ew-flagname">{f}</span>
                  {busy === f && <Busy label={`Updating ${f}`} />}
                </label>
                {ATTR_FLAG_HELP[f] && <span className="dim ew-flaghelp">{ATTR_FLAG_HELP[f]}</span>}
                {err?.flag === f && <FieldError text={err.text} />}
              </li>
            );
          })}
        </ul>
        <div role="status" aria-live="polite" className="dim">
          {note}
        </div>
      </div>
    </Dialog>
  );
}
