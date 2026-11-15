import { describe, expect, it } from 'vitest';
import { SKINS } from '../src/cmcp/skins';
import { FIT_FLOOR, fitText, frameShapes, measureText, navShapes, textBoxes, textRoom } from '../src/cmcp/skinframe';
import type { Shape } from '../src/cmcp/skins/types';

/** Text must fit the shape it sits in, for every skin, with the longest values a game sends (the scene is 1600 x 900 scene units whatever the window). */
const LONG = [
  { ship: 'ACS PATHFINDER-CLASS DEEP SPACE EXPLORER', class: 'NEBULA-CLASS HEAVY CRUISER REFIT', game: 'THE LONGEST GAME NAME ON THE NETWORK', mode: 'COMMUNICATIONS', title: 'COMMUNICATIONS', hull: '100', core: '96', lock: 'KHV Tolghan Bortas', alert: 'YELLOW', screen: 'communications' },
  { ship: 'X', class: 'Y', game: 'Z', mode: 'COMMAND', title: 'COMMAND', hull: '5', core: '5', lock: '0', alert: 'OFF', screen: 'command' },
];

describe('fitText', () => {
  it('keeps a text that fits, shrinks one that does not down to the floor, then ends it with an ellipsis', () => {
    expect(fitText('OPS', 30, 400)).toEqual({ text: 'OPS', size: 30 });
    const mid = fitText('COMMUNICATIONS', 30, measureText('COMMUNICATIONS', 30) * 0.8);
    expect(mid.text).toBe('COMMUNICATIONS');
    expect(mid.size).toBeLessThan(30);
    expect(mid.size).toBeGreaterThanOrEqual(30 * FIT_FLOOR - 0.1);
    const tight = fitText('COMMUNICATIONS', 30, 60);
    expect(tight.text.endsWith('…')).toBe(true);
    expect(measureText(tight.text, tight.size)).toBeLessThanOrEqual(60 + 0.5);
    expect(tight.size).toBeGreaterThanOrEqual(30 * FIT_FLOOR - 0.1);
  });
});

describe.each(Object.entries(SKINS))('skin %s: text fits its shapes', (_n, skin) => {
  it.each(LONG.map((v, i) => [i, v] as const))('frame texts with long values #%i never overflow their shape or the scene', (_i, vars) => {
    const prims = frameShapes(skin.frame, skin.pal.normal, vars, 'fr.', skin.font.family);
    const boxes = textBoxes(skin.frame);
    skin.frame.forEach((s: Shape, i) => {
      if (s.t !== 'text') return;
      const p = prims[i].props as { text: string; size: number };
      if (!p.text) return;
      const room = textRoom(s, boxes[i]);
      expect(measureText(p.text, p.size, skin.font.family, s.weight ?? '700'), `${s.id ?? i} "${p.text}" at ${p.size}`).toBeLessThanOrEqual(Math.max(room, 0) + 0.5);
      expect(p.size).toBeGreaterThanOrEqual(s.size * FIT_FLOOR - 0.1);
    });
  });
  it('nav labels fit their buttons, even with a long label', () => {
    const long = { ...skin, nav: { ...skin.nav, items: skin.nav.items.map((it) => ({ ...it, label: 'COMMUNICATIONS' })) } };
    const b = skin.nav.button;
    for (const p of navShapes(long, skin.pal.normal, 0, 'nv.')) {
      if (p.type !== 'button') continue;
      const props = p.props as { text: string; size: number };
      expect(measureText(props.text, props.size, skin.font.family, skin.font.weight), props.text).toBeLessThanOrEqual(b.w - 2 * (b.padX ?? 16) - Math.abs(b.skewX ?? 0) + 0.5);
    }
  });
});
