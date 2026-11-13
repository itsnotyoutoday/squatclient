import { useEffect, useState } from 'react';
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
  openLockEditor,
  openPickDialog,
  setLockFlag,
  setWarnings,
  openPlaceDialog,
  rename,
  setFlag,
  setLock,
  setParent,
  setPower,
  setZone,
  useDetails,
} from '../../state/detailsStore';
import { LOCK_FLAG_HELP, LOCK_FLAG_NAMES, checkName, typeLabel } from '../../lib/editor/props';
import { RawExamine } from './RawExamine';
import { useUi } from '../../state/stores';
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
  const [tab, setTab] = useState<'overview' | 'raw'>('overview');

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

      <div className="ew-dettabs" role="tablist" aria-label="Details views">
        {(['overview', 'raw'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`ew-dtab-${t}`}
            aria-selected={tab === t}
            aria-controls="ew-dpanel"
            tabIndex={tab === t ? 0 : -1}
            className={tab === t ? 'ew-dtab ew-active' : 'ew-dtab'}
            onClick={() => setTab(t)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                setTab(t === 'overview' ? 'raw' : 'overview');
                setTimeout(
                  () => document.getElementById(`ew-dtab-${t === 'overview' ? 'raw' : 'overview'}`)?.focus(),
                  0,
                );
              }
            }}
          >
            {t === 'overview' ? 'Overview' : 'Raw examine'}
          </button>
        ))}
      </div>
      {tab === 'raw' ? (
        <RawExamine sid={sid} dbref={obj.dbref} />
      ) : (
        <div className="ew-detscroll" id="ew-dpanel" role="tabpanel" aria-labelledby="ew-dtab-overview">
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
              <LocksSection
                sid={sid}
                dbref={obj.dbref}
                d={d}
                readOnly={readOnly}
                busy={busy}
                failed={failed}
              />
              <WarningsSection
                sid={sid}
                dbref={obj.dbref}
                d={d}
                readOnly={readOnly}
                busy={busy}
                failed={failed}
              />
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
      )}

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
      {Object.entries(d.extra ?? {}).map(([k, v]) => (
        <Row key={k} label={k.charAt(0).toUpperCase() + k.slice(1)}>
          {v}
        </Row>
      ))}
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
      {field === 'parent' && d.parentChain.length > 1 && (
        <span className="dim ew-chain">
          {' '}
          inherits from{' '}
          {d.parentChain.slice(1).map((p, i) => (
            <span key={p.dbref}>
              {i > 0 && ' > '}
              {open ? (
                <button type="button" className="ew-linkbtn" onClick={() => open(p.dbref)}>
                  {p.name ? `${p.name} (${p.dbref})` : p.dbref}
                </button>
              ) : (
                p.dbref
              )}
            </span>
          ))}
        </span>
      )}
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
  return (
    <Section
      title={`Locks (${d.locks.length})`}
      id={`ew-h-locks-${dbref.slice(1)}`}
      actions={
        <button type="button" disabled={readOnly} onClick={() => openLockEditor(sid, dbref, '')}>
          New lock...
        </button>
      }
    >
      {d.locks.length === 0 && <p className="dim ew-nochip">No locks set.</p>}
      <ul className="ew-locks" aria-label="Locks">
        {d.locks.map((l) => {
          const k = `lock:${l.type}`;
          const errs = Object.entries(failed).filter(
            ([fk]) => fk === k || fk.startsWith(`lockflag:${l.type}:`),
          );
          return (
            <li key={l.type} className="ew-lock-row">
              <div className="ew-fieldrow">
                <span className="ew-lockname">{l.type}</span>
                <code className="ew-lockexpr">{l.expr || '(empty)'}</code>
                <span className="ew-factions">
                  {busy[k] ? (
                    <Busy label={`Updating ${l.type} lock`} />
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={readOnly}
                        aria-label={`Edit ${l.type} lock`}
                        onClick={() => openLockEditor(sid, dbref, l.type)}
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
                  )}
                </span>
              </div>
              <div className="ew-lockflags" role="group" aria-label={`Flags of the ${l.type} lock`}>
                {[
                  ...LOCK_FLAG_NAMES,
                  ...l.flags.filter((f) => !(LOCK_FLAG_NAMES as readonly string[]).includes(f)),
                ].map((f) => {
                  const on = l.flags.includes(f);
                  const bk = `lockflag:${l.type}:${f}`;
                  return (
                    <button
                      key={f}
                      type="button"
                      className={on ? 'ew-lflag ew-on' : 'ew-lflag'}
                      aria-pressed={on}
                      disabled={readOnly || busy[bk]}
                      title={`${f}: ${LOCK_FLAG_HELP[f] ?? ''}`}
                      onClick={() => void setLockFlag(sid, dbref, l.type, f, !on)}
                    >
                      {busy[bk] ? <Busy label={`Updating ${f}`} /> : null}
                      {f}
                    </button>
                  );
                })}
              </div>
              {errs.map(([fk, f]) => (
                <FieldError key={fk} text={f.text} reply={f.reply} />
              ))}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function WarningsSection({ sid, dbref, d, readOnly, busy, failed }: SecProps) {
  const engine = useUi((s) => s.engine);
  const [text, setText] = useState('');
  const [lines, setLines] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Section title="Warnings" id={`ew-h-warn-${dbref.slice(1)}`}>
      <Row label="Checks">
        {d.warnings ? <code>{d.warnings}</code> : <span className="dim">(not reported by the game)</span>}
      </Row>
      <form
        className="ew-fieldrow"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void setWarnings(sid, dbref, text.trim());
        }}
      >
        <input
          aria-label="Warnings to set"
          placeholder="normal, all, none, exit-unlinked ..."
          value={text}
          disabled={readOnly || busy.warnings}
          spellCheck={false}
          className="ew-nameinput"
          onChange={(e) => setText(e.target.value)}
        />
        {busy.warnings ? (
          <Busy label="Setting warnings" />
        ) : (
          <button type="submit" disabled={readOnly || !text.trim()}>
            Set
          </button>
        )}
      </form>
      {failed.warnings && <FieldError text={failed.warnings.text} reply={failed.warnings.reply} />}
      <div className="ew-fieldrow">
        <button
          type="button"
          disabled={checking}
          onClick={() => {
            if (!engine) return;
            setChecking(true);
            setErr('');
            void engine.editWCheck(sid, dbref).then((r) => {
              setChecking(false);
              if (r.ok) setLines(r.lines);
              else setErr(r.error ? r.error.replace(/^engine: [^:]*: /, '') : 'The check failed.');
            });
          }}
        >
          Run @wcheck
        </button>
        {checking && <Busy label="Checking" />}
      </div>
      {err && <FieldError text={err} />}
      {lines && (
        <pre className="ew-wcheck" aria-label="Warning check result" tabIndex={0}>
          {lines.length ? lines.join('\n') : 'No warnings.'}
        </pre>
      )}
    </Section>
  );
}
