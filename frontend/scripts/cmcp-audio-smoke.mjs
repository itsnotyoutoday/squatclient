/* global document AudioContext */
// The Web Audio backend in real headless Chrome: a recipe, a streamed file (a generated WAV) and the bell run without errors, the
// context runs, and a looped crossfaded bed starts a second element before the first one ends. (No speakers are heard here.)
//   node scripts/cmcp-audio-smoke.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
const base = process.argv[2] || 'http://localhost:5173/';
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
const res = await page.evaluate(async () => {
  const { WebAudioBackend, CmcpAudio } = await import('/src/cmcp/audio.ts');
  const wavUrl = (secs) => {
    const rate = 8000, n = rate * secs, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 8) * 6000, true);
    const b = new Blob([buf], { type: 'audio/wav' });
    return URL.createObjectURL(b);
  };
  const be = new WebAudioBackend();
  const audio = new CmcpAudio(be);
  audio.setForeground('s');
  audio.setSettings({ volume: 100, muted: false, categories: {} });
  const recipe = { duration: 0.4, gain: 1, pan: 0, detuneCents: 0, voices: [
    { type: 'osc', wave: 'saw', freq: { start: 900, end: 260, curve: 'exp' }, amp: { Peak: 0.3, A: 0.005, D: 0.1, S: 0.5, R: 0.2 }, detuneCents: 0, delay: 0, pan: 0, gain: 1 },
    { type: 'noise', color: 'white', filter: { type: 'bandpass', cutoff: { start: 3000, end: 800, curve: 'exp' }, q: 4 }, amp: { Peak: 0.1, A: 0.002, D: 0.08, S: 0.3, R: 0.2 }, detuneCents: 0, delay: 0, pan: 0, gain: 1,
      lfo: { target: 'amp', rate: 6, depth: 0.1, wave: 'sine' } } ] };
  audio.handle({ session: 's', op: 'play', event: 'phaser_fire', category: 'weapon', volume: 1, priority: 5, res: { kind: 'recipe', recipe } });
  audio.handle({ session: 's', op: 'play', event: 'red_alert', key: 'bed', category: 'alert', loop: true, volume: 1, priority: 5, res: { kind: 'url', url: wavUrl(3), loop: true, crossfadeMs: 500, gain: 1 } });
  audio.handle({ session: 's', op: 'play', event: 'comm_beep', category: 'ui', volume: 1, priority: 5, res: { kind: 'bell' } });
  await new Promise((r) => setTimeout(r, 3500));
  const els = document.querySelectorAll('audio').length;
  const active = audio.active;
  audio.stopAll(50);
  return { active, els, state: new AudioContext().state };
});
console.log(JSON.stringify(res), errors.length ? 'ERRORS ' + errors.join('|') : 'no errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
