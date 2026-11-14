import type { GfxOp } from '../types';

/** A scene that touches every primitive; used for the renderer smoke test and quick visual checks. */
export const SMOKE: GfxOp[] = [
  { op: 'scene', scene: 'main', open: true, w: 1280, h: 720, bg: '#05070d', bloom: { strength: 0.9, radius: 1.2 } },
  { op: 'create', scene: 'main', id: 'stars', type: 'starfield', props: { x: 0, y: 0, w: 1280, h: 720, count: 500, speed: 0.03, seed: 3 } },
  { op: 'create', scene: 'main', id: 'planet', type: 'planet', props: { x: 1000, y: 250, r: 130, light: 140, seed: 4 } },
  { op: 'create', scene: 'main', id: 'r1', type: 'rect', props: { x: 40, y: 40, w: 260, h: 70, r: [35, 8, 8, 35], fill: { type: 'linear', angle: 90, stops: [[0, '#ff9900'], [1, '#cc6600']] }, glow: 0.6, shadow: { dy: 6, blur: 10, alpha: 0.6 } } },
  { op: 'create', scene: 'main', id: 'pill', type: 'rect', props: { x: 40, y: 140, w: 260, h: 44, pill: true, fill: '#cc99cc', stroke: '#ffffff', strokeWidth: 2 } },
  { op: 'create', scene: 'main', id: 'c1', type: 'circle', props: { x: 120, y: 280, r: 50, fill: { type: 'radial', cx: 0.4, cy: 0.35, r: 0.7, stops: [[0, '#ffffff'], [0.4, '#66aaff'], [1, '#102040']] }, glow: 0.5 } },
  { op: 'create', scene: 'main', id: 'e1', type: 'ellipse', props: { x: 270, y: 280, rx: 60, ry: 30, stroke: '#99ccff', strokeWidth: 3, fill: '#00000000' } },
  { op: 'create', scene: 'main', id: 'a1', type: 'arc', props: { x: 120, y: 420, r0: 30, r1: 55, a0: 20, a1: 250, fill: '#ffcc66', glow: 0.8 } },
  { op: 'create', scene: 'main', id: 'el', type: 'elbow', props: { x: 40, y: 500, w: 220, h: 170, ro: 80, ri: 30, bar: 40, side: 70, corner: 'tl', fill: '#ff9900' } },
  { op: 'create', scene: 'main', id: 'l1', type: 'line', props: { x1: 330, y1: 150, x2: 620, y2: 220, strokeWidth: 6, stroke: '#99ccff', glow: 0.5 } },
  { op: 'create', scene: 'main', id: 'pl', type: 'polygon', props: { points: [340, 300, 480, 270, 560, 360, 450, 420, 360, 380], fill: '#cc6666', stroke: '#ffffff', strokeWidth: 2 } },
  { op: 'create', scene: 'main', id: 'pa', type: 'path', props: { d: 'M 340 480 C 400 420 480 560 560 480 S 640 500 640 560', stroke: '#99ff99', strokeWidth: 4, fill: 'none' } },
  { op: 'create', scene: 'main', id: 't1', type: 'text', props: { x: 330, y: 80, text: 'LCARS 47634.4 SENSORS', size: 44, weight: '700', fill: '#ffcc99', glow: 0.3 } },
  { op: 'create', scene: 'main', id: 'em', type: 'emitter', props: { x: 700, y: 600, rate: 160, lifeMin: 0.6, lifeMax: 1.4, speedMin: 60, speedMax: 160, angle: 0, spread: 30, sizeStart: 14, sizeEnd: 2, colorStart: '#ffcc66', colorEnd: '#ff220000', glow: 0.8 } },
  { op: 'create', scene: 'main', id: 'rd', type: 'radar', props: { x: 760, y: 320, r: 130, sweep: 40, trail: 110, rings: 4, contacts: '1:22:35:F;2:335:62:H;3:100:55:N;4:200:85:U' } },
  { op: 'tween', scene: 'main', target: 'rd', tracks: { sweep: { from: 0, to: 360 } }, dur: 4, ease: 'linear', loop: -1 },
  { op: 'create', scene: 'main', id: 'btn', type: 'button', props: { x: 330, y: 560, w: 220, h: 52, pill: true, fill: '#9999ff', text: 'TACTICAL', color: '#000000', size: 26, weight: '700' } },
  { op: 'state', scene: 'main', id: 'btn', name: 'hover', props: { fill: '#ccccff', scaleX: 1.05, scaleY: 1.05 }, dur: 0.12 },
  { op: 'on', scene: 'main', id: 'btn', events: ['click'] },
  { op: 'create', scene: 'main', id: 'lay', type: 'layer', props: { blur: 4, opacity: 0.6 } },
  { op: 'create', scene: 'main', parent: 'lay', id: 'lc', type: 'circle', props: { x: 1100, y: 600, r: 60, fill: '#ff4466' } },
];
