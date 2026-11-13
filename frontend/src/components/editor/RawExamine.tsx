import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Span } from '../../api/types';
import { useUi } from '../../state/stores';
import { useRenderOptions, useRenderTheme } from '../../state/hooks';
import { spansToRuns } from '../../lib/runs';
import { describeFailure } from '../../state/editorStore';
import { StyledRuns } from '../output/StyledRuns';
import { Busy, FieldError } from './PropWidgets';

const MODES: { id: '' | 'all' | 'brief'; label: string }[] = [
  { id: '', label: 'Normal' },
  { id: 'all', label: 'All (/all)' },
  { id: 'brief', label: 'Brief (/brief)' },
];

/** The game's own `examine` text with colour: the fallback for anything the structured view cannot parse. */
export function RawExamine({ sid, dbref }: { sid: string; dbref: string }) {
  const engine = useUi((s) => s.engine);
  const theme = useRenderTheme();
  const opts = useRenderOptions();
  const [mode, setMode] = useState<'' | 'all' | 'brief'>('');
  const [lines, setLines] = useState<Span[][] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    if (!engine) return;
    setLoading(true);
    setErr('');
    void engine.editExamine(sid, dbref, mode).then((r) => {
      setLoading(false);
      if (r.ok) setLines(r.lines);
      else setErr(describeFailure(r, dbref));
    });
  }, [engine, sid, dbref, mode]);
  useEffect(load, [load]);

  const plain = useMemo(() => (lines ?? []).map((l) => l.map((s) => s.s).join('')).join('\n'), [lines]);
  const rendered = useMemo(() => (lines ?? []).map((l) => spansToRuns(l, theme, opts)), [lines, theme, opts]);

  return (
    <div
      className="ew-raw"
      id="ew-dpanel"
      role="tabpanel"
      aria-labelledby="ew-dtab-raw"
      data-testid="raw-examine"
    >
      <div className="ew-rawbar">
        <span role="radiogroup" aria-label="Examine variant" className="ew-rawmodes">
          {MODES.map((m) => (
            <label key={m.id} className="ew-rawmode">
              <input
                type="radio"
                name="ew-examine-mode"
                checked={mode === m.id}
                onChange={() => setMode(m.id)}
              />{' '}
              {m.label}
            </label>
          ))}
        </span>
        <span className="ew-grow" />
        {loading && <Busy label="Examining" />}
        <button type="button" disabled={loading} onClick={load}>
          Refresh
        </button>
        <button
          type="button"
          disabled={!plain}
          onClick={() => {
            navigator.clipboard
              .writeText(plain)
              .then(() => useUi.getState().toast('info', 'Copied the examine text.'))
              .catch(() =>
                useUi.getState().toast('error', 'Could not copy: the clipboard is not available.'),
              );
          }}
        >
          Copy
        </button>
      </div>
      {err && <FieldError text={err} />}
      <pre className="ew-rawtext" tabIndex={0} aria-label={`Examine text of ${dbref}`}>
        {rendered.length === 0 && !loading ? <span className="dim">Nothing to show.</span> : null}
        {rendered.map((runs, i) => (
          <div key={i} className="ew-rawline">
            <StyledRuns runs={runs} />
          </div>
        ))}
      </pre>
    </div>
  );
}
