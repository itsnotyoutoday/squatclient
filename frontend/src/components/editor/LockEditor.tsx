import { useRef, useState } from 'react';
import { Dialog } from '../dialogs/Dialog';
import { useUi } from '../../state/stores';
import { closeLockEditor, setLock, useDetails } from '../../state/detailsStore';
import { LOCK_SNIPPETS, LOCK_TYPES, checkLockExpr, checkLockType, checkParens } from '../../lib/editor/props';
import { checkObject } from '../../lib/editor/validate';
import { Busy, FieldError } from './PropWidgets';

/** Edit one lock: key text with a helper, a Test against a chosen target, Save, Clear. */
export function LockEditor() {
  const l = useDetails((s) => s.lockEditor);
  if (!l) return null;
  return <Body key={`${l.sid}|${l.dbref}|${l.type}`} sid={l.sid} dbref={l.dbref} type={l.type} />;
}

function Body({ sid, dbref, type }: { sid: string; dbref: string; type: string }) {
  const engine = useUi((s) => s.engine);
  const d = useDetails((s) => s.entries[`${sid}|${dbref}`]?.data);
  const isNew = type === '';
  const existing = d?.locks.find((l) => l.type.toLowerCase() === type.toLowerCase());
  const [lockType, setLockType] = useState(type);
  const [expr, setExpr] = useState(existing?.expr ?? '');
  const [target, setTarget] = useState('me');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const key = `lock:${lockType}`;
  const busy = useDetails((s) => !!s.entries[`${sid}|${dbref}`]?.busy[key]);
  const failure = useDetails((s) => s.entries[`${sid}|${dbref}`]?.failed[key]);
  const typeErr = lockType ? checkLockType(lockType) : null;
  const exprErr = expr ? checkLockExpr(expr) : null;
  const parenErr = checkParens(expr);
  const stored = d?.locks.find((l) => l.type.toLowerCase() === lockType.toLowerCase());
  const readOnly = false;

  const insert = (text: string): void => {
    const el = input.current;
    const a = el?.selectionStart ?? expr.length;
    const b = el?.selectionEnd ?? expr.length;
    const next = expr.slice(0, a) + text + expr.slice(b);
    setExpr(next);
    setResult(null);
    const caret = text === '()' ? a + 1 : a + text.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const test = async (): Promise<void> => {
    if (!engine) return;
    const bad = checkObject(target.trim());
    if (bad) {
      setResult({ ok: false, text: bad });
      return;
    }
    setTesting(true);
    const r = await engine.editTestLock(sid, dbref, lockType, target.trim());
    setTesting(false);
    if (!r.ok)
      setResult({ ok: false, text: r.error ? r.error.replace(/^engine: [^:]*: /, '') : 'The test failed.' });
    else if (r.result === 'true') setResult({ ok: true, text: `The lock passes for ${target.trim()}.` });
    else if (r.result === 'false')
      setResult({ ok: true, text: `The lock does not pass for ${target.trim()}.` });
    else setResult({ ok: false, text: `The game could not tell${r.raw ? `: ${r.raw}` : '.'}` });
  };

  const save = async (): Promise<void> => {
    if (typeErr || !lockType || exprErr || !expr.trim() || parenErr) return;
    if (await setLock(sid, dbref, lockType, expr.trim())) closeLockEditor();
  };
  const clear = async (): Promise<void> => {
    if (await setLock(sid, dbref, lockType, '')) closeLockEditor();
  };

  return (
    <Dialog
      title={isNew ? 'New lock' : `Edit ${type} lock`}
      wide
      onClose={closeLockEditor}
      footer={
        <>
          {!isNew && (
            <button type="button" className="danger" disabled={busy || !stored} onClick={() => void clear()}>
              Clear lock
            </button>
          )}
          <button type="button" onClick={closeLockEditor}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || readOnly || !lockType || !!typeErr || !expr.trim() || !!exprErr || !!parenErr}
            onClick={() => void save()}
          >
            {busy ? <Busy label="Saving" /> : 'Save'}
          </button>
        </>
      }
    >
      <form
        className="ew-lockeditor"
        data-testid="lock-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="ew-picklabel">
          Lock type
          <input
            value={lockType}
            list="ew-lockeditor-types"
            disabled={!isNew}
            spellCheck={false}
            placeholder="Basic, Enter, Use ... or user:name"
            data-autofocus={isNew ? true : undefined}
            onChange={(e) => setLockType(e.target.value)}
          />
          <datalist id="ew-lockeditor-types">
            {LOCK_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        {typeErr && <FieldError text={typeErr} />}
        <label className="ew-picklabel">
          Key
          <input
            ref={input}
            className="ew-lockkeyinput"
            value={expr}
            spellCheck={false}
            autoComplete="off"
            placeholder="for example #123 | flag^WIZARD"
            data-autofocus={!isNew ? true : undefined}
            aria-invalid={exprErr || parenErr ? true : undefined}
            onChange={(e) => {
              setExpr(e.target.value);
              setResult(null);
            }}
          />
        </label>
        <div className="ew-snippets" role="group" aria-label="Insert into the key">
          {LOCK_SNIPPETS.map((s) => (
            <button
              key={s.label}
              type="button"
              className="ew-snip"
              title={s.help}
              aria-label={`Insert ${s.help}`}
              onClick={() => insert(s.text)}
            >
              {s.label}
            </button>
          ))}
        </div>
        {exprErr && <FieldError text={exprErr} />}
        {parenErr && !exprErr && <FieldError text={parenErr} />}
        {!exprErr && !parenErr && expr && (
          <p className="dim ew-note" role="status">
            Parentheses balance.
          </p>
        )}
        <fieldset className="ew-testbox">
          <legend>Test</legend>
          <label className="ew-testrow">
            Target
            <input
              aria-label="Test target"
              value={target}
              spellCheck={false}
              onChange={(e) => {
                setTarget(e.target.value);
                setResult(null);
              }}
            />
          </label>
          <button
            type="button"
            disabled={testing || !stored || !lockType || !!typeErr}
            onClick={() => void test()}
          >
            {testing ? <Busy label="Testing" /> : 'Test'}
          </button>
          <p className="dim ew-note">
            Tests the lock as stored in the game, so save changes first. Use me, #number or a name.
          </p>
          {result && (
            <div
              className={result.ok ? 'ew-testok' : 'ew-fielderr'}
              role="status"
              data-testid="lock-test-result"
            >
              {result.text}
            </div>
          )}
        </fieldset>
        {failure && <FieldError text={failure.text} reply={failure.reply} />}
      </form>
    </Dialog>
  );
}
