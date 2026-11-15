/* global window document process */
// Draws the CMCP consoles in real headless Chrome from fixtures that the Go engine produced (public/cmcp/*.json: the bound trees of
// the built-in screens filled with the protocol's example data) and writes screenshots.
//   node scripts/cmcp-shots.mjs [baseUrl] [outDir]      baseUrl serves the app with the mock engine (npm run dev). Chrome: CHROME_PATH.
//   CMCP_SCREENS=damage,power  CMCP_THEMES=tng,klingon   narrow the matrix
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || '/tmp/cmcp-shots';
const screens = (process.env.CMCP_SCREENS || 'operations,power,damage,sensors,tactical,helm,command,communications,medical,security,cargo,away,engineering,transporter').split(',');
const themes = (process.env.CMCP_THEMES || 'tng').split(',');
fs.mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: process.env.GFX_SOFTWARE ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : ['--ignore-gpu-blocklist', '--use-angle=metal'] });
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 800 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base);
await new Promise((r) => setTimeout(r, 1500));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 300));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${ok ? '' : '  ' + extra}`); };
const themeTokens = await (await fetch(new URL('cmcp/themes.json', base))).json();
for (const screen of screens) {
  for (const theme of themes) {
    const fx = await (await fetch(new URL(`cmcp/${screen}.json`, base))).json();
    const sprite = await fetch(new URL('cmcp/marauder.sprite.json', base)).then((r) => (r.ok ? r.text() : ''));
    await page.evaluate((ui, tokens, th, spr, helm) => {
      const w = window.__squat;
      const eng = w.ui.getState().engine;
      const id = w.sessions.getState().order[0];
      if (spr) eng.cmcpSprites.set('marauder', spr);
      ui.session = id;
      ui.tree.session = id;
      if (helm) { // a pack without a joystick resolves it to helm-controls (core Bind): emulate that on the fixture
        const nav = ui.docs['Space.Nav'] ?? {};
        const walk = (n) => { if (n.widget === 'joystick') { n.widget = 'helm-controls'; n.props = { bearing: nav.bearing, warp: nav.warp, speed_mps: nav.speed_mps, selected: 11 }; n.events = ['heading', 'speed', 'warp', 'stop', 'engage', 'course', 'dock', 'undock']; } (n.children ?? []).forEach(walk); };
        walk(ui.tree.root);
      }
      ui.tree.theme = th;
      ui.tree.tokens = { ...ui.tree.tokens, ...tokens };
      ui.tree.packKey += '/' + th;
      w.sessions.getState().setFg(id);
      eng.pushCmcp(ui);
    }, fx, themeTokens[theme], theme, sprite, !!process.env.CMCP_HELM);
    await sleep(1200);
    const g = await page.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
      const out = document.querySelector('.lay-output');
      return { output: r(out), ported: !!out?.classList.contains('ported'), scenes: [...document.querySelectorAll('.gfx-scene')].map((e) => e.dataset.scene), input: r(document.querySelector('textarea, .input-bar, [data-input]')) };
    });
    check(g.ported && g.scenes.includes('cmcp'), `${screen}/${theme}: scene open with a text port`, JSON.stringify(g));
    if (process.env.CMCP_HELM) {
      const f = await page.$('input[aria-label="Heading, degrees"]');
      check(!!f, 'helm-controls: the typed heading input exists');
      if (f) {
        const box = await f.boundingBox();
        const out0 = await page.evaluate(() => { const r = document.querySelector('.lay-output')?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height] : null; });
        check(!!box && box.y + box.height < out0[1] + out0[3] - 100, 'the input sits above the text pane');
        await f.click({ clickCount: 3 });
        await page.keyboard.type('90');
        await page.keyboard.press('Enter');
        await sleep(200);
        const calls = await page.evaluate(() => window.__squat.ui.getState().engine.cmcpCalls.filter((c) => c.fn === 'cmcpEvent').map((c) => c.args));
        check(calls.some((a) => a[1] === 'heading' && a[2]?.az === 90), 'Enter sends heading 90 to the engine', JSON.stringify(calls));
        const typed = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
        check(typed === 'Heading, degrees', 'focus stays in the field while typing');
      }
    }
    const file = path.join(out, `${screen}-${theme}.png`);
    await page.screenshot({ path: file });
    console.log('  ' + file);
  }
}
check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
