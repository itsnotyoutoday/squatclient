/* global document, window */
// Regression check on the dev page: for several pane shapes the input element and the text output must lie fully inside
// the viewport (or the graphics must be hidden and the text fill the pane). node scripts/gfx-pane-check.mjs   (needs vite on :5199)
import puppeteer from 'puppeteer-core';
const shapes = ['1500x640', '1800x500', '1300x560', '1100x720', '620x760'];
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--ignore-gpu-blocklist', '--use-angle=metal'] });
let bad = 0;
for (const shape of shapes) {
  const [w, h] = shape.split('x').map(Number);
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h + 36 });
  await page.goto(`http://localhost:5199/gfx-demo.html?stream=/gfx/lcars-sens.json&pane=${shape}&size=100`);
  await new Promise((r) => setTimeout(r, 2200));
  const r = await page.evaluate(() => {
    const box = (id) => { const e = id === 'out' ? document.querySelector('body > div:not(#stage):not(#msg):not(#hud):not(#input), #stage > div:not(#input)') : document.getElementById(id); const b = e?.getBoundingClientRect(); return b ? { x: b.left, y: b.top, w: b.width, h: b.height } : null; };
    return { input: box('input'), out: box('out'), vw: window.innerWidth, vh: window.innerHeight };
  });
  const inside = (b) => b && b.w > 20 && b.h > 20 && b.x >= -1 && b.y >= -1 && b.x + b.w <= r.vw + 1 && b.y + b.h <= r.vh + 1;
  const ok = inside(r.input) && inside(r.out) && r.input.h >= 30;
  if (!ok) bad++;
  console.log(shape, ok ? 'OK ' : 'FAIL', 'input', JSON.stringify(r.input), 'text', JSON.stringify(r.out));
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
