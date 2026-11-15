import type { Button, NavItem, Shape, Skin } from './types';
import { sensorsArrangement } from './arrange';

/** The other six themes of lcars.lua / theme_*.lua as skins (see tng.ts). Geometry is read from the Lua frames; the text port is the big
 * shared one, so frame shapes were kept clear of [240, 392..410, 1340, ~405] (nothing of the decoration reaches into it). */
type B = Button;
const items = (labels: [string, NavItem['role']][]): NavItem[] => {
  const screens = [['sensors', 'helm'], ['power', 'engineering'], ['tactical'], ['damage'], ['operations']];
  return labels.map(([label, role], i) => ({ label, role, screens: screens[i] }));
};
const widgets = (o: Partial<Skin['widgets']> = {}): Skin['widgets'] => ({
  panelTitle: { role: 'x', size: 26 }, text: 'k', head: 'x',
  button: { h: 40, roles: ['p', 'p', 'x', 'x', 'x'], color: '#000000' },
  bar: { h: 20, track: '#0e151d', fill: 'p' },
  radar: { kind: 'dish', ring: 'p', color: 'x', bg: '#03110a', rings: 4 },
  viewscreen: { r: 18, width: 5, role: 'p' },
  ...o,
});
const btn = (x: number, y: number, w: number, h: number, o: Partial<B> = {}): B => ({ x, y, w, h, size: 26, color: '#000000', ...o });

// ---------------------------------------------------------------------------------------------------- romulan
export const romulan: Skin = {
  name: 'romulan', font: { family: 'Rajdhani', weight: '700', files: [{ file: 'Rajdhani-Medium.ttf', weight: '500' }, { file: 'Rajdhani-Bold.ttf', weight: '700' }] }, sharp: true, bloom: 0.7,
  pal: {
    normal: { p: '#4fe39a', s: '#9fd9b8', t: '#2f9f78', q: '#1f6a52', x: '#e8a63a', r: '#c47a2c', k: '#7fc7a5', bg: '#020805' },
    red: { p: '#ff7a3a', s: '#ffb48a', t: '#c4542a', q: '#7a2a18', x: '#ffcf5a', r: '#ff5a2a', k: '#ffa070', bg: '#0e0502' },
  },
  frame: [
    { t: 'path', id: 'w1', d: 'M 20 890 C 6 640, 6 360, 20 120 S 90 18, 240 14 S 900 8, 1150 12', stroke: 'p', sw: 3, opacity: 0.9, glow: 0.25 },
    { t: 'path', id: 'w2', d: 'M 30 880 C 16 640, 16 380, 28 150 S 80 44, 200 30', stroke: 't', sw: 2, opacity: 0.7, glow: 0.25 },
    { t: 'path', id: 'w3', d: 'M 1585 884 C 1300 890, 900 886, 40 888', stroke: 'p', sw: 2, opacity: 0.6, glow: 0.25 },
    { t: 'polygon', id: 'plate', points: [1180, 14, 1570, 14, 1550, 62, 1160, 62], fill: 'x', glow: 0.1 },
    { t: 'text', x: 1200, y: 40, text: '{ship}  //  {mode}', size: 28, fill: '#0a0a05' },
    { t: 'text', x: 260, y: 40, text: '{game}', size: 26, fill: 'k' },
    { t: 'text', x: 250, y: 862, text: 'CORE {core}   HULL {hull}   LOCK {lock}   ALERT {alert}', size: 24, fill: 'k' },
    { t: 'rect', id: 'rail', x: 760, y: 868, w: 800, h: 2, fill: 'x', opacity: 0.7 },
  ],
  nav: { items: items([['SENSORS', 'p'], ['POWER', 'x'], ['WEAPONS', 't'], ['DAMAGE', 'q'], ['OPS', 'r']]), button: btn(36, 220, 160, 52, { dy: 66, dx: 6, r: 3, size: 26, align: 'left', padX: 14, color: '#021008', skewX: -14 }), marker: { t: 'rect', id: 'marker', x: 20, y: 224, w: 6, h: 44, fill: 'x', glow: 0.6 } },
  log: { button: { ...btn(36, 586, 170, 50, { r: 3, size: 24, align: 'left', skewX: -14, color: '#021008' }), role: 'x' }, shrink: 'LOG  <  SMALL', expand: 'LOG  >  EXPAND' },
  off: { button: { ...btn(36, 650, 170, 44, { r: 3, size: 22, align: 'left', skewX: -14, color: '#021008' }), role: 'p' }, label: 'SCREEN OFF' },
  port: { rect: [240, 410, 1340, 410], expanded: [240, 100, 1340, 720], frame: { role: 'p', r: 4, width: 2, glow: 0.3 } },
  content: [240, 76, 1340, 324], side: { port: [240, 100, 960, 720], content: [1216, 76, 364, 748] },
  widgets: widgets({ radar: { kind: 'dish', ring: 'p', color: 'x', bg: '#03110a', rings: 4 }, viewscreen: { r: 0, width: 3, role: 'p' } }), arrange: { sensors: sensorsArrangement([240, 76, 1340, 324]) },
};

// ---------------------------------------------------------------------------------------------------- klingon
const zig = (x0: number, x1: number, y: number, depth: number, teeth: number, dir: number): number[] => {
  const pts: number[] = [], step = (x1 - x0) / teeth;
  for (let i = 0; i <= teeth; i++) pts.push(x0 + i * step, y + (i % 2 === 1 ? depth * dir : 0));
  return pts;
};
const kTop = zig(236, 1580, 84, 20, 36, 1), kBot = zig(236, 1580, 830, 20, 36, -1);
export const klingon: Skin = {
  name: 'klingon', font: { family: 'Teko', weight: '600', files: [{ file: 'Teko-VF.ttf', weight: '300 700' }], ctscale: 0.78 }, sharp: true, bloom: 0.5,
  pal: {
    normal: { p: '#c1121f', s: '#8a8d93', t: '#240709', q: '#3a0a0f', x: '#c9a84c', r: '#e63946', k: '#d4b86a', bg: '#050102' },
    red: { p: '#ff2a2a', s: '#b0b4ba', t: '#4a0a0c', q: '#5a0d10', x: '#ffd24a', r: '#ff5a5a', k: '#ffe08a', bg: '#120204' },
  },
  frame: [
    { t: 'polygon', id: 'topplate', points: [20, 14, ...kTop, 1580, 14], fill: 't', stroke: 'p', sw: 2 },
    { t: 'polygon', id: 'botplate', points: [...kBot, 1580, 886, 236, 886], fill: 't', stroke: 'p', sw: 2 },
    { t: 'polygon', id: 'blade1', points: [20, 14, 230, 14, 150, 104, 20, 300], fill: 'x' },
    { t: 'polygon', id: 'blade2', points: [20, 300, 150, 104, 190, 330, 20, 620], fill: 'p' },
    { t: 'polygon', id: 'blade3', points: [20, 620, 190, 330, 200, 700, 20, 886], fill: 's', opacity: 0.9 },
    { t: 'text', x: 262, y: 46, text: '{ship}   //   {mode}', size: 42, fill: 'x' },
    { t: 'text', x: 262, y: 862, text: 'HULL {hull}   CORE {core}   LOCK {lock}   {alert}', size: 32, fill: 'x' },
  ],
  nav: { items: items([['SCAN', 'x'], ['POWER', 'r'], ['WEAPONS', 'p'], ['DAMAGE', 's'], ['OPS', 'k']]), button: btn(30, 340, 160, 58, { dy: 72, r: 0, size: 34, align: 'left', padX: 16, color: '#080203', skewX: 10 }) },
  log: { button: { ...btn(30, 722, 160, 54, { r: 0, size: 28, align: 'left' }), role: 'x' }, shrink: 'LOG  <', expand: 'LOG  >' },
  off: { button: { ...btn(1380, 30, 190, 44, { r: 0, size: 28, align: 'center' }), role: 'x' }, label: 'SCREEN OFF' },
  port: { rect: [240, 392, 1340, 405], expanded: [240, 112, 1340, 686], frame: { role: 'x', r: 0, width: 3, glow: 0.1 } },
  content: [240, 112, 1340, 272], side: { port: [240, 112, 960, 688], content: [1216, 108, 364, 690] },
  widgets: widgets({ panelTitle: { role: 'x', size: 28 }, button: { h: 40, roles: ['x', 'x', 'r', 'r', 'k'], color: '#080203' }, bar: { h: 20, track: '#120305', fill: 'x' }, radar: { kind: 'hex', ring: 'p', color: 'x', bg: '#120305', rings: 4 }, viewscreen: { r: 0, width: 3, role: 'x' } }), arrange: { sensors: sensorsArrangement([240, 112, 1340, 272]) },
};

// ---------------------------------------------------------------------------------------------------- tos
const rivets: Shape[] = Array.from({ length: 22 }, (_, i): Shape => ({ t: 'circle', id: `rv${i}`, x: 30 + i * 70, y: 22, r: 4, fill: '#9aa0a6', stroke: '#3a3e43', sw: 1 }));
const lampRow = (x: number, y: number, cols: number, seed: number): Shape[] =>
  Array.from({ length: cols }, (_, c): Shape => ({ t: 'rect', id: `lamp${seed}${c}`, x: x + c * 30, y, w: 24, h: 24, r: 5, fill: (['p', 's', 'q', 't', 'r'] as const)[(c + seed) % 5], stroke: '#111111', sw: 2 }));
export const tos: Skin = {
  name: 'tos', font: { family: 'Orbitron', weight: '700', files: [{ file: 'Orbitron-VF.ttf', weight: '400 900' }], tscale: 0.78, ctscale: 0.85 }, bloom: 0.15,
  pal: {
    normal: { p: '#e8372c', s: '#f2c230', t: '#34393e', q: '#2f6fd6', x: '#f5f1e6', r: '#2aa75b', k: '#9fd0ff', bg: '#1e2125' },
    red: { p: '#ff2a1f', s: '#ff8a00', t: '#3a2a2a', q: '#b3202a', x: '#ffd9d0', r: '#ff5a2a', k: '#ffb0a0', bg: '#2a1a1a' },
  },
  frame: [
    { t: 'rect', id: 'bandtop', x: 14, y: 10, w: 1572, h: 92, r: 18, fill: 't', stroke: '#14161a', sw: 4 },
    { t: 'rect', id: 'bandbot', x: 236, y: 826, w: 1350, h: 64, r: 18, fill: 't', stroke: '#14161a', sw: 4 },
    { t: 'rect', id: 'bandleft', x: 14, y: 110, w: 214, h: 780, r: 18, fill: 't', stroke: '#14161a', sw: 4 },
    ...rivets, ...lampRow(250, 44, 14, 1), ...lampRow(250, 836, 8, 2),
    { t: 'text', x: 700, y: 30, text: 'BRIDGE  -  {mode}', size: 28, fill: 'x' },
    { t: 'text', x: 520, y: 858, text: 'HULL {hull}   CORE {core}   LOCK {lock}   {alert}', size: 22, fill: 'x' },
    ...[[70, 660], [168, 660], [70, 760], [168, 760]].flatMap(([x, y], i): Shape[] => [
      { t: 'circle', id: `d${i}f`, x, y, r: 50, fill: '#1a1d20', stroke: '#6c7178', sw: 4 },
      { t: 'arc', id: `d${i}a`, x, y, r0: 34, r1: 42, a0: 225, a1: 495, fill: '#2a2e32' },
      { t: 'arc', id: `d${i}g`, x, y, r0: 34, r1: 42, a0: 225, a1: 225 + 60 + i * 50, fill: i % 2 ? 's' : 'q' },
      { t: 'circle', id: `d${i}c`, x, y, r: 7, fill: '#f5f1e6' },
    ]),
  ],
  nav: { items: items([['SENSORS', 'p'], ['POWER', 's'], ['WEAPONS', 'q'], ['DAMAGE', 'r'], ['OPS', 't']]), button: btn(26, 130, 190, 58, { dy: 76, r: 14, size: 24, color: '#f5f1e6', stroke: '#14161a', sw: 4 }) },
  log: { button: { ...btn(26, 516, 190, 54, { r: 14, size: 22, color: '#111111' }), role: 'x' }, shrink: 'LOG: SMALL', expand: 'LOG: LARGE' },
  off: { button: { ...btn(1380, 30, 190, 44, { r: 14, size: 20, color: '#111111' }), role: 's' }, label: 'SCREEN OFF' },
  port: { rect: [240, 392, 1340, 405], expanded: [240, 112, 1340, 690], frame: { role: 'x', r: 10, width: 4, glow: 0 } },
  content: [240, 112, 1340, 272], side: { port: [240, 112, 960, 690], content: [1216, 108, 364, 700] },
  widgets: widgets({ panelTitle: { role: 'x', size: 24 }, button: { h: 40, roles: ['p', 's', 'q', 'r', 't'], color: '#f5f1e6' }, text: 'x', head: 's', bar: { h: 20, track: '#15181b', fill: 's' }, radar: { kind: 'dish', ring: 't', color: 's', bg: '#0a1a10', rings: 4 }, viewscreen: { r: 6, width: 4, role: 't' } }), arrange: { sensors: sensorsArrangement([240, 112, 1340, 272]) },
};

// ---------------------------------------------------------------------------------------------------- ferengi
export const ferengi: Skin = {
  name: 'ferengi', font: { family: 'Cinzel', weight: '600', files: [{ file: 'Cinzel-VF.ttf', weight: '400 900' }], tscale: 0.84, ctscale: 0.78 }, bloom: 0.35,
  pal: {
    normal: { p: '#d4a017', s: '#e8c872', t: '#8c5a2b', q: '#7a2236', x: '#f0d98c', r: '#b5651d', k: '#e6b655', bg: '#12060a' },
    red: { p: '#e0561c', s: '#f0a060', t: '#7a2a18', q: '#6a1010', x: '#ffd9a0', r: '#e0561c', k: '#ffb070', bg: '#1a0605' },
  },
  frame: [
    { t: 'rect', id: 'fr1', x: 10, y: 8, w: 1580, h: 884, r: 46, stroke: 'p', sw: 4, glow: 0.15 },
    { t: 'rect', id: 'fr2', x: 24, y: 22, w: 1552, h: 856, r: 34, stroke: 't', sw: 2 },
    { t: 'path', id: 'fil1', d: 'M 44 140 C 44 70, 80 44, 150 44 C 110 70, 100 100, 114 140', stroke: 'x', sw: 3 },
    { t: 'path', id: 'fil2', d: 'M 1556 140 C 1556 70, 1520 44, 1450 44 C 1490 70, 1500 100, 1486 140', stroke: 'x', sw: 3 },
    { t: 'path', id: 'orn1', d: 'M 330 38 C 600 20, 1000 20, 1270 38', stroke: 't', sw: 2 },
    { t: 'text', x: 800, y: 60, text: '{ship}  -  {mode}', size: 36, fill: 'x', align: 'center' },
    { t: 'text', x: 250, y: 862, text: 'HULL {hull}%   CORE {core}%   LOCK {lock}   {alert}', size: 22, fill: 'k' },
    ...Array.from({ length: 6 }, (_, i): Shape => ({ t: 'rect', id: `mt${i}`, x: 82, y: 560 + i * 34, w: 120, h: 6, r: 3, fill: '#2a0f16' })),
    ...Array.from({ length: 6 }, (_, i): Shape => ({ t: 'rect', id: `mf${i}`, x: 82, y: 560 + i * 34, w: 40 + ((i * 37) % 70), h: 6, r: 3, fill: 'p', glow: 0.2 })),
  ],
  nav: { items: items([['SENSORS', 'p'], ['ENGINEERING', 's'], ['TACTICAL', 'r'], ['DAMAGE CONTROL', 'x'], ['OPERATIONS', 'k']]), button: btn(40, 170, 180, 42, { dy: 48, r: 21, size: 17, align: 'center', color: '#1a0508' }) },
  log: { button: { ...btn(40, 420, 180, 44, { r: 22, size: 18, color: '#1a0508' }), role: 'x' }, shrink: 'LOG - SHRINK', expand: 'LOG - EXPAND' },
  off: { button: { ...btn(40, 776, 180, 44, { r: 22, size: 18, color: '#1a0508' }), role: 'p' }, label: 'SCREEN OFF' },
  port: { rect: [240, 410, 1340, 410], expanded: [240, 118, 1340, 702], frame: { role: 'p', r: 14, width: 3, glow: 0.1 } },
  content: [240, 118, 1340, 284], side: { port: [240, 118, 960, 702], content: [1216, 112, 350, 708] },
  widgets: widgets({ text: 'k', radar: { kind: 'dish', ring: 'p', color: 'x', bg: '#120608', rings: 4 }, viewscreen: { r: 36, width: 5, role: 'p' }, bar: { h: 18, track: '#2a0f16', fill: 'p' } }), arrange: { sensors: sensorsArrangement([240, 118, 1340, 284]) },
};

// ---------------------------------------------------------------------------------------------------- soft
export const soft: Skin = {
  name: 'soft', font: { family: 'Rajdhani', weight: '700', files: [{ file: 'Rajdhani-Medium.ttf', weight: '500' }, { file: 'Rajdhani-Bold.ttf', weight: '700' }] }, bloom: 0.08,
  pal: {
    normal: { p: '#d98a63', s: '#e6d6c4', t: '#8e99a3', q: '#5e8e96', x: '#e0b48e', r: '#c26b5a', k: '#9cc2c6', bg: '#090b0d' },
    red: { p: '#d9a441', s: '#e6d6c4', t: '#8e99a3', q: '#b58a3c', x: '#e0b48e', r: '#d9a441', k: '#d8c08a', bg: '#0e0b07' },
  },
  frame: [
    { t: 'rect', id: 'glass1', x: 20, y: 108, w: 205, h: 712, r: 14, fill: '#10141a', stroke: '#2a3138', sw: 2, z: -5 },
    { t: 'rect', id: 'glass2', x: 236, y: 100, w: 1346, h: 728, r: 14, fill: '#0b0e11', stroke: '#2a3138', sw: 2, z: -5 },
    { t: 'text', x: 36, y: 126, text: 'NAVIGATION', size: 30, fill: 'p' },
    { t: 'rect', id: 'hr1a', x: 36, y: 144, w: 190, h: 2, fill: 'p', opacity: 0.9 },
    { t: 'rect', id: 'hr1b', x: 36, y: 150, w: 150, h: 1.5, fill: 'p', opacity: 0.6 },
    { t: 'rect', id: 'topstrip', x: 236, y: 70, w: 1346, h: 3, fill: 'p', opacity: 0.8 },
    { t: 'rect', id: 'botstrip', x: 236, y: 840, w: 1346, h: 3, fill: 'k', opacity: 0.7 },
    { t: 'text', x: 236, y: 50, text: '{ship}', size: 28, fill: 's' },
    { t: 'text', x: 1580, y: 50, text: '{mode}', size: 26, fill: 't', align: 'right' },
    { t: 'text', x: 236, y: 866, text: 'CONDITION: {alert}   HULL {hull}%   CORE {core}%   LOCK {lock}', size: 24, fill: 'k' },
  ],
  nav: { items: items([['SENSORS', 'p'], ['POWER', 'k'], ['TACTICAL', 'x'], ['DAMAGE', 't'], ['OPS', 'p']]), button: btn(30, 188, 180, 50, { dy: 62, r: 6, size: 26, align: 'left', padX: 14, color: '#10141a' }), marker: { t: 'rect', id: 'marker', x: 22, y: 190, w: 3, h: 46, fill: 'p' } },
  log: { button: { ...btn(30, 510, 180, 48, { r: 6, size: 24, align: 'left', color: '#10141a' }), role: 'p' }, shrink: 'LOG  -  SHRINK', expand: 'LOG  -  EXPAND' },
  off: { button: { ...btn(30, 570, 180, 48, { r: 6, size: 22, align: 'left', color: '#10141a' }), role: 'k' }, label: 'SCREEN OFF' },
  port: { rect: [250, 410, 1320, 405], expanded: [250, 112, 1320, 690], frame: { role: 'q', r: 8, width: 2, glow: 0 } },
  content: [250, 110, 1320, 292], side: { port: [250, 112, 960, 690], content: [1226, 108, 346, 700] },
  widgets: widgets({ panelTitle: { role: 'p', size: 26 }, text: 's', head: 'p', button: { h: 40, roles: ['p', 'p', 'x', 'x', 'x'], color: '#10141a' }, bar: { h: 12, track: '#10141a', fill: 'p' }, viewscreen: { r: 14, width: 2, role: 'q' }, radar: { kind: 'dish', ring: 'q', color: 'k', bg: '#0b0e11', rings: 4 } }), arrange: { sensors: sensorsArrangement([250, 110, 1320, 292]) },
};

// ---------------------------------------------------------------------------------------------------- ops (the bridge wall)
export const ops: Skin = {
  name: 'ops', font: { family: 'Rajdhani', weight: '700', files: [{ file: 'Rajdhani-Medium.ttf', weight: '500' }, { file: 'Rajdhani-Bold.ttf', weight: '700' }] }, sharp: false, bloom: 0.5,
  pal: {
    normal: { p: '#ff3b2f', s: '#efe6d2', t: '#4a2a14', q: '#2a3a44', x: '#e8923a', r: '#ff7a2a', k: '#7fd0dc', bg: '#040506' },
    red: { p: '#ff1a1a', s: '#ffb8a0', t: '#5a1010', q: '#3a1a1a', x: '#ff6a2a', r: '#ff3a1a', k: '#ff9a8a', bg: '#0a0304' },
  },
  frame: [
    { t: 'polyline', id: 'l1', points: [20, 100, 330, 84], stroke: 'p', sw: 3 },
    { t: 'polyline', id: 'l2', points: [1270, 84, 1580, 100], stroke: 'p', sw: 3 },
    { t: 'text', x: 236, y: 52, text: '{ship}  -  {mode}', size: 40, fill: 's' },
    { t: 'text', x: 1580, y: 52, text: '{title}', size: 30, fill: 'x', align: 'right' },
    { t: 'rect', id: 'wallL', x: 20, y: 130, w: 205, h: 690, r: 14, fill: '#0b0d10', stroke: '#27303a', sw: 2, z: -5 },
    { t: 'rect', id: 'wallM', x: 236, y: 112, w: 1346, h: 716, r: 14, fill: '#0b0d10', stroke: '#27303a', sw: 2, z: -5 },
    { t: 'rect', id: 'glowbot', x: 0, y: 836, w: 1600, h: 64, fill: 'x', opacity: 0.18 },
    { t: 'text', x: 236, y: 862, text: 'CONDITION {alert}   HULL {hull}%   CORE {core}%   LOCK {lock}', size: 26, fill: 'k' },
  ],
  nav: { items: items([['SENS', 'x'], ['POWER', 's'], ['TAC', 'p'], ['DAMAGE', 'k'], ['OPS', 'r']]), button: btn(32, 150, 180, 44, { dy: 54, r: 4, size: 26, align: 'center', color: '#0a0a0a' }) },
  log: { button: { ...btn(32, 440, 180, 44, { r: 4, size: 24, color: '#0a0a0a' }), role: 'x' }, shrink: 'LOG -', expand: 'LOG +' },
  off: { button: { ...btn(32, 496, 180, 44, { r: 4, size: 22, color: '#0a0a0a' }), role: 'p' }, label: 'SCREEN OFF' },
  port: { rect: [250, 410, 1320, 410], expanded: [250, 124, 1320, 692], frame: { role: 'x', r: 8, width: 2, glow: 0 } },
  content: [250, 122, 1320, 280], side: { port: [250, 124, 960, 692], content: [1226, 120, 346, 700] },
  widgets: widgets({ panelTitle: { role: 'x', size: 24 }, text: 'k', head: 'x', button: { h: 40, roles: ['p', 'x', 'r', 'k', 's'], color: '#0a0a0a' }, bar: { h: 14, track: '#0e1218', fill: 'k' }, viewscreen: { r: 8, width: 3, role: 'x' }, radar: { kind: 'dish', ring: 'x', color: 'k', bg: '#05080a', rings: 4 } }), arrange: { sensors: sensorsArrangement([250, 122, 1320, 280]) },
};
