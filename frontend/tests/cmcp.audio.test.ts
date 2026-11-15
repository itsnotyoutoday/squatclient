import { describe, expect, it } from 'vitest';
import { CmcpAudio, MAX_VOICES, useAudioStats, type Backend, type Clock, type Handle, type Instr, type SoundMsg } from '../src/cmcp/audio';

/** A backend that records what it was asked to play, and a clock the test drives. */
function rig() {
  const played: { url?: string; recipe?: boolean; gain: number; loop: boolean; xf: number; h: Handle; stopped?: number; fadeIn?: number; gainNow: number }[] = [];
  let bells = 0;
  const be: Backend = {
    playUrl(url, o) {
      const rec = { url, gain: o.gain, loop: o.loop, xf: o.crossfadeMs, gainNow: o.gain, h: null as unknown as Handle, stopped: undefined as number | undefined, fadeIn: undefined as number | undefined };
      rec.h = { setGain: (g) => { rec.gainNow = g; }, stop: (ms) => { rec.stopped = ms; }, fadeIn: (ms, to) => { rec.fadeIn = ms; rec.gainNow = to; } };
      played.push(rec);
      return rec.h;
    },
    playRecipe(_r, o) {
      const rec = { recipe: true, gain: o.gain, loop: false, xf: 0, gainNow: o.gain, h: null as unknown as Handle, stopped: undefined as number | undefined, fadeIn: undefined as number | undefined };
      rec.h = { setGain: (g) => { rec.gainNow = g; }, stop: (ms) => { rec.stopped = ms; }, fadeIn: (ms, to) => { rec.fadeIn = ms; rec.gainNow = to; } };
      played.push(rec);
      return rec.h;
    },
    bell() { bells++; },
  };
  let now = 0;
  const timers: { at: number; f: () => void; id: number; dead?: boolean }[] = [];
  let n = 0;
  const clock: Clock = {
    now: () => now,
    setTimeout: (f, ms) => { const t = { at: now + ms, f, id: ++n }; timers.push(t); return t.id; },
    clearTimeout: (h) => { const t = timers.find((x) => x.id === h); if (t) t.dead = true; },
  };
  const advance = (ms: number): void => {
    const end = now + ms;
    for (;;) {
      const next = timers.filter((t) => !t.dead && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      next.dead = true;
      now = next.at;
      next.f();
    }
    now = end;
  };
  const audio = new CmcpAudio(be, clock);
  audio.setForeground('s1');
  return { audio, played, advance, bells: () => bells };
}
const url = (u: string, o: Partial<Instr> = {}): Instr => ({ kind: 'url', url: u, gain: 1, ...o });
const play = (o: Partial<SoundMsg> & { res: Instr }): SoundMsg => ({ session: 's1', op: 'play', volume: 1, priority: 5, category: 'system', event: 'e', ...o });

describe('CMCP audio', () => {
  it('applies master volume, category volume and the message volume', () => {
    const { audio, played } = rig();
    audio.setSettings({ volume: 50, muted: false, categories: { weapon: 50 } });
    audio.handle(play({ category: 'weapon', volume: 0.8, res: url('/a.mp3', { gain: 0.5 }) }));
    expect(played[0].gain).toBeCloseTo(0.5 * 0.5 * 0.8 * 0.5, 5);
  });
  it('plays nothing when muted or when the category is off, and rings the bell for a bell result', () => {
    const r = rig();
    r.audio.setSettings({ volume: 70, muted: true, categories: {} });
    r.audio.handle(play({ res: url('/a.mp3') }));
    expect(r.played).toHaveLength(0);
    r.audio.setSettings({ volume: 70, muted: false, categories: { ui: 0 } });
    r.audio.handle(play({ category: 'ui', res: url('/a.mp3') }));
    expect(r.played).toHaveLength(0);
    r.audio.handle(play({ category: 'alert', res: { kind: 'bell' } }));
    expect(r.bells()).toBe(1);
  });
  it('only the foreground session is heard; switching sessions fades the others out', () => {
    const r = rig();
    r.audio.handle(play({ session: 's2', res: url('/x.mp3') }));
    expect(r.played).toHaveLength(0);
    r.audio.handle(play({ key: 'k', loop: true, res: url('/bed.mp3', { loop: true }) }));
    expect(r.played).toHaveLength(1);
    r.audio.setForeground('s2');
    expect(r.played[0].stopped).toBe(200);
    expect(r.audio.active).toBe(0);
  });
  it('a looped sound is stopped by its event or key, and a new play with the same key replaces it', () => {
    const r = rig();
    r.audio.handle(play({ key: 'hum', event: 'warp_core_hum', loop: true, res: url('/a.mp3', { loop: true }) }));
    r.audio.handle(play({ key: 'hum', event: 'warp_core_hum', loop: true, res: url('/b.mp3', { loop: true }) }));
    expect(r.played[0].stopped).toBeDefined();
    expect(r.audio.active).toBe(1);
    r.audio.handle({ session: 's1', op: 'stop', event: '', key: 'hum', volume: 0, priority: 0 });
    expect(r.audio.active).toBe(0);
    r.audio.handle(play({ event: 'impulse_loop', loop: true, res: url('/c.mp3', { loop: true }) }));
    r.audio.handle({ session: 's1', op: 'stop', event: 'impulse_loop', volume: 0, priority: 0 });
    expect(r.audio.active).toBe(0);
  });
  it('escalates a staged alert by time with a crossfade, and plays the stand-down on stop', () => {
    const r = rig();
    const res: Instr = { kind: 'staged', stages: [url('/red.mp3', { loop: true, atS: 0 }), url('/klaxon.mp3', { loop: true, atS: 90, crossfadeMs: 800 })], onStop: url('/ok.mp3') };
    r.audio.handle(play({ event: 'red_alert', category: 'alert', res }));
    expect(r.played.map((p) => p.url)).toEqual(['/red.mp3']);
    r.advance(89_000);
    expect(r.played).toHaveLength(1);
    r.advance(1_500);
    expect(r.played.map((p) => p.url)).toEqual(['/red.mp3', '/klaxon.mp3']);
    expect(r.played[0].stopped).toBe(800); // the first bed fades out while the next fades in
    expect(r.played[1].fadeIn).toBe(800);
    r.audio.handle({ session: 's1', op: 'stop', event: 'red_alert', volume: 0, priority: 0 });
    expect(r.played[1].stopped).toBeDefined();
    expect(r.played.at(-1)?.url).toBe('/ok.mp3'); // on_stop
  });
  it('a stop before the later stages cancels them', () => {
    const r = rig();
    r.audio.handle(play({ event: 'red_alert', res: { kind: 'staged', stages: [url('/a.mp3', { loop: true }), url('/b.mp3', { loop: true, atS: 30 })] } }));
    r.audio.handle({ session: 's1', op: 'stop', event: 'red_alert', volume: 0, priority: 0 });
    r.advance(60_000);
    expect(r.played.map((p) => p.url)).toEqual(['/a.mp3']);
  });
  it('keeps at most 16 voices: the lowest priority goes, and a sound below every voice is dropped', () => {
    const r = rig();
    for (let i = 0; i < MAX_VOICES; i++) r.audio.handle(play({ key: `k${i}`, priority: 5 + (i % 3), loop: true, res: url(`/${i}.mp3`, { loop: true }) }));
    expect(r.audio.active).toBe(MAX_VOICES);
    r.audio.handle(play({ key: 'low', priority: 1, res: url('/low.mp3') }));
    expect(r.audio.has('low')).toBe(false);
    expect(r.audio.active).toBe(MAX_VOICES);
    r.audio.handle(play({ key: 'hi', priority: 9, res: url('/hi.mp3', { loop: true }), loop: true }));
    expect(r.audio.has('hi')).toBe(true);
    expect(r.audio.active).toBe(MAX_VOICES);
    expect(r.played.some((p, i) => i < MAX_VOICES && p.stopped !== undefined)).toBe(true);
  });
  it('follows volume changes of the settings while a sound plays', () => {
    const r = rig();
    r.audio.setSettings({ volume: 100, muted: false, categories: {} });
    r.audio.handle(play({ key: 'k', loop: true, res: url('/a.mp3', { loop: true }) }));
    r.audio.setSettings({ volume: 20, muted: false, categories: {} });
    expect(r.played[0].gainNow).toBeCloseTo(0.2, 5);
    r.audio.setSettings({ volume: 20, muted: true, categories: {} });
    expect(r.audio.active).toBe(0);
  });
  it('stopall ends every voice of the session', () => {
    const r = rig();
    r.audio.handle(play({ key: 'a', loop: true, res: url('/a.mp3', { loop: true }) }));
    r.audio.handle(play({ key: 'b', loop: true, res: url('/b.mp3', { loop: true }) }));
    r.audio.handle({ session: 's1', op: 'stopall', volume: 0, priority: 0, fadeMs: 300 });
    expect(r.audio.active).toBe(0);
    expect(r.played.every((p) => p.stopped === 300)).toBe(true);
  });
});

describe('sound diagnostics and the recipe fallback', () => {
  const recipe = { duration: 1, gain: 1, pan: 0, detuneCents: 0, voices: [] };
  it('plays the pack recipe when the file cannot be loaded, and says what happened', () => {
    const calls: string[] = [];
    const be: Backend = {
      playUrl(_u, o) { calls.push('url'); o.onFail?.('HTTP 404'); return { setGain: () => undefined, stop: () => undefined, fadeIn: () => undefined }; },
      playRecipe() { calls.push('recipe'); return { setGain: () => undefined, stop: () => undefined, fadeIn: () => undefined }; },
      bell: () => undefined,
      state: () => 'running',
    };
    const audio = new CmcpAudio(be);
    audio.setForeground('s1');
    useAudioStats.getState().set({ played: 0, failed: 0, dropped: 0, last: '', lastError: '', lastDrop: '' });
    const alt: Instr = { kind: 'recipe', recipe };
    audio.handle({ session: 's1', op: 'play', event: 'red_alert', category: 'alert', volume: 1, priority: 5, res: { kind: 'url', url: '/cmcp-audio/sample/s1/red_alert.ogg', alt } });
    expect(calls).toEqual(['url', 'recipe']);
    const st = useAudioStats.getState();
    expect(st.played).toBe(1);
    expect(st.failed).toBe(1);
    expect(st.lastError).toMatch(/red_alert: HTTP 404/);
    expect(st.last).toBe('red_alert [pack: red_alert.ogg]');
  });
  it('names the local file and the stages in the diagnostic line', () => {
    const { audio } = rig();
    useAudioStats.getState().set({ played: 0 });
    audio.handle({ session: 's1', op: 'play', event: 'red_alert', category: 'alert', volume: 1, priority: 5, res: { kind: 'staged', stages: [{ kind: 'url', url: '/cmcp-audio/local/redalertandklaxons/tng_red_alert3.mp3', loop: true }, { kind: 'recipe', recipe }] } });
    expect(useAudioStats.getState().last).toBe('red_alert [staged: local: redalertandklaxons/tng_red_alert3.mp3 > recipe]');
  });
  it('reports why a sound was not played (muted)', () => {
    const { audio } = rig();
    audio.setSettings({ volume: 0, muted: false, categories: {} });
    audio.handle({ session: 's1', op: 'play', event: 'phaser_fire', category: 'weapon', volume: 1, priority: 5, res: { kind: 'recipe', recipe } });
    expect(useAudioStats.getState().lastDrop).toMatch(/phaser_fire: sound is muted/);
  });
  it('the Test sound chirp plays through the backend without a game', () => {
    const { audio, played } = rig();
    expect(audio.test()).toBeTruthy();
    expect(played.some((p) => p.recipe)).toBe(true);
  });
});

describe('the audio path is traced for client.log', () => {
  it('writes what arrived, the foreground session and why a sound was not played', () => {
    const lines: string[] = [];
    const { audio } = rig();
    audio.sink = (l) => lines.push(l);
    audio.setForeground('s1');
    const recipe = { duration: 1, gain: 1, pan: 0, detuneCents: 0, voices: [] };
    audio.handle({ session: 's2', op: 'play', event: 'red_alert', category: 'alert', volume: 1, priority: 5, res: { kind: 'recipe', recipe } }); // another session: dropped
    audio.handle({ session: 's1', op: 'play', event: 'phaser_fire', category: 'weapon', volume: 1, priority: 5, res: { kind: 'recipe', recipe } });
    const text = lines.join('\n');
    expect(text).toMatch(/audio: received play red_alert session=s2 fg=s1/);
    expect(text).toMatch(/audio: NOT played red_alert: not the foreground session/);
    expect(text).toMatch(/audio: playing phaser_fire/);
  });
});

describe('a session id of a gtf squatter ("sq1:fake")', () => {
  it('is matched by the foreground session like any other id', () => {
    const { audio, played } = rig();
    audio.setForeground('sq1:fake');
    const recipe = { duration: 1, gain: 1, pan: 0, detuneCents: 0, voices: [] };
    audio.handle({ session: 'sq1:fake', op: 'play', event: 'red_alert', category: 'alert', volume: 1, priority: 5, res: { kind: 'recipe', recipe } });
    expect(played.some((p) => p.recipe)).toBe(true);
  });
});
