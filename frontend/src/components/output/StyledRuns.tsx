import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { HlRun } from '../../lib/runs';
import { openExternal } from '../../api/wails';

function runStyle(r: HlRun): CSSProperties | undefined {
  const st: CSSProperties = {};
  if (r.fg) st.color = r.fg;
  if (r.bg) st.backgroundColor = r.bg;
  if (r.u && r.st) st.textDecorationLine = 'underline line-through';
  else if (r.u) st.textDecorationLine = 'underline';
  else if (r.st) st.textDecorationLine = 'line-through';
  return Object.keys(st).length ? st : undefined;
}

function runClass(r: HlRun): string | undefined {
  const c: string[] = [];
  if (r.b) c.push('b');
  if (r.dim) c.push('dim');
  if (r.i) c.push('it');
  if (r.blink) c.push('blink');
  if (r.hl) c.push(r.hl === 'current' ? 'hl-cur' : 'hl');
  return c.length ? c.join(' ') : undefined;
}

export const StyledRuns = memo(function StyledRuns({ runs }: { runs: readonly HlRun[] }) {
  if (runs.length === 0) return <br />;
  return (
    <>
      {runs.map((r, i) =>
        r.link ? (
          <a
            key={i}
            href={r.link}
            className={`link ${runClass(r) ?? ''}`.trim()}
            style={runStyle(r)}
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              if (r.link) openExternal(r.link);
            }}
          >
            {r.text}
          </a>
        ) : (
          <span key={i} className={runClass(r)} style={runStyle(r)}>
            {r.text}
          </span>
        ),
      )}
    </>
  );
});
