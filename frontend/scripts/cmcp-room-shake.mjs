/* global window document */
// A room (aboard, no console) in the ship's frame, on a yellow or red alert, with a hit shake: the UI is the one the Go engine produced from a
// live game session (live-room-<level>.json); the pulse samples are the ones the engine's real hit shake produced (live-pulses.json).
// Writes a screenshot per step: the room at rest with the ambience, then the frames of the shake.
//   node scripts/cmcp-room-shake.mjs <dumpDir> [outDir] [baseUrl]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const out = process.argv[3] || '/tmp/cmcp-room-shots';
const base = process.argv[4] || 'http://localhost:5173/';
fs.mkdirSync(out, { recursive: true });
const pulses = JSON.parse(fs.readFileSync(path.join(dir, 'live-pulses.json'), 'utf8'));
const shakes = pulses.filter((p) => p.shake && p.shake.active && (p.shake.x !== 0 || p.shake.y !== 0));
const ambient = pulses.find((p) => p.ambient);
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 800 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await new Promise((r) => setTimeout(r, 1500));
await page.keyboard.press('Escape');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${ok ? '' : '  ' + extra}`); };
for (const level of ['yellow', 'red']) {
  const ui = JSON.parse(fs.readFileSync(path.join(dir, `live-room-${level}.json`), 'utf8'));
  ui.alert = level;
  ui.status = { ...(ui.status ?? {}), alert: level };
  await page.evaluate((u) => {
    const w = window.__squat, eng = w.ui.getState().engine, id = w.sessions.getState().order[0];
    u.session = id; u.tree.session = id;
    window.__rev = (window.__rev || 1000) + 1; u.rev = window.__rev;
    w.sessions.getState().setFg(id);
    eng.pushCmcp(u);
  }, ui);
  await sleep(1200);
  const probe = () => page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    return { output: r(document.querySelector('.lay-output')), input: r(document.querySelector('textarea, .input-bar, [data-input]')) };
  });
  const rest = await probe();
  const shoot = async (name) => { const f = path.join(out, `room-${level}-${name}.png`); await page.screenshot({ path: f }); console.log('  ' + f); };
  if (ambient) await page.evaluate((p) => { const w = window.__squat; p.session = w.sessions.getState().order[0]; w.ui.getState().engine.pushCmcpPulse(p); }, { ...ambient, alert: level });
  await sleep(300);
  await shoot('0-rest');
  let n = 0;
  for (const s of shakes.slice(0, 4)) {
    await page.evaluate((p) => { const w = window.__squat; p.session = w.sessions.getState().order[0]; w.ui.getState().engine.pushCmcpPulse(p); }, { ...s, ambient: ambient?.ambient });
    await sleep(120);
    await shoot(`${++n}-shake-${s.shake.x}_${s.shake.y}`);
    const g = await probe();
    check(JSON.stringify(g.output) === JSON.stringify(rest.output) && JSON.stringify(g.input) === JSON.stringify(rest.input), `${level}: the text pane and the input line did not move during the shake`, JSON.stringify([rest, g]));
  }
}
check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
