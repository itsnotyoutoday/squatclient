// (browser globals are not used here)
// conformance/sprite-parity.json in real Chrome: the Canvas2D sprite path (src/cmcp/sprite.ts) must draw every view of the reference
// ship at 2 x its viewBox and meet the cross-renderer bounds: coverage within +-0.03, bbox edges within +-6 px, tint_red_shift and
// glow_brighten at least the minimum. The sprite is the one the Go engine resolved (public/cmcp/marauder.sprite.json).
//   node scripts/cmcp-parity.mjs [baseUrl] [path to sprite-parity.json]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const base = process.argv[2] || 'http://localhost:5173/';
const parity = JSON.parse(fs.readFileSync(process.argv[3] || new URL('../../../cmcp/conformance/sprite-parity.json', import.meta.url), 'utf8'));
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new' });
const page = await browser.newPage();
await page.goto(base);
const sprite = await (await fetch(new URL('cmcp/marauder.sprite.json', base))).json();
const results = await page.evaluate(async (sp, views) => {
  const { drawSprite } = await import('/src/cmcp/sprite.ts');
  const pix = (d) => d.canvas.getContext('2d').getImageData(0, 0, d.canvas.width, d.canvas.height).data;
  const out = [];
  for (const exp of views) {
    const v = sp.views[exp.view];
    const w = v.viewBox[2] * 2;
    const off = Object.fromEntries((v.glows ?? []).map((g) => [g.id, 0])); // a glow with no amount burns at its own intensity: the baseline switches them off
    const base0 = drawSprite(v, w, { glows: off });
    const a = pix(base0), W = base0.canvas.width, H = base0.canvas.height;
    let cov = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a[(y * W + x) * 4 + 3] >= 128) { cov++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const zones = Object.fromEntries((v.zones ?? []).map((z) => [z.id, 1]));
    for (const l of v.layers) for (const s of l.shapes) if (s.zone) zones[s.zone] = 1;
    const t = pix(drawSprite(v, w, { zones, glows: off }));
    let red = 0;
    for (let i = 0; i < W * H; i++) if (a[i * 4 + 3] >= 128) red += (t[i * 4] - t[i * 4 + 1]) - (a[i * 4] - a[i * 4 + 1]);
    const glows = Object.fromEntries((v.glows ?? []).map((g) => [g.id, 1]));
    const g = pix(drawSprite(v, w, { glows }));
    let br = 0;
    for (let i = 0; i < W * H; i++) br += g[i * 4] + g[i * 4 + 1] + g[i * 4 + 2] - (a[i * 4] + a[i * 4 + 1] + a[i * 4 + 2]);
    out.push({ view: exp.view, w: W, h: H, coverage: cov / (W * H), bbox: [x0, y0, x1, y1], red: cov ? red / cov : 0, glow: br / (W * H) });
  }
  return out;
}, sprite, parity.views);
let failed = 0;
for (const exp of parity.views) {
  const m = results.find((r) => r.view === exp.view);
  const ok = [
    [m.w === exp.w && m.h === exp.h, `size ${m.w}x${m.h}`],
    [Math.abs(m.coverage - exp.coverage) <= 0.03, `coverage ${m.coverage.toFixed(4)} vs ${exp.coverage}`],
    [m.bbox.every((v, i) => Math.abs(v - exp.bbox[i]) <= 6), `bbox ${m.bbox} vs ${exp.bbox}`],
    [m.red >= exp.tint_red_shift_min, `tint_red_shift ${m.red.toFixed(1)} >= ${exp.tint_red_shift_min}`],
    [m.glow >= exp.glow_brighten_min, `glow_brighten ${m.glow.toFixed(2)} >= ${exp.glow_brighten_min}`],
  ];
  for (const [pass, what] of ok) { if (!pass) failed++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${exp.view}: ${what}`); }
}
await browser.close();
process.exit(failed ? 1 : 0);
