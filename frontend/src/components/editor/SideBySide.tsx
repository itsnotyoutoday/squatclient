import { useMemo } from 'react';
import { countChanges, sideBySide } from '../../lib/editor/diff';

/** Side-by-side line diff (left = `a`, right = `b`). */
export function SideBySide({
  a,
  b,
  leftLabel,
  rightLabel,
}: {
  a: string;
  b: string;
  leftLabel: string;
  rightLabel: string;
}) {
  const rows = useMemo(() => sideBySide(a, b), [a, b]);
  const changes = countChanges(rows);
  return (
    <div className="ew-diffwrap">
      <p className="ew-diffsum" role="status">
        {changes === 0 ? 'No differences.' : `${changes} changed ${changes === 1 ? 'line' : 'lines'}.`}
      </p>
      <div className="ew-diff" role="table" aria-label={`${leftLabel} compared with ${rightLabel}`}>
        <div className="ew-diffrow ew-diffhead" role="row">
          <span role="columnheader" className="ew-diffn" />
          <span role="columnheader" className="ew-difftext">
            {leftLabel}
          </span>
          <span role="columnheader" className="ew-diffn" />
          <span role="columnheader" className="ew-difftext">
            {rightLabel}
          </span>
        </div>
        {rows.map((r, i) => (
          <div key={i} className={`ew-diffrow ew-diff-${r.kind}`} role="row">
            <span role="cell" className="ew-diffn">
              {r.left?.n ?? ''}
            </span>
            <span role="cell" className="ew-difftext">
              {r.left?.text ?? ''}
            </span>
            <span role="cell" className="ew-diffn">
              {r.right?.n ?? ''}
            </span>
            <span role="cell" className="ew-difftext">
              {r.right?.text ?? ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
