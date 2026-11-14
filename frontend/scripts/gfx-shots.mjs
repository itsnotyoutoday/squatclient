/* global document */
// Headless Chrome driver for the standalone graphics page: node scripts/gfx-shots.mjs <url> <out.png> [waitMs] [w h] [js]
// Needs a running Vite server (npm run dev) and Chrome (CHROME_PATH or the macOS default).
import puppeteer from 'puppeteer-core';
const [url, out, wait = '1500', w = '1600', h = '900', js = ''] = process.argv.slice(2);
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: process.env.GFX_SOFTWARE ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-webgl'] });
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
page.on('console', (m) => console.log('[console]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
if (js) await page.evaluate(js);
await new Promise((r) => setTimeout(r, +wait));
const hud = await page.evaluate(() => document.getElementById('hud')?.textContent + ' | ' + document.getElementById('msg')?.textContent);
console.log('[hud]', hud);
await page.screenshot({ path: out });
await browser.close();
