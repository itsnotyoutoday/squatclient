import { GfxRuntime } from '../runtime';
import { GfxRenderer } from '../renderer';
import type { GfxOp } from '../types';
import { SMOKE } from './smoke';

/**
 * Standalone page: runs a recorded or generated scene stream in any browser, no Wails needed.
 *   gfx-demo.html?stream=/gfx/lcars-sens.json   a stream recorded from the TF scripts (see docs/GFX.md)
 *   gfx-demo.html?smoke=1                       a scene touching every primitive
 * A stream is {"ops": [...], "vars": [{"t": seconds, "vars": {...}}], "commands": {"lcars eng": "/gfx/lcars-eng.json"}}.
 */
const q = new URLSearchParams(location.search);
const SCENE = q.get('smoke') ? 'main' : 'lcars';
const stage = document.getElementById('stage')!;
const msg = document.getElementById('msg')!;
const hud = document.getElementById('hud')!;

if (!GfxRenderer.supported()) {
  msg.textContent = 'This page needs WebGL2, which this browser does not provide. Try a current Chrome, Edge, Firefox or Safari.';
  throw new Error('WebGL2 missing');
}

const rt = new GfxRuntime();
rt.onMessage = (lvl, text) => { msg.textContent += `${lvl}: ${text}\n`; };
const canvas = document.createElement('canvas');
stage.appendChild(canvas);

interface Stream {
  ops: GfxOp[];
  vars?: { t: number; vars: Record<string, unknown> }[];
  loop?: number;
  delta?: boolean;
  commands?: Record<string, string>;
  handlers?: Record<string, string>;
}

let timers: number[] = [];
let commands: Record<string, string> = {};
let handlers: Record<string, string> = {};

/** Loads a recorded stream: the scene operations, then the variable updates its simulation produced, looping. */
async function play(url: string): Promise<void> {
  const s = (await (await fetch(url)).json()) as Stream;
  if (s.delta) { // the effect of one button, recorded as operations on top of the running scene
    rt.apply(s.ops ?? []);
    return;
  }
  timers.forEach(clearTimeout);
  timers = [];
  rt.apply([{ op: 'clear', scene: 'lcars' }, { op: 'clear', scene: 'main' }]);
  rt.apply(s.ops ?? []);
  commands = s.commands ?? {};
  handlers = s.handlers ?? {};
  const vars = s.vars ?? [];
  const loop = s.loop ?? 0;
  const run = (): void => {
    vars.forEach((v) => timers.push(window.setTimeout(() => rt.setVars(v.vars), v.t * 1000)));
    if (loop > 0) timers.push(window.setTimeout(run, loop * 1000));
  };
  run();
}

/** The page has no TinyFugue or Lua: a click plays the effect recorded for the object's command. */
rt.onEvent = (e) => {
  if (e.event === 'settle') { // the Lua script answers with /input: this page has no input line, so it shows what would be put there
    const heading = Math.round((Math.atan2(e.x, -e.y) * 180) / Math.PI + 360) % 360;
    const power = Math.round(Math.min(100, Math.hypot(e.x, e.y)));
    if (power >= 3) {
      const box = document.getElementById('input')!;
      box.textContent = `/echo JoyStick to ${heading} power ${power}`;
      box.style.opacity = '1';
    }
  }
  const cmd = handlers[`${e.id}:${e.event}`];
  if (cmd && commands[cmd]) void play(commands[cmd]);
};

const err = rt.mount(SCENE, canvas);
if (err) msg.textContent = err;
const ro = new ResizeObserver(() => rt.resize(SCENE, stage.clientWidth, stage.clientHeight, window.devicePixelRatio));
ro.observe(stage);
rt.resize(SCENE, stage.clientWidth, stage.clientHeight, window.devicePixelRatio);

const attach = (): void => {
  const slot = rt.slot(SCENE);
  const pt = (t: 'move' | 'down' | 'up' | 'leave' | 'wheel') => (e: PointerEvent | WheelEvent): void => {
    const n = rt.pointer(slot, t, e.clientX, e.clientY);
    if (t === 'down' && n?.props.drag) canvas.setPointerCapture((e as PointerEvent).pointerId);
    canvas.style.cursor = n ? 'pointer' : 'default';
  };
  canvas.addEventListener('pointermove', pt('move'));
  canvas.addEventListener('pointerdown', pt('down'));
  canvas.addEventListener('pointerup', pt('up'));
  canvas.addEventListener('pointerleave', pt('leave'));
};
attach();

(window as unknown as { gfx: unknown }).gfx = { rt, play };
const stream = q.get('stream');
if (q.get('smoke')) rt.apply(SMOKE);
else if (stream) play(stream).catch((e: unknown) => { msg.textContent = String(e); });
else msg.textContent = 'Open with ?smoke=1 or ?stream=/gfx/<name>.json';
const click = q.get('click'); // ?click=nav2 plays that button's recorded effect (screenshots)
if (click) setTimeout(() => rt.onEvent?.({ scene: SCENE, id: click, event: 'click', x: 0, y: 0 }), 1500);

setInterval(() => {
  const st = rt.stats(SCENE);
  hud.textContent = `${st.fps.toFixed(0)} fps  cpu ${st.cpuMs.toFixed(2)} ms  ${st.items} items`;
}, 500);
