import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Dialog } from '../dialogs/Dialog';
import type { EditNearbyResult, EditPlace } from '../../api/types';
import { useUi } from '../../state/stores';
import { useEditor } from '../../state/editorStore';
import {
  closePlaceDialog,
  moveTo,
  recentPlaces,
  rememberPlace,
  setDestination,
  setHome,
  useDetails,
} from '../../state/detailsStore';
import type { PlaceMode } from '../../state/detailsStore';
import { describeFailure } from '../../state/editorStore';
import { Busy, FieldError } from './PropWidgets';

const TITLES: Record<PlaceMode, string> = {
  move: 'Move object',
  home: 'Set home',
  destination: 'Set exit destination',
};
const KEYS: Record<PlaceMode, string> = { move: 'location', home: 'home', destination: 'destination' };
const SEARCH_DELAY = 250;

const placeText = (p: Pick<EditPlace, 'name' | 'dbref'>): string =>
  p.name ? `${p.name} (${p.dbref})` : p.dbref;

/** Arrow keys move between the buttons of one list. */
function rove(e: KeyboardEvent<HTMLUListElement>): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const btns = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
  const i = btns.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  const n = btns[e.key === 'ArrowDown' ? Math.min(btns.length - 1, i + 1) : Math.max(0, i - 1)];
  if (n) {
    e.preventDefault();
    n.focus();
  }
}

interface Entry extends EditPlace {
  via?: string;
}

function PlaceList({
  label,
  items,
  selected,
  current,
  onPick,
  empty,
}: {
  label: string;
  items: Entry[];
  selected: string | null;
  current: string;
  onPick(p: EditPlace): void;
  empty?: string;
}) {
  if (items.length === 0) return empty ? <p className="dim ew-nochip">{empty}</p> : null;
  return (
    <ul className="ew-places" aria-label={label} onKeyDown={rove}>
      {items.map((p) => (
        <li key={p.dbref + (p.via ?? '')}>
          <button
            type="button"
            className={p.dbref === selected ? 'ew-place ew-active' : 'ew-place'}
            aria-pressed={p.dbref === selected}
            onClick={() => onPick(p)}
          >
            <span className="ew-placename">{p.name || p.dbref}</span>
            <span className="dim ew-placemeta">
              {p.dbref}
              {p.type && p.type !== 'room' ? ` - ${p.type}` : ''}
              {p.via ? ` - via ${p.via}` : ''}
              {p.dbref === current ? ' - here' : ''}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Move / Set home / Set destination: search for a place, look around (nothing moves while you browse), see
 * a confirmation sentence, then apply. Everything is read and changed through the silent Edit* calls.
 */
export function PlaceDialog() {
  const p = useDetails((s) => s.place);
  if (!p) return null;
  return <PlaceDialogBody key={`${p.sid}|${p.dbref}|${p.mode}`} sid={p.sid} dbref={p.dbref} mode={p.mode} />;
}

function PlaceDialogBody({ sid, dbref, mode }: { sid: string; dbref: string; mode: PlaceMode }) {
  const engine = useUi((s) => s.engine);
  const obj = useEditor((s) => s.ws[sid]?.objects.find((o) => o.dbref === dbref));
  const data = useDetails((s) => s.entries[`${sid}|${dbref}`]?.data);
  const failure = useDetails((s) => s.entries[`${sid}|${dbref}`]?.failed[KEYS[mode]]);
  const busy = useDetails((s) => !!s.entries[`${sid}|${dbref}`]?.busy[KEYS[mode]]);
  const name = data?.name || obj?.name || dbref;
  const isExit = data?.type === 'exit';
  const current =
    mode === 'move'
      ? (data?.location ?? '')
      : mode === 'home'
        ? (data?.home ?? '')
        : (data?.destination ?? '');

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<EditPlace[] | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [near, setNear] = useState<EditNearbyResult | null>(null);
  const [nearErr, setNearErr] = useState('');
  const [target, setTarget] = useState<EditPlace | null>(null);
  const [look, setLook] = useState<EditNearbyResult | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookErr, setLookErr] = useState('');
  const [recent] = useState(() => recentPlaces(sid));
  const token = useRef(0);
  const lookToken = useRef(0);

  // the object's surroundings, for browsing
  useEffect(() => {
    if (!engine) return;
    let live = true;
    void engine.editNearby(sid, dbref).then((r) => {
      if (!live) return;
      if (r.ok) setNear(r);
      else setNearErr(describeFailure(r, 'the surroundings'));
    });
    return () => {
      live = false;
    };
  }, [engine, sid, dbref]);

  // debounced search
  useEffect(() => {
    const q = query.trim();
    if (!engine || !q) {
      token.current++;
      setResults(null);
      setSearching(false);
      setSearchErr('');
      return;
    }
    const mine = ++token.current;
    setSearching(true);
    const t = setTimeout(() => {
      void engine.editSearchRooms(sid, q).then((r) => {
        if (token.current !== mine) return;
        setSearching(false);
        if (r.ok) {
          setResults(r.items);
          setRestricted(r.restricted);
          setTruncated(r.truncated);
          setSearchErr('');
        } else {
          setResults([]);
          setSearchErr(
            r.code === 'invalid' ? 'That search text is not allowed.' : describeFailure(r, 'the search'),
          );
        }
      });
    }, SEARCH_DELAY);
    return () => clearTimeout(t);
  }, [engine, sid, query]);

  const lookAt = (place: EditPlace): void => {
    setTarget(place);
    setLook(null);
    setLookErr('');
    const mine = ++lookToken.current;
    if (!engine || (place.type && place.type !== 'room')) return;
    setLooking(true);
    void engine.editNearby(sid, place.dbref).then((r) => {
      if (lookToken.current !== mine) return;
      setLooking(false);
      if (r.ok) setLook(r);
      else setLookErr(describeFailure(r, place.dbref));
    });
  };

  const roomsOnly = mode !== 'move';
  const nearby = useMemo<Entry[]>(() => {
    if (!near) return [];
    const out: Entry[] = [];
    const seen = new Set<string>();
    const add = (e: Entry): void => {
      if (seen.has(e.dbref) || e.dbref === dbref) return;
      seen.add(e.dbref);
      out.push(e);
    };
    add({ ...near.room, type: 'room' });
    for (const x of near.exits)
      if (x.destDbref) add({ dbref: x.destDbref, name: x.destName, type: 'room', owner: '', via: x.name });
    if (!roomsOnly) for (const c of near.contents) add(c);
    return out;
  }, [near, dbref, roomsOnly]);

  const apply = async (): Promise<void> => {
    if (!target) return;
    const ok =
      mode === 'move'
        ? await moveTo(sid, dbref, target)
        : mode === 'home'
          ? await setHome(sid, dbref, target.dbref)
          : await setDestination(sid, dbref, target.dbref);
    if (ok) {
      if (mode !== 'move') rememberPlace(sid, target);
      closePlaceDialog();
    }
  };

  const sentence = target
    ? mode === 'move'
      ? isExit
        ? `Move exit ${placeText({ name, dbref })} so that it starts in ${placeText(target)}?`
        : `Move ${placeText({ name, dbref })} to ${placeText(target)}?`
      : mode === 'home'
        ? `Set the home of ${placeText({ name, dbref })} to ${placeText(target)}?`
        : `Make exit ${placeText({ name, dbref })} lead to ${placeText(target)}?`
    : mode === 'move'
      ? 'Search for a place, or pick one from the lists. Nothing moves until you confirm.'
      : 'Pick a room. Nothing changes until you confirm.';
  const same = !!target && target.dbref === current;
  const actionLabel = mode === 'move' ? 'Move' : 'Set';
  const dialogTitle = isExit && mode === 'move' ? 'Move exit' : TITLES[mode];

  return (
    <Dialog
      title={dialogTitle}
      wide
      onClose={closePlaceDialog}
      footer={
        <>
          <button type="button" onClick={closePlaceDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!target || same || busy}
            title={same ? 'It is already there' : undefined}
            onClick={() => void apply()}
          >
            {busy ? <Busy label="Working" /> : actionLabel}
          </button>
        </>
      }
    >
      <div className="ew-place-dlg" data-testid="place-dialog">
        <div className="ew-pd-left">
          <label className="ew-pd-search">
            <span className="ew-sr">Search places by name or number</span>
            <input
              type="search"
              placeholder={roomsOnly ? 'Search rooms by name or #number' : 'Search by name or #number'}
              value={query}
              spellCheck={false}
              data-autofocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const first = (results ?? [])[0];
                  if (first) lookAt(first);
                }
              }}
            />
          </label>
          <div className="ew-pd-lists">
            {query.trim() && (
              <div className="ew-pd-group" aria-busy={searching}>
                <h4>Search results {searching && <Busy label="Searching" />}</h4>
                {searchErr && <FieldError text={searchErr} />}
                {restricted && (
                  <p className="dim ew-note" role="status">
                    This game does not allow searching every room. Showing your own rooms and things nearby.
                  </p>
                )}
                {results && !searching && (
                  <PlaceList
                    label="Search results"
                    items={results.filter((r) => !roomsOnly || r.type === 'room' || r.type === '')}
                    selected={target?.dbref ?? null}
                    current={current}
                    onPick={lookAt}
                    empty="Nothing found."
                  />
                )}
                {truncated && <p className="dim ew-note">More places match; type more of the name.</p>}
              </div>
            )}
            <div className="ew-pd-group">
              <h4>Nearby</h4>
              {nearErr && <FieldError text={nearErr} />}
              {!near && !nearErr && <p className="dim ew-nochip">Looking around...</p>}
              <PlaceList
                label="Nearby places"
                items={nearby}
                selected={target?.dbref ?? null}
                current={current}
                onPick={lookAt}
              />
            </div>
            <div className="ew-pd-group">
              <h4>Recently used</h4>
              <PlaceList
                label="Recently used places"
                items={recent.filter((r) => r.dbref !== dbref)}
                selected={target?.dbref ?? null}
                current={current}
                onPick={lookAt}
                empty="Nothing yet."
              />
            </div>
          </div>
        </div>
        <div className="ew-pd-right" aria-label="Place preview" aria-live="polite">
          {!target && (
            <p className="dim ew-nochip">Click a place to look at it. Nothing moves while you look around.</p>
          )}
          {target && (
            <>
              <h4 className="ew-lookname">{placeText(target)}</h4>
              {looking && <Busy label="Looking" />}
              {lookErr && <FieldError text={lookErr} />}
              {look && (
                <>
                  <p className="dim">
                    {look.room.type || 'room'}
                    {look.room.owner ? ` - owner ${look.room.owner}` : ''}
                  </p>
                  {look.desc && <p className="ew-lookdesc">{look.desc}</p>}
                  <h5>Exits</h5>
                  {look.exits.length === 0 ? (
                    <p className="dim ew-nochip">No exits.</p>
                  ) : (
                    <ul className="ew-places" aria-label="Exits of this place" onKeyDown={rove}>
                      {look.exits.map((x) => (
                        <li key={x.dbref}>
                          {x.destDbref ? (
                            <button
                              type="button"
                              className="ew-place"
                              title={`Look at ${x.destName}`}
                              onClick={() =>
                                lookAt({ dbref: x.destDbref, name: x.destName, type: 'room', owner: '' })
                              }
                            >
                              <span className="ew-placename">{x.name}</span>
                              <span className="dim ew-placemeta">
                                to {placeText({ name: x.destName, dbref: x.destDbref })}
                              </span>
                            </button>
                          ) : (
                            <span className="ew-place ew-place-static">
                              {x.name} <span className="dim">(unlinked)</span>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <h5>Contents</h5>
                  <p className="dim ew-nochip">
                    {look.contents.length === 0
                      ? 'Empty.'
                      : look.contents
                          .slice(0, 12)
                          .map((c) => c.name)
                          .join(', ') +
                        (look.contents.length > 12 ? `, and ${look.contents.length - 12} more` : '')}
                  </p>
                </>
              )}
            </>
          )}
        </div>
        <div className="ew-pd-confirm" role="status" data-testid="place-confirm">
          <strong>{sentence}</strong>
          {same && <span className="dim"> It is already there.</span>}
          {failure && <FieldError text={failure.text} reply={failure.reply} />}
        </div>
      </div>
    </Dialog>
  );
}
