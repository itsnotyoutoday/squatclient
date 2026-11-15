/* global window document */
// Renders the bound UIs the Go engine dumped from a live Evennia session (TestCmcpLiveThemes with SQUAT_LIVE_CMCP_DUMP=<dir>) in real
// headless Chrome and writes screenshots. The screens, data, ship and theme are the game's own; nothing is faked except the window.
//   node scripts/cmcp-live-shots.mjs <dumpDir> [outDir] [baseUrl]     CMCP_VIEWPORT=1300x800  CMCP_LOG=1 (also the LOG-expanded view)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const out = process.argv[3] || '/tmp/cmcp-live-shots';
const base = process.argv[4] || 'http://localhost:5173/';
fs.mkdirSync(out, { recursive: true });
const files = fs.readdirSync(dir).filter((f) => /^live-.*\.json$/.test(f) && !f.includes('sprite'));
const sprite = fs.existsSync(path.join(dir, 'live.sprite.json')) ? fs.readFileSync(path.join(dir, 'live.sprite.json'), 'utf8') : '';
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage();
const [vw, vh] = (process.env.CMCP_VIEWPORT || '1300x800').split('x').map(Number);
await page.setViewport({ width: vw, height: vh });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await new Promise((r) => setTimeout(r, 1500));
await page.keyboard.press('Escape');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${ok ? '' : '  ' + extra}`); };
for (const f of files) {
  const ui = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!ui.tree) { console.log('skip (no screen)', f); continue; }
  await page.evaluate((u, spr) => {
    const w = window.__squat;
    const eng = w.ui.getState().engine;
    const id = w.sessions.getState().order[0];
    if (spr) eng.cmcpSprites.set('marauder', spr);
    u.session = id;
    u.tree.session = id;
    w.sessions.getState().setFg(id);
    eng.pushCmcp(u);
  }, ui, sprite);
  await sleep(1300);
  const g = await page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    const out = document.querySelector('.lay-output');
    return { output: r(out), ported: !!out?.classList.contains('ported'), scenes: [...document.querySelectorAll('.gfx-scene')].map((e) => e.dataset.scene), input: r(document.querySelector('textarea, .input-bar, [data-input]')) };
  });
  const tag = f.replace(/^live-|\.json$/g, '');
  check(g.ported && g.scenes.includes('cmcp'), `${tag}: ${ui.tree.screen} (${ui.tree.theme}, ${ui.tree.layout}) scene open with a text port`, JSON.stringify(g));
  check(!!g.output && g.output[2] * g.output[3] >= vw * vh * 0.1, `${tag}: the text pane has room`, JSON.stringify(g.output));
  const file = path.join(out, `${tag}-${vw}x${vh}.png`);
  await page.screenshot({ path: file });
  console.log('  ' + file);
  if (process.env.CMCP_LOG) {
    await page.keyboard.down('Alt'); await page.keyboard.press('KeyL'); await page.keyboard.up('Alt');
    await sleep(900);
    await page.screenshot({ path: path.join(out, `${tag}-${vw}x${vh}-log.png`) });
    await page.keyboard.down('Alt'); await page.keyboard.press('KeyL'); await page.keyboard.up('Alt');
    await sleep(900);
  }
}
check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
