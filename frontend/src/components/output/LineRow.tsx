import { memo, useMemo } from 'react';
import type { Line } from '../../api/types';
import { applyHighlights, spansToRuns } from '../../lib/runs';
import type { HighlightRange, RenderOptions, RenderTheme } from '../../lib/runs';
import { formatClock } from '../../lib/humanize';
import { StyledRuns } from './StyledRuns';

export interface LineRowProps {
  line: Line;
  theme: RenderTheme;
  opts: RenderOptions;
  timestamps: boolean;
  highlights?: readonly HighlightRange[];
}

export const LineRow = memo(function LineRow({ line, theme, opts, timestamps, highlights }: LineRowProps) {
  const runs = useMemo(() => spansToRuns(line.spans, theme, opts), [line.spans, theme, opts]);
  const shown = useMemo(() => (highlights ? applyHighlights(runs, highlights) : runs), [runs, highlights]);
  return (
    <>
      {timestamps && (
        <span className="ts" aria-hidden="true">
          {formatClock(line.ts)}
        </span>
      )}
      <span className="text">
        <StyledRuns runs={shown} />
      </span>
    </>
  );
});
