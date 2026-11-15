/** The audio engine of the CMCP consoles (cmcp spec 9). The Go side has already decided WHAT to play (local file named by the era
 * map, pack sample, recipe, bell: spec 9.8) and hands over plain instructions; this plays them: files stream through an audio
 * element into the Web Audio graph (long beds are not downloaded whole), recipes are synthesised, looped beds crossfade, staged
 * sounds escalate by time, categories/master/mute apply, at most 16 voices with priority eviction, and only the session in front
 * makes sound. Nothing here fetches from a game: URLs point at the app's own audio handler. */
export interface ResolvedSweep { start: number; end?: number; curve?: string; time?: number }
export interface ResolvedVoice {
  type: 'osc' | 'noise'; wave?: string; color?: string; freq?: ResolvedSweep;
  filter?: { type: string; cutoff: ResolvedSweep; q: number };
  amp: { Peak: number; A: number; D: number; S: number; R: number };
  detuneCents: number; delay: number; pan: number; gain: number;
  lfo?: { target: string; rate: number; depth: number; wave: string };
}
export interface ResolvedRecipe { duration: number; loop?: boolean; gain: number; pan: number; detuneCents: number; voices: ResolvedVoice[] }

export interface Instr {
  kind: 'url' | 'recipe' | 'bell' | 'silence' | 'staged';
  url?: string; gain?: number; loop?: boolean; volume?: number; atS?: number; crossfadeMs?: number;
  recipe?: ResolvedRecipe; stages?: Instr[]; onStop?: Instr;
}
export interface SoundMsg {
  session: string; op: 'play' | 'stop' | 'stopall'; key?: string; event?: string; category?: string;
  volume: number; pan?: number; priority: number; fadeMs?: number; loop?: boolean; res?: Instr;
}
export interface AudioSettings { volume: number; muted: boolean; categories: Record<string, number> }

/** One playing source. gain is the final linear gain; stop fades out and releases it. */
export interface Handle { setGain(g: number): void; stop(fadeMs: number): void; fadeIn(ms: number, to: number): void }
export interface Backend {
  playUrl(url: string, o: { gain: number; loop: boolean; crossfadeMs: number; pan: number; onEnd: () => void }): Handle;
  playRecipe(r: ResolvedRecipe, o: { gain: number; pan: number; onEnd: () => void }): Handle;
  bell(): void;
}
export interface Clock { setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void; now(): number }

export const MAX_VOICES = 16;
const realClock: Clock = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as number), now: () => Date.now() };

interface Voice {
  id: number; session: string; key: string; event: string; category: string; priority: number; started: number;
  base: number; // volume of the message times the instruction's own volume and gain, before master and category
  handle: Handle | null; timers: unknown[]; onStop?: Instr; stopping: boolean; msg: SoundMsg;
}

export class CmcpAudio {
  settings: AudioSettings = { volume: 70, muted: false, categories: {} };
  private fg = '';
  private voices = new Map<number, Voice>();
  private seq = 0;
  /** what the last play() decided, for tests and diagnostics */
  log: string[] = [];

  constructor(private be: Backend, private clock: Clock = realClock) {}

  setSettings(s: AudioSettings): void {
    this.settings = s;
    for (const v of this.voices.values()) v.handle?.setGain(this.gain(v));
    if (s.muted || s.volume <= 0) this.stopAll(100);
  }

  /** Only the session in front makes sound; the others' voices end with a short fade. */
  setForeground(session: string): void {
    this.fg = session;
    for (const v of [...this.voices.values()]) if (v.session !== session) this.end(v, 200, false);
  }

  private catVol(c: string): number { const v = this.settings.categories[c]; return v === undefined ? 1 : Math.max(0, Math.min(1, v / 100)); }
  private gain(v: Voice): number { return v.base * (this.settings.volume / 100) * this.catVol(v.category); }
  get active(): number { return this.voices.size; }
  has(key: string): boolean { return [...this.voices.values()].some((v) => v.key === key || (!v.key && v.event === key)); }

  handle(m: SoundMsg): void {
    if (m.op === 'stopall') { this.stopAll(m.fadeMs ?? 150, m.session); return; }
    if (m.op === 'stop') { this.stop(m.session, m.key ?? '', m.event ?? '', m.fadeMs ?? 120); return; }
    this.play(m);
  }

  play(m: SoundMsg): void {
    const res = m.res;
    if (!res || res.kind === 'silence') return;
    if (m.session !== this.fg && this.fg !== '') { this.log.push(`drop ${m.event}: not the foreground session`); return; }
    if (this.settings.muted || this.settings.volume <= 0) return;
    const cat = m.category || 'system';
    if (this.catVol(cat) <= 0) { this.log.push(`drop ${m.event}: category ${cat} is off`); return; }
    if (res.kind === 'bell') { this.be.bell(); return; }
    const key = m.key ?? '';
    // the same key (or the same looped event) replaces what plays
    for (const v of [...this.voices.values()]) {
      if (v.session === m.session && ((m.key && v.key === m.key) || (!m.key && !v.key && v.event === m.event && (v.msg.loop || v.msg.res?.loop || v.msg.res?.kind === 'staged')))) this.end(v, m.fadeMs ?? 80, false);
    }
    if (this.voices.size >= MAX_VOICES) {
      const worst = [...this.voices.values()].sort((a, b) => a.priority - b.priority || a.started - b.started)[0];
      if (m.priority < worst.priority) { this.log.push(`drop ${m.event}: below every playing voice`); return; }
      this.end(worst, 30, false);
    }
    const v: Voice = { id: ++this.seq, session: m.session, key, event: m.event ?? '', category: cat, priority: m.priority, started: this.clock.now(), base: 1, handle: null, timers: [], onStop: res.onStop, stopping: false, msg: m };
    this.voices.set(v.id, v);
    if (res.kind === 'staged') this.startStaged(v, res);
    else this.start(v, res, m.fadeMs ?? 0, m);
  }

  private instrBase(m: SoundMsg, i: Instr): number { return (m.volume || 1) * (i.volume || 1) * (i.gain || 1); }

  private start(v: Voice, i: Instr, fadeMs: number, m: SoundMsg): Handle | null {
    v.base = this.instrBase(m, i);
    const g = this.gain(v);
    const onEnd = (): void => { if (!i.loop && !m.loop) this.drop(v); };
    let h: Handle | null = null;
    if (i.kind === 'url' && i.url) h = this.be.playUrl(i.url, { gain: fadeMs > 0 ? 0 : g, loop: !!(i.loop || m.loop), crossfadeMs: i.crossfadeMs ?? 0, pan: m.pan ?? 0, onEnd });
    else if (i.kind === 'recipe' && i.recipe) h = this.be.playRecipe(i.recipe, { gain: fadeMs > 0 ? 0 : g, pan: m.pan ?? 0, onEnd });
    if (h && fadeMs > 0) h.fadeIn(fadeMs, g);
    v.handle = h;
    if (!h) this.drop(v);
    return h;
  }

  /** Stages replace each other at their at_s (seconds since the play), crossfading; a looped stage repeats until the next. */
  private startStaged(v: Voice, res: Instr): void {
    const stages = res.stages ?? [];
    if (stages.length === 0) { this.drop(v); return; }
    const m = v.msg;
    const run = (idx: number, xf: number): void => {
      if (v.stopping || !this.voices.has(v.id)) return;
      const st = stages[idx];
      const prev = v.handle;
      if (prev && xf > 0) prev.stop(xf); else prev?.stop(0);
      v.base = this.instrBase(m, st);
      const g = this.gain(v);
      const loop = st.loop ?? false;
      const onEnd = (): void => { if (idx === stages.length - 1 && !loop) this.drop(v); };
      let h: Handle | null = null;
      if (st.kind === 'url' && st.url) h = this.be.playUrl(st.url, { gain: xf > 0 ? 0 : g, loop, crossfadeMs: st.crossfadeMs ?? 0, pan: m.pan ?? 0, onEnd });
      else if (st.kind === 'recipe' && st.recipe) h = this.be.playRecipe(st.recipe, { gain: xf > 0 ? 0 : g, pan: m.pan ?? 0, onEnd });
      else if (st.kind === 'bell') this.be.bell();
      if (h && xf > 0) h.fadeIn(xf, g);
      v.handle = h;
    };
    stages.forEach((st, idx) => {
      const at = (st.atS ?? 0) * 1000;
      if (idx === 0) run(0, 0);
      else v.timers.push(this.clock.setTimeout(() => run(idx, st.crossfadeMs ?? 0), at));
    });
  }

  private drop(v: Voice): void {
    for (const t of v.timers) this.clock.clearTimeout(t);
    this.voices.delete(v.id);
  }

  /** Ends a voice with a fade; playOnStop plays its stand-down sound (Sound.Stop, not an eviction). */
  private end(v: Voice, fadeMs: number, playOnStop: boolean): void {
    if (v.stopping) return;
    v.stopping = true;
    for (const t of v.timers) this.clock.clearTimeout(t);
    v.handle?.stop(fadeMs);
    this.voices.delete(v.id);
    if (playOnStop && v.onStop && this.settings.volume > 0 && !this.settings.muted && v.session === this.fg) {
      const o = v.onStop;
      const id = ++this.seq;
      const w: Voice = { id, session: v.session, key: '', event: `${v.event}:stop`, category: v.category, priority: v.priority, started: this.clock.now(), base: (v.msg.volume || 1) * (o.volume || 1) * (o.gain || 1), handle: null, timers: [], stopping: false, msg: { ...v.msg, loop: false } };
      this.voices.set(id, w);
      w.handle = o.kind === 'url' && o.url ? this.be.playUrl(o.url, { gain: this.gain(w), loop: false, crossfadeMs: 0, pan: v.msg.pan ?? 0, onEnd: () => this.drop(w) }) : null;
      if (!w.handle) this.drop(w);
    }
  }

  stop(session: string, key: string, event: string, fadeMs: number): void {
    for (const v of [...this.voices.values()]) {
      if (v.session !== session) continue;
      if ((key && v.key === key) || (!key && event && v.event === event)) this.end(v, fadeMs, true);
    }
  }

  stopAll(fadeMs: number, session?: string): void {
    for (const v of [...this.voices.values()]) if (!session || v.session === session) this.end(v, fadeMs, false);
  }
}

// ------------------------------------------------------------------------------------------------ Web Audio backend

function noiseBuffer(ctx: BaseAudioContext, color: string, seconds = 2): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else if (color === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    else d[i] = w;
  }
  return b;
}

/** The real backend. One AudioContext, created at the first sound (after a user gesture the browser allows it to run). */
export class WebAudioBackend implements Backend {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private get c(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  playUrl(url: string, o: { gain: number; loop: boolean; crossfadeMs: number; pan: number; onEnd: () => void }): Handle {
    const c = this.c;
    const gain = c.createGain();
    gain.gain.value = o.gain;
    const pan = c.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, o.pan));
    gain.connect(pan).connect(this.out!);
    let cur: HTMLAudioElement | null = null;
    let timer: number | undefined;
    let ended = false;
    const mk = (): { el: HTMLAudioElement; g: GainNode } => {
      const el = new Audio(url);
      el.preload = 'auto';
      const src = c.createMediaElementSource(el);
      const g = c.createGain();
      src.connect(g).connect(gain);
      return { el, g };
    };
    const first = mk();
    cur = first.el;
    const xf = o.crossfadeMs;
    if (o.loop && xf > 0) {
      // crossfaded loop: before the end of the bed, the next copy fades in while this one fades out
      let a = first;
      const watch = (): void => {
        const d = a.el.duration;
        if (!Number.isFinite(d) || d <= 0) { timer = window.setTimeout(watch, 250); return; }
        const left = (d - a.el.currentTime) * 1000;
        if (left <= xf + 50 && d * 1000 > xf * 2.5) {
          const b = mk();
          cur = b.el;
          b.g.gain.setValueAtTime(0, c.currentTime);
          b.g.gain.linearRampToValueAtTime(1, c.currentTime + xf / 1000);
          a.g.gain.setValueAtTime(1, c.currentTime);
          a.g.gain.linearRampToValueAtTime(0, c.currentTime + xf / 1000);
          const old = a;
          window.setTimeout(() => { old.el.pause(); old.el.src = ''; }, xf + 100);
          void b.el.play().catch(() => undefined);
          a = b;
          timer = window.setTimeout(watch, 500);
        } else timer = window.setTimeout(watch, Math.max(60, Math.min(left - xf - 20, 1000)));
      };
      void first.el.play().then(() => watch()).catch(() => o.onEnd());
    } else {
      first.el.loop = o.loop;
      first.el.onended = (): void => { if (!ended) o.onEnd(); };
      void first.el.play().catch(() => o.onEnd());
    }
    return {
      setGain: (g) => { gain.gain.setTargetAtTime(g, c.currentTime, 0.02); },
      fadeIn: (ms, to) => { gain.gain.cancelScheduledValues(c.currentTime); gain.gain.setValueAtTime(0, c.currentTime); gain.gain.linearRampToValueAtTime(to, c.currentTime + ms / 1000); },
      stop: (ms) => {
        ended = true;
        window.clearTimeout(timer);
        gain.gain.cancelScheduledValues(c.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, c.currentTime);
        gain.gain.linearRampToValueAtTime(0, c.currentTime + Math.max(0.005, ms / 1000));
        window.setTimeout(() => { cur?.pause(); gain.disconnect(); }, ms + 60);
      },
    };
  }

  playRecipe(r: ResolvedRecipe, o: { gain: number; pan: number; onEnd: () => void }): Handle {
    const c = this.c;
    const master = c.createGain();
    master.gain.value = o.gain;
    const inner = c.createGain();
    inner.gain.value = r.gain;
    const mp = c.createStereoPanner();
    mp.pan.value = Math.max(-1, Math.min(1, r.pan + o.pan));
    inner.connect(mp).connect(master).connect(this.out!);
    let stopped = false;
    let timer: number | undefined;
    const nodes: AudioScheduledSourceNode[] = [];
    const sweepTo = (p: AudioParam, s: { start: number; end?: number; curve?: string; time?: number }, t0: number, dur: number): void => {
      p.setValueAtTime(Math.max(0.0001, s.start), t0);
      if (s.end !== undefined) {
        const t1 = t0 + (s.time && s.time > 0 ? s.time : dur);
        if (s.curve === 'exp') p.exponentialRampToValueAtTime(Math.max(0.0001, s.end), t1); else p.linearRampToValueAtTime(s.end, t1);
      }
    };
    const cycle = (): void => {
      const t0 = c.currentTime + 0.005;
      for (const v of r.voices) {
        const vt = t0 + v.delay, dur = Math.max(0.02, r.duration - v.delay);
        const vg = c.createGain();
        const e = v.amp;
        vg.gain.setValueAtTime(0, vt);
        vg.gain.linearRampToValueAtTime(e.Peak, vt + Math.max(0.001, e.A));
        vg.gain.linearRampToValueAtTime(e.Peak * e.S, vt + Math.max(0.002, e.A + e.D));
        vg.gain.setValueAtTime(e.Peak * e.S, vt + Math.max(e.A + e.D, dur - e.R));
        vg.gain.linearRampToValueAtTime(0, vt + dur);
        const pn = c.createStereoPanner();
        pn.pan.value = Math.max(-1, Math.min(1, v.pan));
        const vo = c.createGain();
        vo.gain.value = v.gain;
        let src: AudioScheduledSourceNode;
        let freqParam: AudioParam | null = null;
        if (v.type === 'noise') {
          const bs = c.createBufferSource();
          bs.buffer = noiseBuffer(c, v.color ?? 'white');
          bs.loop = true;
          src = bs;
        } else {
          const os = c.createOscillator();
          os.type = (['sine', 'square', 'sawtooth', 'triangle'].includes(v.wave ?? '') ? v.wave : v.wave === 'saw' ? 'sawtooth' : 'sine') as OscillatorType;
          if (v.freq) sweepTo(os.frequency, v.freq, vt, dur);
          os.detune.value = v.detuneCents + r.detuneCents;
          freqParam = os.frequency;
          src = os;
        }
        let tail: AudioNode = src;
        if (v.filter) {
          const f = c.createBiquadFilter();
          f.type = (v.filter.type as BiquadFilterType) || 'lowpass';
          f.Q.value = v.filter.q;
          sweepTo(f.frequency, v.filter.cutoff, vt, dur);
          tail.connect(f);
          tail = f;
        }
        tail.connect(vg).connect(vo).connect(pn).connect(inner);
        if (v.lfo) {
          const l = c.createOscillator();
          l.type = (v.lfo.wave === 'saw' ? 'sawtooth' : (v.lfo.wave as OscillatorType)) || 'sine';
          l.frequency.value = v.lfo.rate;
          const lg = c.createGain();
          lg.gain.value = v.lfo.depth;
          l.connect(lg);
          const target = v.lfo.target === 'pan' ? pn.pan : v.lfo.target === 'amp' ? vo.gain : v.lfo.target === 'freq' ? freqParam : null;
          if (target) lg.connect(target);
          l.start(vt);
          l.stop(vt + dur + 0.05);
          nodes.push(l);
        }
        src.start(vt);
        src.stop(vt + dur + 0.05);
        nodes.push(src);
      }
      timer = window.setTimeout(() => {
        if (stopped) return;
        if (r.loop) cycle(); else o.onEnd();
      }, r.duration * 1000);
    };
    cycle();
    return {
      setGain: (g) => { master.gain.setTargetAtTime(g, c.currentTime, 0.02); },
      fadeIn: (ms, to) => { master.gain.cancelScheduledValues(c.currentTime); master.gain.setValueAtTime(0, c.currentTime); master.gain.linearRampToValueAtTime(to, c.currentTime + ms / 1000); },
      stop: (ms) => {
        stopped = true;
        window.clearTimeout(timer);
        master.gain.cancelScheduledValues(c.currentTime);
        master.gain.setValueAtTime(master.gain.value, c.currentTime);
        master.gain.linearRampToValueAtTime(0, c.currentTime + Math.max(0.005, ms / 1000));
        window.setTimeout(() => { for (const n of nodes) { try { n.stop(); } catch { /* already stopped */ } } master.disconnect(); }, ms + 80);
      },
    };
  }

  bell(): void {
    const c = this.c, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.3);
  }
}
