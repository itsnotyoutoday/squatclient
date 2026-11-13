import { useState } from 'react';
import type { EditDetails, EditLock } from '../../api/types';
import { openTarget, isReadOnlyObject } from '../../state/editorStore';
import type { OpenObject } from '../../state/editorStore';
import {
  detailsKey,
  isOverviewCollapsed,
  jumpToSection,
  loadDetails,
  setOverviewCollapsed,
  useDetails,
} from '../../state/detailsStore';
import { fitChips, shortExpr, typeLabel } from '../../lib/editor/props';
import { useSessions } from '../../state/stores';

type Section = 'flags' | 'powers' | 'locks';
const BUDGET: Record<Section, number> = { flags: 44, powers: 30, locks: 70 };

export const lockChipText = (l: EditLock): string => `${l.type}: ${shortExpr(l.expr || '(empty)')}`;
const lockTip = (l: EditLock): string =>
  `${l.type} lock: ${l.expr || '(empty)'}${l.flags.length ? `\nFlags: ${l.flags.join(', ')}` : ''}`;

function Group({
  sid,
  dbref,
  section,
  label,
  items,
  text,
  tip,
  readOnly,
}: {
  sid: string;
  dbref: string;
  section: Section;
  label: string;
  items: string[];
  text: (i: number) => string;
  tip: (i: number) => string;
  readOnly: boolean;
}) {
  const [all, setAll] = useState(false);
  const idx = items.map((_, i) => i);
  const { shown, more } = all ? { shown: idx, more: 0 } : fitChips(idx, text, BUDGET[section]);
  return (
    <div
      className={all ? 'ew-ovgroup ew-ovopen' : 'ew-ovgroup'}
      role="group"
      aria-label={`${label}, ${items.length}`}
    >
      <button
        type="button"
        className="ew-ovlabel"
        title={`Show ${label.toLowerCase()} in Object details`}
        onClick={() => jumpToSection(sid, dbref, section)}
      >
        {label} <span className="ew-ovcount">{items.length}</span>
      </button>
      <button
        type="button"
        className="ew-ovplus"
        aria-label={`Add ${label.toLowerCase().replace(/s$/, '')}`}
        title={readOnly ? 'You do not control this object' : `Add ${label.toLowerCase().replace(/s$/, '')}`}
        disabled={readOnly}
        onClick={() => jumpToSection(sid, dbref, section, true)}
      >
        +
      </button>
      {items.length === 0 ? (
        <span className="dim ew-ovnone">none</span>
      ) : (
        <span className="ew-ovchips">
          {shown.map((i) => (
            <button
              key={i}
              type="button"
              className="ew-ovchip"
              title={tip(i)}
              onClick={() => jumpToSection(sid, dbref, section)}
            >
              {text(i)}
            </button>
          ))}
          {more > 0 && (
            <button
              type="button"
              className="ew-ovmore"
              onClick={() => setAll(true)}
              title={`Show ${more} more`}
            >
              +{more} more
            </button>
          )}
          {all && items.length > 3 && (
            <button type="button" className="ew-ovmore" onClick={() => setAll(false)}>
              fewer
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function LockGlyph() {
  return (
    <svg className="ew-lock" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M4 7V5a4 4 0 1 1 8 0v2h1v7H3V7h1zm2 0h4V5a2 2 0 1 0-4 0v2z" fill="currentColor" />
    </svg>
  );
}

/** Always-visible summary of the selected object: line 1 identity, line 2 flags, powers and locks. */
export function OverviewHeader({ sid, obj }: { sid: string; obj: OpenObject }) {
  const entry = useDetails((s) => s.entries[detailsKey(sid, obj.dbref)]);
  const collapsedStore = useDetails((s) => s.collapsed);
  const session = useSessions((s) => s.sessions[sid]);
  void collapsedStore;
  void session;
  const collapsed = isOverviewCollapsed(sid);
  const d: EditDetails | undefined = entry?.data;
  const readOnly = isReadOnlyObject(obj);
  const open = (dbref: string): void => void openTarget(sid, dbref);
  const nm = (r: string): string => (d?.names?.[r] ? `${d.names[r]} (${r})` : r);

  return (
    <section
      className="ew-overview"
      role="region"
      aria-label="Object overview"
      aria-busy={!!entry?.loading}
      data-testid="overview"
    >
      <div className="ew-ovline">
        {d ? (
          <>
            <strong className="ew-ovname" title={d.name}>
              {d.name}
            </strong>
            <span className="dim ew-ovdbref">({d.dbref})</span>
            <span className="ew-ovbadge">{typeLabel(d.type)}</span>
            {readOnly && (
              <span className="ew-ovbadge ew-ovro" title="You do not control this object">
                <LockGlyph /> read-only
              </span>
            )}
            {d.owner && (
              <span className="ew-ovref">
                <span className="dim">Owner</span>{' '}
                <button
                  type="button"
                  className="ew-linkbtn"
                  title={`Open ${nm(d.owner)}`}
                  onClick={() => open(d.owner)}
                >
                  {d.names?.[d.owner] ?? d.owner}
                </button>
              </span>
            )}
            {d.location && (
              <span className="ew-ovref">
                <span className="dim">{d.type === 'exit' ? 'From' : 'In'}</span>{' '}
                <button
                  type="button"
                  className="ew-linkbtn"
                  title={`Open ${nm(d.location)}`}
                  onClick={() => open(d.location)}
                >
                  {d.names?.[d.location] ?? d.location}
                </button>
              </span>
            )}
          </>
        ) : entry?.error ? (
          <span className="ew-ovwarn" role="alert">
            Could not read the object overview: {entry.error}
          </span>
        ) : (
          <span className="ew-skel ew-skel-wide" aria-label="Loading the object overview" role="img" />
        )}
        <span className="ew-grow" />
        {entry?.error && !d && (
          <button type="button" onClick={() => void loadDetails(sid, obj.dbref)}>
            Retry
          </button>
        )}
        <button
          type="button"
          className="ew-ovbtn"
          title="Read the object again"
          aria-label="Refresh the object overview"
          disabled={!!entry?.loading}
          onClick={() => void loadDetails(sid, obj.dbref)}
        >
          {entry?.loading && d ? <span className="ew-spin" aria-hidden="true" /> : '↻'}
        </button>
        <button
          type="button"
          className="ew-ovbtn"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand the object overview' : 'Collapse the object overview'}
          title={collapsed ? 'Show flags, powers and locks' : 'Hide flags, powers and locks'}
          onClick={() => setOverviewCollapsed(sid, !collapsed)}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      </div>
      {!collapsed && (
        <div className="ew-ovline ew-ovgroups">
          {d ? (
            <>
              <Group
                sid={sid}
                dbref={obj.dbref}
                section="flags"
                label="Flags"
                items={d.flags}
                text={(i) => d.flags[i]}
                tip={(i) => {
                  const f = d.flags[i];
                  return f.length === 1 ? `Flag letter ${f}` : f;
                }}
                readOnly={readOnly}
              />
              <Group
                sid={sid}
                dbref={obj.dbref}
                section="powers"
                label="Powers"
                items={d.powers}
                text={(i) => d.powers[i]}
                tip={(i) => d.powers[i]}
                readOnly={readOnly}
              />
              <Group
                sid={sid}
                dbref={obj.dbref}
                section="locks"
                label="Locks"
                items={d.locks.map((l) => l.type)}
                text={(i) => lockChipText(d.locks[i])}
                tip={(i) => lockTip(d.locks[i])}
                readOnly={readOnly}
              />
            </>
          ) : (
            !entry?.error && (
              <>
                <span className="ew-skel" role="presentation" />
                <span className="ew-skel" role="presentation" />
                <span className="ew-skel ew-skel-wide" role="presentation" />
              </>
            )
          )}
        </div>
      )}
    </section>
  );
}
