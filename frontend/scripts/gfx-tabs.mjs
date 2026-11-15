/* global window document Image */
// Session isolation check for the graphics, in real headless Chrome (jsdom cannot tell: it has no GL and no layout).
//   node scripts/gfx-tabs.mjs [baseUrl]      baseUrl serves the app with the mock engine AND the debug hook
//                                            (npm run dev, or: vite build --mode hook && vite preview). Chrome: CHROME_PATH.
// Streams: GFX_A / GFX_B (default /gfx/lcars-sens.json and /gfx/lcars-eng.json) are recorded scene streams played as the
// session's scene. Every sequence asserts the page, not just the state: the pane geometry, the canvases, the pixels of the
// output area (a session without a scene must be pixel-identical to the app with no graphics at all) and that the text and
// input of the session in front work after the switch.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const base = process.argv[2] || 'http://localhost:5173/';
const SA = process.env.GFX_A || '/gfx/lcars-sens.json';
const SB = process.env.GFX_B || '/gfx/lcars-eng.json';
const OUT = process.env.GFX_OUT || '';
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: process.env.GFX_SOFTWARE ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : ['--ignore-gpu-blocklist', '--use-angle=metal'] });
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 800 });
const pageErrors = [];
const messages = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (/graphics were closed|webgl|context/i.test(m.text())) messages.push(m.text()); });
await page.goto(base);
await new Promise((r) => setTimeout(r, 1500));
await page.keyboard.press('Escape'); // the mock's "while you were away" dialog
await new Promise((r) => setTimeout(r, 300));

let failed = 0;
const check = (ok, what, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${ok ? '' : '  ' + extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = await page.evaluate(() => window.__squat.sessions.getState().order);
const [A, B, C] = ids;
const fg = async (id) => { await page.evaluate((i) => window.__squat.sessions.getState().setFg(i), id); await sleep(450); };
const play = async (id, stream, extra = []) => {
  await page.evaluate(async (i, s, more) => {
    const d = await (await fetch(s)).json();
    window.__squat.ui.getState().engine.emit('gfx', [...d.ops, ...more].map((o) => ({ ...o, session: i })));
  }, id, stream, extra);
  await sleep(900);
};
const emit = (ops) => page.evaluate((o) => window.__squat.ui.getState().engine.emit('gfx', o), ops);
const removeSession = (id) => page.evaluate((i) => { window.__squat.ui.getState().engine.emit('session-removed', { id: i }); window.__squat.sessions.getState().remove(i); }, id);
const geo = () => page.evaluate(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  const out = document.querySelector('.lay-output');
  const mush = document.querySelector('.lay-mush');
  return {
    mush: r(mush), output: r(out), ported: !!out?.classList.contains('ported'), style: out?.getAttribute('style') || '',
    scenes: [...document.querySelectorAll('.gfx-scene')].map((e) => ({ scene: e.dataset.scene, box: r(e), clip: e.style.clipPath.length > 0 })),
    canvases: document.querySelectorAll('.gfx-scene canvas').length,
  };
});
// pixels of the output area: a PNG of .lay-mush, and its share of non-dark pixels
const shotMush = async () => {
  const g = await geo();
  const [x, y, w, h] = g.mush;
  return page.screenshot({ clip: { x, y, width: w, height: h }, encoding: 'base64' });
};
// colours in the 3px strips along the left and right edge of the output area: plain background in a session without graphics,
// the scene's own (black) frame if another session's surface leaked into it. (The text itself scrolls differently on every
// visit in the mock, so whole-pane pixel equality cannot be asked of it.)
const edges = (b64) => page.evaluate(async (d) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + d;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const set = new Set();
  for (const x0 of [0, img.width - 3]) {
    const px = x.getImageData(x0, 0, 3, img.height).data;
    for (let i = 0; i < px.length; i += 4) set.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
  }
  return [...set].sort().join(' ');
}, b64);
const lit = (b64) => page.evaluate(async (d) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + d;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const px = x.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 60) n++;
  return n / (px.length / 4);
}, b64);
// the real text pane answers pointer events at its centre, and the input takes keys, after every switch
const textAndInputWork = async () => page.evaluate(async () => {
  const out = document.querySelector('.lay-output');
  const b = out.getBoundingClientRect();
  const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
  const inputEl = document.querySelector('textarea, input.input, input[type=text]');
  return { overText: !!hit && out.contains(hit), input: !!inputEl };
});
let n = 0;
const snap = async (name) => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png` }); } };

// the app without graphics: what a session with no scene must look like, exactly
await fg(B); await fg(A); await fg(B); // (the output pane's scroll position settles after a first visit)
const baselineB = await shotMush();
const gB0 = await geo();
check(gB0.scenes.length === 0 && !gB0.ported && gB0.canvases === 0, 'baseline: B has no scene, no inset, no canvas', JSON.stringify(gB0));

const bPlain = async (when) => {
  await fg(B);
  const g = await geo();
  check(g.scenes.length === 0 && g.canvases === 0 && !g.ported && g.style === '', `${when}: B (no scene) has no scene, canvas, inset or style`, JSON.stringify(g));
  check(JSON.stringify(g.output) === JSON.stringify(gB0.output), `${when}: B text pane rect equals the no-graphics layout`, JSON.stringify([g.output, gB0.output]));
  const now = await shotMush();
  const e0 = await edges(baselineB), e1 = await edges(now);
  check(e0 === e1, `${when}: B's edge pixels equal the app without graphics (no leaked frame)`, `${e0} != ${e1}`);
  if (e0 !== e1 && OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(`${OUT}/diff-base.png`, Buffer.from(baselineB, 'base64')); fs.writeFileSync(`${OUT}/diff-now.png`, Buffer.from(now, 'base64')); }
  const w = await textAndInputWork();
  check(w.overText && w.input, `${when}: B text answers pointers and the input exists`, JSON.stringify(w));
  await snap('B-plain-' + when.replace(/\W+/g, '-'));
};
const sceneShown = async (id, when) => {
  await fg(id);
  const g = await geo();
  check(g.scenes.length === 1 && g.canvases === 1 && g.ported, `${when}: the scene is drawn once with its own canvas`, JSON.stringify(g));
  const l = await lit(await shotMush());
  check(l > 0.08, `${when}: the surface is not blank (${(l * 100).toFixed(0)}% lit)`);
  const w = await textAndInputWork();
  check(w.overText && w.input, `${when}: the text port answers pointers and the input exists`, JSON.stringify(w));
  await snap('scene-' + when.replace(/\W+/g, '-'));
  return g;
};

// 1: A opens a scene while in front; B, A, B
await fg(A);
await play(A, SA);
await sceneShown(A, 'seq1 A in front');
await bPlain('seq1 after A');
await sceneShown(A, 'seq1 back to A');
await bPlain('seq1 B again');

// 2: A's scene changes while B is in front (the ops reach a background session); then B, then A
await fg(B);
await play(A, SB); // another scene for A, applied in the background
await bPlain('seq2 A changed in background');
const gA2 = await sceneShown(A, 'seq2 A after the change');
check(gA2.scenes[0].scene === 'lcars', 'seq2 A shows its scene id');

// 3: both sessions with scenes, switching 20 times
await fg(B);
await play(B, SB);
const gSeen = {};
for (let i = 0; i < 20; i++) {
  const id = i % 2 ? B : A;
  await fg(id);
  const g = await geo();
  const w = await textAndInputWork();
  const key = id === A ? 'A' : 'B';
  gSeen[key] = gSeen[key] ?? JSON.stringify(g.output);
  const same = JSON.stringify(g.output) === gSeen[key];
  if (!(g.scenes.length === 1 && g.canvases === 1 && g.ported && same && w.overText && w.input)) check(false, `seq3 switch ${i} to ${key}`, JSON.stringify({ g, w }));
}
check(true, 'seq3: 20 switches between two sessions with scenes kept one canvas each, the same port inset per session and working text/input');
await sceneShown(A, 'seq3 final A');
await sceneShown(B, 'seq3 final B');

// 4: close a session while in front and while in back
await fg(B);
await removeSession(B);
await sleep(400);
const afterClose = await page.evaluate(() => window.__squat.sessions.getState().fg);
const gc = await geo();
check(afterClose !== B, 'seq4: closing the session in front moves to another one');
check(gc.scenes.length === (afterClose === A ? 1 : 0), 'seq4: the surface shown belongs to the session now in front', JSON.stringify(gc));
await fg(A);
await removeSession(C);
await sleep(300);
const gd = await geo();
check(gd.scenes.length === 1 && gd.canvases === 1, 'seq4: closing a background session leaves the front scene alone', JSON.stringify(gd));

// 5: resize the window while A's surface is in the background, then come back
const rest = (await page.evaluate(() => window.__squat.sessions.getState().order)).find((i) => i !== A);
await fg(rest);
await page.setViewport({ width: 980, height: 700 });
await sleep(400);
await fg(A);
const g5 = await geo();
const l5 = await lit(await shotMush());
check(g5.scenes.length === 1 && g5.canvases === 1 && g5.scenes[0].box[2] === g5.mush[2] && l5 > 0.05, 'seq5: after a resize in the background the surface has the new size and is not blank', JSON.stringify([g5.scenes, g5.mush, l5]));
await page.setViewport({ width: 1300, height: 800 });
await sleep(300);

// 6: calm on and off for the foreground and a background session
await emit([{ op: 'scene', session: A, scene: 'lcars', calm: 0.8 }]);
await sleep(300);
await fg(rest);
await emit([{ op: 'scene', session: A, scene: 'lcars', calm: 0 }]);
await fg(A);
const g6 = await geo();
check(g6.scenes.length === 1 && (await lit(await shotMush())) > 0.05, 'seq6: calm toggled in the background does not blank or move the surface');

check(pageErrors.length === 0, 'no page errors', pageErrors.join(' | '));
check(!messages.some((m) => /graphics were closed/.test(m)), 'no scene was closed by a renderer failure', messages.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
