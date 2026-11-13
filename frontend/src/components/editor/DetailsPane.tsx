import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { EditCatalogItem, EditDetails } from '../../api/types';
import { openTarget, isReadOnlyObject } from '../../state/editorStore';
import type { OpenObject } from '../../state/editorStore';
import {
  clearFailure,
  detailsKey,
  loadDetails,
  loadFlagCatalog,
  loadPowerCatalog,
  openPickDialog,
  openPlaceDialog,
  rename,
  setFlag,
  setLock,
  setParent,
  setPower,
  setZone,
  useDetails,
} from '../../state/detailsStore';
import { LOCK_TYPES, checkLockExpr, checkLockType, checkName, typeLabel } from '../../lib/editor/props';
import { Busy, Chip, FieldError, FlagCombo, Section } from './PropWidgets';

const nameOf = (d: EditDetails, dbref: string): string => (dbref ? (d.names?.[dbref] ?? '') : '');

/** "Nveid (#45)" or "(none)" */
function Ref({ d, dbref, onOpen }: { d: EditDetails; dbref: string; onOpen?: (dbref: string) => void }) {
  if (!dbref) return <span className="dim">(none)</span>;
  const n = nameOf(d, dbref);
  const text = n ? `${n} (${dbref})` : dbref;
  return onOpen ? (
    <button
      type="button"
      className="ew-linkbtn"
      title={`Open ${text} in a new tab`}
      onClick={() => onOpen(dbref)}
    >
      {text}
    </button>
  ) : (
    <span>{text}</span>
  );
}

function tipFor(name: string, items: EditCatalogItem[] | undefined, letters?: string): string {
  const it = items?.find((i) => i.name.toUpperCase() === name.toUpperCase());
  const letter = it?.letter || (name.length === 1 ? name : '');
  return [name + (letter ? ` (${letter})` : ''), it?.desc, letters && !it ? `Letters: ${letters}` : '']
    .filter(Boolean)
    .join(' - ');
}

/** The Object details view: identity, location, relations, flags, powers, locks, contents and exits. */
export function DetailsPane({ sid, obj }: { sid: string; obj: OpenObject }) {
  const key = detailsKey(sid, obj.dbref);
  const entry = useDetails((s) => s.entries[key]);
  const flagCat = useDetails((s) => s.flags[sid]);
  const powerCat = useDetails((s) => s.powers[sid]);
  const d = entry?.data;
  const busy = entry?.busy ?? {};
  const failed = entry?.failed ?? {};
  const readOnly = isReadOnlyObject(obj);

  useEffect(() => {
    if (!useDetails.getState().entries[key]?.data) void loadDetails(sid, obj.dbref);
    void loadFlagCatalog(sid);
    void loadPowerCatalog(sid);
  }, [sid, obj.dbref, key]);

  const open = (dbref: string): void => {
    void openTarget(sid, dbref);
  };
  const anyBusy = Object.keys(busy).length > 0;

  return (
    <section
      className="ew-main ew-details"
      id="ew-panel"
      role="tabpanel"
      aria-labelledby={`ew-tab-${obj.dbref.slice(1)}`}
      aria-busy={entry?.loading || anyBusy}
      data-testid="details-pane"
    >
      {readOnly && (
        <div className="ew-banner ew-warn" role="status" data-testid="details-readonly">
          You do not control this object, so its details are read-only here. Changes would be refused by the
          game.
        </div>
      )}
      {entry?.error && (
        <div className="ew-banner ew-bad" role="alert">
          {entry.error}{' '}
          <button type="button" onClick={() => void loadDetails(sid, obj.dbref)}>
            Retry
          </button>
        </div>
      )}
      <div className="ew-toolbar" role="toolbar" aria-label="Object details tools">
        <h2 className="ew-attrtitle">
          <span className="ew-attrtitle-name">Object details</span> <span className="dim">{obj.dbref}</span>
          {readOnly && <span className="ew-ro"> read-only</span>}
        </h2>
        <span className="ew-grow" />
        {(entry?.loading || anyBusy) && <Busy label="Loading" />}
        <button
          type="button"
          title="Read the details from the game again"
          disabled={entry?.loading || anyBusy}
          onClick={() => void loadDetails(sid, obj.dbref)}
        >
          Refresh
        </button>
      </div>

      <div className="ew-detscroll">
        {!d ? (
          <p className="ew-empty">{entry?.loading || !entry ? 'Loading...' : 'No details.'}</p>
        ) : (
          <div className="ew-detgrid">
            <IdentitySection
              sid={sid}
              dbref={obj.dbref}
              d={d}
              readOnly={readOnly}
              busy={busy}
              failed={failed}
            />
            <LocationSection
              sid={sid}
              dbref={obj.dbref}
              d={d}
              readOnly={readOnly}
              busy={busy}
              failed={failed}
              open={open}
            />
            <RelationsSection
              sid={sid}
              dbref={obj.dbref}
              d={d}
              readOnly={readOnly}
              busy={busy}
              failed={failed}
              open={open}
            />
            <Section title="Flags" id={`ew-h-flags-${obj.dbref.slice(1)}`}>
              <ul className="ew-chips" aria-label="Flags">
                {d.flags.map((f) => (
                  <Chip
                    key={f}
                    name={f}
                    what="flag"
                    tip={tipFor(f, flagCat?.items, d.flagLetters)}
                    busy={busy[`flag:${f.toUpperCase()}`]}
                    disabled={readOnly}
                    onRemove={() => void setFlag(sid, obj.dbref, f, false)}
                  />
                ))}
                {d.flags.length === 0 && <li className="dim ew-nochip">No flags set.</li>}
              </ul>
              {d.flagLetters && <p className="dim ew-letters">Letters: {d.flagLetters}</p>}
              <FlagCombo
                label="Add flag"
                placeholder="Add a flag..."
                cat={flagCat}
                taken={d.flags}
                disabled={readOnly}
                busy={Object.keys(busy).some(
                  (k) => k.startsWith('flag:') && !d.flags.some((f) => k === `flag:${f.toUpperCase()}`),
                )}
                onAdd={(n) => setFlag(sid, obj.dbref, n, true)}
              />
              {Object.entries(failed)
                .filter(([k]) => k.startsWith('flag:'))
                .map(([k, f]) => (
                  <FieldError key={k} text={`${k.slice(5)}: ${f.text}`} reply={f.reply} />
                ))}
            </Section>
            <Section title="Powers" id={`ew-h-powers-${obj.dbref.slice(1)}`}>
              <ul className="ew-chips" aria-label="Powers">
                {d.powers.map((p) => (
                  <Chip
                    key={p}
                    name={p}
                    what="power"
                    tip={tipFor(p, powerCat?.items)}
                    busy={busy[`power:${p.toUpperCase()}`]}
                    disabled={readOnly}
                    onRemove={() => void setPower(sid, obj.dbref, p, false)}
                  />
                ))}
                {d.powers.length === 0 && <li className="dim ew-nochip">No powers.</li>}
              </ul>
              <FlagCombo
                label="Add power"
                placeholder="Add a power..."
                cat={powerCat}
                taken={d.powers}
                disabled={readOnly}
                busy={Object.keys(busy).some(
                  (k) => k.startsWith('power:') && !d.powers.some((f) => k === `power:${f.toUpperCase()}`),
                )}
                onAdd={(n) => setPower(sid, obj.dbref, n, true)}
              />
              {Object.entries(failed)
                .filter(([k]) => k.startsWith('power:'))
                .map(([k, f]) => (
                  <FieldError key={k} text={`${k.slice(6)}: ${f.text}`} reply={f.reply} />
                ))}
            </Section>
            <LocksSection sid={sid} dbref={obj.dbref} d={d} readOnly={readOnly} busy={busy} failed={failed} />
            {(d.type === 'room' || d.type === 'thing' || d.type === 'player' || d.contents.length > 0) && (
              <Section title={`Contents (${d.contents.length})`} id={`ew-h-con-${obj.dbref.slice(1)}`}>
                <RefList items={d.contents} empty="Nothing inside." onOpen={open} />
              </Section>
            )}
            {(d.type === 'room' || d.exits.length > 0) && (
              <Section title={`Exits (${d.exits.length})`} id={`ew-h-exits-${obj.dbref.slice(1)}`}>
                <RefList items={d.exits} empty="No exits." onOpen={open} />
              </Section>
            )}
          </div>
        )}
      </div>

      <div
        className={`ew-detstatus${entry?.status?.kind === 'error' ? ' ew-detstatus-bad' : ''}`}
        role="status"
        aria-live="polite"
        data-testid="details-status"
      >
        {entry?.status ? entry.status.text : 'Changes are sent to the game quietly; its replies show here.'}
      </div>
    </section>
  );
}

interface SecProps {
  sid: string;
  dbref: string;
  d: EditDetails;
  readOnly: boolean;
  busy: Record<string, boolean>;
  failed: Record<string, { text: string; reply: string }>;
  open?: (dbref: string) => void;
}

function RefList({
  items,
  empty,
  onOpen,
}: {
  items: { dbref: string; name: string }[];
  empty: string;
  onOpen(dbref: string): void;
}) {
  if (items.length === 0) return <p className="dim ew-nochip">{empty}</p>;
  return (
    <ul className="ew-reflist">
      {items.map((i) => (
        <li key={i.dbref}>
          <button
            type="button"
            className="ew-linkbtn"
            title={`Open ${i.name} (${i.dbref}) in a new tab`}
            onClick={() => onOpen(i.dbref)}
          >
            {i.name} <span className="dim">{i.dbref}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Row({
  label,
  children,
  actions,
  err,
}: {
  label: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  err?: { text: string; reply: string };
}) {
  return (
    <div className="ew-field">
      <div className="ew-fieldrow">
        <span className="ew-flabel">{label}</span>
        <span className="ew-fvalue">{children}</span>
        {actions && <span className="ew-factions">{actions}</span>}
      </div>
      {err && <FieldError text={err.text} reply={err.reply} />}
    </div>
  );
}

function IdentitySection({ sid, dbref, d, readOnly, busy, failed }: SecProps) {
  const [draft, setDraft] = useState(d.name);
  const [bad, setBad] = useState('');
  useEffect(() => setDraft(d.name), [d.name]);
  const f = failed.rename;
  useEffect(() => {
    if (f) setDraft(d.name); // a refused rename puts the real name back
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);
  const changed = draft !== d.name;
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const m = checkName(draft);
    setBad(m ?? '');
    if (!m && changed) void rename(sid, dbref, draft);
  };
  return (
    <Section title="Identity" id={`ew-h-id-${dbref.slice(1)}`}>
      <form className="ew-field" onSubmit={submit}>
        <div className="ew-fieldrow">
          <label className="ew-flabel" htmlFor={`ew-name-${dbref.slice(1)}`}>
            Name
          </label>
          <span className="ew-fvalue">
            <input
              id={`ew-name-${dbref.slice(1)}`}
              className="ew-nameinput"
              value={draft}
              disabled={readOnly || busy.rename}
              spellCheck={false}
              aria-invalid={bad ? true : undefined}
              onChange={(e) => {
                setDraft(e.target.value);
                setBad('');
                if (f) clearFailure(sid, dbref, 'rename');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && changed) {
                  e.preventDefault();
                  e.stopPropagation();
                  setDraft(d.name);
                  setBad('');
                }
              }}
            />
          </span>
          <span className="ew-factions">
            {busy.rename ? (
              <Busy label="Renaming" />
            ) : (
              <button type="submit" disabled={readOnly || !changed || !draft.trim()}>
                Rename
              </button>
            )}
          </span>
        </div>
        {bad && <FieldError text={bad} />}
        {f && <FieldError text={f.text} reply={f.reply} />}
      </form>
      <Row label="Number">
        <code>{d.dbref}</code>
      </Row>
      <Row label="Type">{typeLabel(d.type)}</Row>
      <Row
        label="Owner"
        err={failed.owner}
        actions={
          busy.owner ? (
            <Busy label="Changing owner" />
          ) : (
            <button type="button" disabled={readOnly} onClick={() => openPickDialog(sid, dbref, 'owner')}>
              Chown...
            </button>
          )
        }
      >
        <Ref d={d} dbref={d.owner} />
      </Row>
      {d.pennies !== null && <Row label="Pennies">{d.pennies}</Row>}
      {d.created && <Row label="Created">{d.created}</Row>}
      {d.modified && <Row label="Modified">{d.modified}</Row>}
      {d.attrCount >= 0 && <Row label="Attributes">{d.attrCount}</Row>}
    </Section>
  );
}

function LocationSection({ sid, dbref, d, readOnly, busy, failed, open }: SecProps) {
  const isExit = d.type === 'exit';
  return (
    <Section title="Location" id={`ew-h-loc-${dbref.slice(1)}`}>
      {d.type === 'room' ? (
        <p className="dim ew-nochip">A room is not inside anything.</p>
      ) : (
        <Row
          label={isExit ? 'Starts in' : 'Inside'}
          err={failed.location}
          actions={
            busy.location ? (
              <Busy label="Moving" />
            ) : (
              <button
                type="button"
                disabled={readOnly}
                title={isExit ? 'Move this exit to another room' : 'Send this object somewhere else'}
                onClick={() => openPlaceDialog(sid, dbref, 'move')}
              >
                Move...
              </button>
            )
          }
        >
          <Ref d={d} dbref={d.location} onOpen={open} />
        </Row>
      )}
      {isExit && (
        <Row
          label="Leads to"
          err={failed.destination}
          actions={
            busy.destination ? (
              <Busy label="Changing destination" />
            ) : (
              <button
                type="button"
                disabled={readOnly}
                onClick={() => openPlaceDialog(sid, dbref, 'destination')}
              >
                Change...
              </button>
            )
          }
        >
          <Ref d={d} dbref={d.destination} onOpen={open} />
        </Row>
      )}
    </Section>
  );
}

function RelationsSection({ sid, dbref, d, readOnly, busy, failed, open }: SecProps) {
  const rel = (field: 'parent' | 'zone', label: string, clear: () => Promise<boolean>) => (
    <Row
      label={label}
      err={failed[field]}
      actions={
        busy[field] ? (
          <Busy label={`Changing ${label.toLowerCase()}`} />
        ) : (
          <>
            <button type="button" disabled={readOnly} onClick={() => openPickDialog(sid, dbref, field)}>
              Change...
            </button>
            <button
              type="button"
              disabled={readOnly || !d[field]}
              aria-label={`Clear ${label.toLowerCase()}`}
              onClick={() => void clear()}
            >
              Clear
            </button>
          </>
        )
      }
    >
      <Ref d={d} dbref={d[field]} onOpen={open} />
    </Row>
  );
  return (
    <Section title="Relations" id={`ew-h-rel-${dbref.slice(1)}`}>
      {rel('parent', 'Parent', () => setParent(sid, dbref, ''))}
      {rel('zone', 'Zone', () => setZone(sid, dbref, ''))}
      {(d.type === 'thing' || d.type === 'player') && (
        <Row
          label="Home"
          err={failed.home}
          actions={
            busy.home ? (
              <Busy label="Changing home" />
            ) : (
              <button type="button" disabled={readOnly} onClick={() => openPlaceDialog(sid, dbref, 'home')}>
                Change...
              </button>
            )
          }
        >
          <Ref d={d} dbref={d.home} onOpen={open} />
        </Row>
      )}
    </Section>
  );
}

function LocksSection({ sid, dbref, d, readOnly, busy, failed }: SecProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [expr, setExpr] = useState('');
  const [errText, setErrText] = useState('');
  const [newType, setNewType] = useState('');
  const [newExpr, setNewExpr] = useState('');
  const [newErr, setNewErr] = useState('');
  const setTypes = useMemo(() => new Set(d.locks.map((l) => l.type.toLowerCase())), [d.locks]);
  const offered = LOCK_TYPES.filter((t) => !setTypes.has(t.toLowerCase()));
  const dlId = `ew-locktypes-${dbref.slice(1)}`;

  const saveEdit = async (type: string): Promise<void> => {
    const m = checkLockExpr(expr);
    setErrText(m ?? '');
    if (m) return;
    if (await setLock(sid, dbref, type, expr)) setEditing(null);
  };
  const add = async (): Promise<void> => {
    const m = checkLockType(newType) ?? checkLockExpr(newExpr);
    setNewErr(m ?? '');
    if (m) return;
    if (await setLock(sid, dbref, newType, newExpr)) {
      setNewType('');
      setNewExpr('');
    }
  };
  return (
    <Section title="Locks" id={`ew-h-locks-${dbref.slice(1)}`}>
      {d.locks.length === 0 && <p className="dim ew-nochip">No locks set.</p>}
      <ul className="ew-locks" aria-label="Locks">
        {d.locks.map((l) => {
          const k = `lock:${l.type}`;
          const f = failed[k];
          return (
            <li key={l.type} className="ew-lock-row">
              <div className="ew-fieldrow">
                <span className="ew-lockname">{l.type}</span>
                {editing === l.type ? (
                  <form
                    className="ew-lockform"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveEdit(l.type);
                    }}
                  >
                    <input
                      aria-label={`${l.type} lock key`}
                      value={expr}
                      autoFocus
                      spellCheck={false}
                      onChange={(e) => {
                        setExpr(e.target.value);
                        setErrText('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditing(null);
                          setErrText('');
                        }
                      }}
                    />
                    <button type="submit" disabled={busy[k]}>
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(null);
                        setErrText('');
                      }}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <code className="ew-lockexpr">{l.expr || '(empty)'}</code>
                )}
                <span className="ew-factions">
                  {busy[k] ? (
                    <Busy label={`Updating ${l.type} lock`} />
                  ) : (
                    editing !== l.type && (
                      <>
                        <button
                          type="button"
                          disabled={readOnly}
                          aria-label={`Edit ${l.type} lock`}
                          onClick={() => {
                            setEditing(l.type);
                            setExpr(l.expr);
                            setErrText('');
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={readOnly}
                          aria-label={`Clear ${l.type} lock`}
                          onClick={() => void setLock(sid, dbref, l.type, '')}
                        >
                          Clear
                        </button>
                      </>
                    )
                  )}
                </span>
              </div>
              {editing === l.type && errText && <FieldError text={errText} />}
              {f && <FieldError text={f.text} reply={f.reply} />}
            </li>
          );
        })}
      </ul>
      <form
        className="ew-newlock"
        aria-label="New lock"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          aria-label="Lock type"
          list={dlId}
          placeholder="Type (Basic...)"
          className="ew-locktype"
          value={newType}
          disabled={readOnly}
          spellCheck={false}
          onChange={(e) => {
            setNewType(e.target.value);
            setNewErr('');
          }}
        />
        <datalist id={dlId}>
          {offered.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <input
          aria-label="New lock key"
          placeholder="Key, for example #123 or flag^WIZARD"
          className="ew-lockkey"
          value={newExpr}
          disabled={readOnly}
          spellCheck={false}
          onChange={(e) => {
            setNewExpr(e.target.value);
            setNewErr('');
          }}
        />
        <button
          type="submit"
          disabled={readOnly || !newType || !newExpr || (!!newType && busy[`lock:${newType}`])}
        >
          New lock
        </button>
        {newType && busy[`lock:${newType}`] && <Busy label="Adding lock" />}
      </form>
      {newErr && <FieldError text={newErr} />}
      {newType && failed[`lock:${newType}`] && !d.locks.some((l) => l.type === newType) && (
        <FieldError text={failed[`lock:${newType}`].text} reply={failed[`lock:${newType}`].reply} />
      )}
    </Section>
  );
}
