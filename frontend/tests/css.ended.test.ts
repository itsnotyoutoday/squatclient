import { describe, expect, it } from 'vitest';
import css from '../src/styles/app.css?raw';

describe('stylesheet', () => {
  // `.tab.ended` and `.badge.ended` are the tab's own state classes: a bare `.ended { padding... }` rule
  // (meant for the banner, which is `.endbar`) made an ended tab taller than the others
  it('has no rule that styles every element with the class "ended"', () => {
    expect(css).not.toMatch(/^\.ended\s*[,{]/m);
    expect(css).toMatch(/^\.endbar\s*\{/m);
  });
});
