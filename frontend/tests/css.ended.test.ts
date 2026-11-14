import { describe, expect, it } from 'vitest';

// the stylesheet is read from disk: vitest turns CSS imports into empty modules
const { readFileSync } = await import('node:fs');
const here = import.meta.url.replace(/^file:\/\//, '').replace(/\/[^/]*$/, '');
const css = readFileSync(`${here}/../src/styles/app.css`, 'utf8');

describe('stylesheet', () => {
  it('is readable', () => {
    expect(css.length).toBeGreaterThan(10000);
  });
  // `.tab.ended` and `.badge.ended` are the tab's own state classes: a bare `.ended { padding... }` rule
  // (meant for the banner, which is `.endbar`) made an ended tab taller than the others
  it('has no rule that styles every element with the class "ended"', () => {
    expect(css).not.toMatch(/^\.ended\s*[,{]/m);
    expect(css).toMatch(/^\.endbar\s*\{/m);
  });
});
