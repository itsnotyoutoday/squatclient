import type { Skin, Shape } from './types';
import { sensorsArrangement } from './arrange';

const strips = (y: number, roles: Skin['nav']['items'][number]['role'][]): Shape[] => {
  const xs: [number, number][] = [[354, 300], [660, 170], [836, 430], [1272, 112], [1390, 190]];
  return xs.map(([x, w], i) => ({ t: 'rect', id: `strip${y}${i}`, x, y, w, h: 48, fill: roles[i], r: i === 4 ? [0, 24, 24, 0] : 0, glow: 0.06 }));
};

/** The TNG / LCARS look (lcars.lua tng_frame, tng_nav). */
export const tng: Skin = {
  name: 'tng',
  font: { family: 'Antonio', weight: '700', files: [{ file: 'Antonio-VF.ttf' }] },
  bloom: 0.55,
  pal: {
    normal: { p: '#ff9900', s: '#ffcc99', t: '#cc99cc', q: '#9999ff', x: '#ffcc66', r: '#cc6666', k: '#99ccff', bg: '#000000' },
    red: { p: '#ff2a1f', s: '#ff8a7a', t: '#b3202a', q: '#8a1622', x: '#ff5a44', r: '#ff2a1f', k: '#ffb0a0', bg: '#140000' },
  },
  frame: [
    { t: 'elbow', id: 'el_top', x: 20, y: 20, w: 330, h: 176, ro: 92, ri: 28, bar: 48, side: 190, corner: 'tl', fill: 'p', glow: 0.08 },
    { t: 'elbow', id: 'el_bot', x: 20, y: 724, w: 330, h: 156, ro: 80, ri: 26, bar: 44, side: 190, corner: 'bl', fill: 't', glow: 0.08 },
    ...strips(20, ['p', 's', 't', 'q', 'x']),
    ...strips(832, ['t', 'p', 'q', 's', 'x']),
    { t: 'text', x: 368, y: 45, text: '{ship}', size: 34, fill: '#000000' },
    { t: 'text', x: 674, y: 45, text: '{class}', size: 34, fill: '#000000' },
    { t: 'text', x: 850, y: 45, text: '{game}', size: 34, fill: '#000000' },
    { t: 'text', x: 1284, y: 45, text: '{mode}', size: 28, fill: '#000000' },
    { t: 'text', x: 366, y: 857, text: '{mode} CONSOLE', size: 32, fill: '#000000' },
    { t: 'text', x: 850, y: 857, text: 'CORE {core}%   HULL {hull}%   LOCK {lock}', size: 30, fill: '#000000' },
    { t: 'text', x: 1404, y: 857, text: 'SQUATCLIENT', size: 32, fill: '#000000' },
    { t: 'rect', id: 'navfill', x: 20, y: 552, w: 190, h: 172, fill: 't' },
    { t: 'text', x: 34, y: 636, text: 'ALERT {alert}', size: 24, fill: '#000000' },
    { t: 'text', x: 34, y: 668, text: 'CORE {core}%', size: 24, fill: '#000000' },
    { t: 'text', x: 34, y: 700, text: 'HULL {hull}%', size: 24, fill: '#000000' },
  ],
  nav: {
    items: [
      { label: 'SENSORS', role: 'p', screens: ['sensors', 'helm'] }, { label: 'POWER', role: 'x', screens: ['power', 'engineering'] },
      { label: 'TACTICAL', role: 't', screens: ['tactical'] }, { label: 'DAMAGE', role: 'q', screens: ['damage'] }, { label: 'OPS', role: 'r', screens: ['operations'] },
    ],
    button: { x: 20, y: 206, w: 190, h: 60, dy: 68, r: [0, 30, 30, 0], size: 30, align: 'right', padX: 20, color: '#000000' },
    marker: { t: 'rect', id: 'marker', x: 216, y: 206, w: 12, h: 60, fill: '#ffffff', glow: 0.8 },
  },
  log: { button: { x: 20, y: 560, w: 190, h: 54, r: [0, 27, 27, 0], size: 26, align: 'right', padX: 18, color: '#000000', role: 'x' }, shrink: 'LOG - SHRINK', expand: 'LOG - EXPAND' },
  alert: { x: 660, y: 832, w: 170, h: 48, size: 30, align: 'center', color: '#000000', role: 'x', r: 0 },
  off: { button: { x: 1390, y: 20, w: 190, h: 48, r: [0, 24, 24, 0], size: 26, align: 'center', color: '#000000', role: 'x' }, label: 'SCREEN OFF' },
  // the game text is the largest element: 1340 x 410 of 1600 x 900 (45.6% of the height, 84% of the width); LOG expands it to 80% of the height
  port: { rect: [240, 410, 1340, 410], expanded: [240, 100, 1340, 720], frame: { role: 'p', r: 14, width: 4, glow: 0.2 } },
  content: [240, 84, 1340, 316],
  side: { port: [240, 100, 960, 720], content: [1216, 88, 364, 736] },
  widgets: {
    panelTitle: { role: 'x', size: 26 }, text: 'k', head: 'x',
    button: { h: 40, roles: ['p', 'p', 'x', 'x', 'x'], color: '#000000' },
    bar: { h: 20, track: '#0e151d', fill: 'p' },
    radar: { kind: 'dish', ring: 'p', color: 'x', bg: '#03110a', rings: 4 },
    viewscreen: { r: 18, width: 5, role: 'p' },
  },
  arrange: { sensors: sensorsArrangement([240, 84, 1340, 316]) },
};
