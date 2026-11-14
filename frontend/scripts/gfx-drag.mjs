/* global document */
// Drives the joystick on the standalone page: drags the knob, waits for it to settle, screenshots. node scripts/gfx-drag.mjs <out.png>
import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--ignore-gpu-blocklist', '--use-angle=metal'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5199/gfx-demo.html?stream=/gfx/lcars-sens.json');
await new Promise((r) => setTimeout(r, 2500));
// logical 1600x900 on a 1600x900 page: knob at (1490,744)
await page.mouse.move(1490, 744);
await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(1490 + i * 4, 744 - i * 5); await new Promise((r) => setTimeout(r, 30)); }
await new Promise((r) => setTimeout(r, 700)); // stop moving: "settle" fires
await page.screenshot({ path: out });
console.log('[input]', await page.evaluate(() => document.getElementById('input')?.textContent));
await page.mouse.up();
await browser.close();
