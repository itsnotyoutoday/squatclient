/* global document, window */
// Shows the console in an output-area shaped pane (graphics on top, text below, input line under) and drags the knob
// at its real screen position, to check hit-testing after scaling. node scripts/gfx-pane.mjs WxH out.png [sizePercent]
import puppeteer from 'puppeteer-core';
const [shape, out, size = '60'] = process.argv.slice(2);
const [w, h] = shape.split('x').map(Number);
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--ignore-gpu-blocklist', '--use-angle=metal'] });
const page = await browser.newPage();
await page.setViewport({ width: w, height: h + 36 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5199/gfx-demo.html?stream=/gfx/lcars-sens.json&pane=${shape}&size=${size}`);
await new Promise((r) => setTimeout(r, 2500));
const pos = await page.evaluate(() => {
  const { rt } = window.gfx;
  const slot = rt.slot('lcars');
  const n = slot.scene.get('joyknob');
  const r = slot.canvas.getBoundingClientRect(), m = slot.renderer.mapping;
  const k = slot.canvas.width / r.width;
  const [lx, ly] = [n.world[4], n.world[5]];
  return { x: r.left + (lx * m.sx + m.ox) / k, y: r.top + (ly * m.sy + m.oy) / k, s: m.sx / k };
});
await page.mouse.move(pos.x, pos.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(pos.x + i * 3 * pos.s * 2, pos.y - i * 4 * pos.s * 2); await new Promise((r) => setTimeout(r, 30)); }
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: out });
console.log(shape, 'knob at', Math.round(pos.x), Math.round(pos.y), 'scale', pos.s.toFixed(2), '|', await page.evaluate(() => document.getElementById('input')?.textContent));
await page.mouse.up();
await browser.close();
