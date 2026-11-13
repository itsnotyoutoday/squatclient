import { describe, expect, it } from 'vitest';

/**
 * Regression: the output pane styles its lines with a global `.row { position: absolute }` rule.
 * The help topic tree once reused the class name `row`, which pulled every topic out of the layout
 * and left the help sidebar looking empty. Generic class names used by the output pane must not be
 * reused as class names anywhere else.
 */
const RESERVED = ['row'];

const sources = import.meta.glob('../src/components/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('CSS class name collisions', () => {
  it('scans the component sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  it('only the output pane uses the reserved global class names', () => {
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(sources)) {
      if (file.includes('/components/output/')) continue;
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
        const classes = (m[1] ?? m[2] ?? m[3] ?? '').split(/[\s$]+/);
        for (const r of RESERVED) if (classes.includes(r)) offenders.push(`${file}: className uses "${r}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('would catch the original bug', () => {
    const bad = 'className={`row${on ? " current" : ""}`}';
    const hit = [...bad.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)].some((m) =>
      (m[1] ?? m[2] ?? m[3] ?? '').split(/[\s$]+/).includes('row'),
    );
    expect(hit).toBe(true);
  });
});
