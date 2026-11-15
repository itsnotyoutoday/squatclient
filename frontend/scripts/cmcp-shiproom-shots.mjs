/* global window */
// std.shiproom (an ordinary room aboard, no console) rendered by the real renderer in each theme, on a green and a red alert. The UI is the one the Go engine
// produced from a live game session (live-shiproom.json).  node scripts/cmcp-shiproom-shots.mjs <dumpDir> <outDir> [baseUrl]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2], out = process.argv[3] || '/tmp/shiproom-now', base = process.argv[4] || 'http://localhost:5173/';
fs.mkdirSync(out, { recursive: true });
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
const live = JSON.parse(fs.readFileSync(path.join(dir, 'live-shiproom.json'), 'utf8'));
let failed = 0;
const check = (ok, what, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${ok ? '' : '  ' + extra}`); };
for (const theme of ['tng', 'tos', 'klingon', 'romulan', 'ferengi']) {
  for (const alert of ['green', 'red']) {
    const ui = JSON.parse(JSON.stringify(live));
    ui.alert = alert; ui.status = { ...(ui.status ?? {}), alert };
    ui.tree.theme = theme;
    await page.evaluate((u) => {
      const w = window.__squat, eng = w.ui.getState().engine, id = w.sessions.getState().order[0];
      u.session = id; u.tree.session = id;
      window.__rev = (window.__rev || 1000) + 1; u.rev = window.__rev;
      w.sessions.getState().setFg(id);
      eng.pushCmcp(u);
    }, ui);
    await sleep(1500);
    // what the scene drew: the nav pills and the frame texts
    const drawn = await page.evaluate(() => {
      const rt = window.__squat; const eng = rt.ui.getState().engine;
      return { ops: JSON.stringify((eng.cmcpCalls ?? []).slice(-1)) };
    });
    void drawn;
    const f = path.join(out, `shiproom-${theme}-${alert}.png`);
    await page.screenshot({ path: f });
    console.log('  ' + f);
  }
}
check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
