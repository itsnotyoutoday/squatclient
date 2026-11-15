import { create } from 'zustand';

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
  /** what to play when the first choice cannot be loaded (the pack's recipe for the event) */
  alt?: Instr;
}
export interface SoundMsg {
  /** follows one Sound.Play through the diagnostics log (set by the Go side) */
  evId?: string;
  session: string; op: 'play' | 'stop' | 'stopall'; key?: string; event?: string; category?: string;
  volume: number; pan?: number; priority: number; fadeMs?: number; loop?: boolean; res?: Instr;
}
export interface AudioSettings { volume: number; muted: boolean; categories: Record<string, number> }

/** One playing source. gain is the final linear gain; stop fades out and releases it. */
export interface Handle { setGain(g: number): void; stop(fadeMs: number): void; fadeIn(ms: number, to: number): void }
export interface Backend {
  playUrl(url: string, o: { gain: number; loop: boolean; crossfadeMs: number; pan: number; onEnd: () => void; onFail?: (why: string) => void; trace?: (l: string) => void }): Handle;
  /** start/resume the audio context (browsers and WebKit views only allow it from a user gesture) */
  unlock?(): void;
  /** whether this view decodes a format: 'ogg' | 'mp3' | 'wav' */
  canDecode?(fmt: string): boolean;
  /** the audio context's state: running | suspended | closed | none (not created yet) */
  state?(): string;
  playRecipe(r: ResolvedRecipe, o: { gain: number; pan: number; onEnd: () => void }): Handle;
  bell(): void;
}
export interface Clock { setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void; now(): number }

export const MAX_VOICES = 16;

/** What the sound engine has done, for the Settings line "Sound: N played, last: event" (and for tests). */
export interface AudioStats { played: number; dropped: number; failed: number; last: string; lastDrop: string; lastError: string; ctx: string }
interface StatsStore extends AudioStats { set(p: Partial<AudioStats>): void }
export const useAudioStats = create<StatsStore>((set) => ({ played: 0, dropped: 0, failed: 0, last: '', lastDrop: '', lastError: '', ctx: 'none', set: (p) => set(p) }));
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

  /** the loops the game started and has not stopped (a red-alert klaxon): per session, by key or event. A loop dropped because its session was not in front, or cut
   * by a mute, is resumed when the session comes to the front again or the sound is unmuted: the game only starts it once. */
  private loops = new Map<string, Map<string, SoundMsg>>();
  private loopKey = (m: SoundMsg): string => m.key || m.event || '';
  private isLoop = (m: SoundMsg): boolean => !!(m.loop || m.res?.loop || (m.res?.kind === 'staged' && m.res.stages?.some((x) => x.loop)));
  private forget(session?: string, key?: string): void {
    if (!session) { this.loops.clear(); return; }
    if (!key) { this.loops.delete(session); return; }
    this.loops.get(session)?.delete(key);
  }
  private resume(session: string): void {
    if (this.settings.muted || this.settings.volume <= 0) return;
    for (const m of [...(this.loops.get(session)?.values() ?? [])]) {
      const k = this.loopKey(m);
      if (![...this.voices.values()].some((v) => v.session === session && (v.key === k || v.event === k))) { this.trace(`resuming the loop ${k} of ${session}`); this.play(m); }
    }
  }

  setSettings(s: AudioSettings): void {
    const was = !this.settings.muted && this.settings.volume > 0;
    this.settings = s;
    for (const v of this.voices.values()) v.handle?.setGain(this.gain(v));
    if (s.muted || s.volume <= 0) this.stopAll(100);
    else if (!was && this.fg) this.resume(this.fg); // unmuted: the alert that is still on sounds again
  }

  /** Only the session in front makes sound; the others' voices end with a short fade. */
  setForeground(session: string): void {
    this.trace(`foreground session is now ${session || '(none)'}`);
    this.fg = session;
    for (const v of [...this.voices.values()]) if (v.session !== session) this.end(v, 200, false);
    if (session) this.resume(session); // back on this tab: its loops go on
  }

  private catVol(c: string): number { const v = this.settings.categories[c]; return v === undefined ? 1 : Math.max(0, Math.min(1, v / 100)); }
  private gain(v: Voice): number { return v.base * (this.settings.volume / 100) * this.catVol(v.category); }
  get active(): number { return this.voices.size; }
  /** the audio engine's state for a diagnostics snapshot: context state, foreground, mute and volume, the voices playing and the loops remembered per session */
  snapshotLines(): string[] {
    const voices = [...this.voices.values()].map((v) => `${v.session}:${v.event || v.key}${v.msg.loop || v.msg.res?.loop ? '(loop)' : ''}`).join(',');
    const loops = [...this.loops.entries()].map(([s, m]) => `${s}:${[...m.keys()].join('|')}`).join(',');
    return [`audio ctx=${this.be.state?.() ?? '?'} fg=${this.fg || '(none)'} muted=${this.settings.muted} volume=${this.settings.volume} voices=${this.voices.size}[${voices}] loopsRemembered=[${loops}]`];
  }
  has(key: string): boolean { return [...this.voices.values()].some((v) => v.key === key || (!v.key && v.event === key)); }

  handle(m: SoundMsg): void {
    this.trace(`received ${m.op} ${m.event ?? ''} session=${m.session} fg=${this.fg || '(none)'} kind=${m.res?.kind ?? '-'} ${this.describe(m.res)} vol=${this.settings.volume} muted=${this.settings.muted} ctx=${this.be.state?.() ?? '?'}`, m);
    if (m.op === 'stopall') { this.forget(m.session); this.stopAll(m.fadeMs ?? 150, m.session); return; }
    if (m.op === 'stop') { this.forget(m.session, m.key || m.event); this.stop(m.session, m.key ?? '', m.event ?? '', m.fadeMs ?? 120); return; }
    if (this.isLoop(m)) { if (!this.loops.has(m.session)) this.loops.set(m.session, new Map()); this.loops.get(m.session)!.set(this.loopKey(m), m); }
    this.play(m);
  }

  play(m: SoundMsg): void {
    const res = m.res;
    if (!res || res.kind === 'silence') return;
    if (m.session !== this.fg && this.fg !== '') { this.drop2(m, `not the foreground session (session=${m.session} fg=${this.fg})`); return; }
    if (this.settings.muted || this.settings.volume <= 0) { this.drop2(m, `sound is muted or the volume is 0 (muted=${this.settings.muted} volume=${this.settings.volume})`); return; }
    const cat = m.category || 'system';
    if (this.catVol(cat) <= 0) { this.drop2(m, `category ${cat} is off (volume ${this.settings.categories[cat] ?? 'default'})`); return; }
    if (res.kind === 'bell') { this.be.bell(); this.played(m, 'bell'); return; }
    const key = m.key ?? '';
    // the same key (or the same looped event) replaces what plays
    for (const v of [...this.voices.values()]) {
      if (v.session === m.session && ((m.key && v.key === m.key) || (!m.key && !v.key && v.event === m.event && (v.msg.loop || v.msg.res?.loop || v.msg.res?.kind === 'staged')))) this.end(v, m.fadeMs ?? 80, false);
    }
    if (this.voices.size >= MAX_VOICES) {
      const worst = [...this.voices.values()].sort((a, b) => a.priority - b.priority || a.started - b.started)[0];
      if (m.priority < worst.priority) { this.drop2(m, `below every playing voice (priority ${m.priority}, ${this.voices.size} voices)`); return; }
      this.end(worst, 30, false);
    }
    const v: Voice = { id: ++this.seq, session: m.session, key, event: m.event ?? '', category: cat, priority: m.priority, started: this.clock.now(), base: 1, handle: null, timers: [], onStop: res.onStop, stopping: false, msg: m };
    this.voices.set(v.id, v);
    this.played(m, res.kind);
    if (res.kind === 'staged') this.startStaged(v, res);
    else this.start(v, res, m.fadeMs ?? 0, m);
  }

  /** where the sound comes from: local (your folder, with the file), pack (the game's sample), recipe, bell */
  private describe(r: Instr | undefined): string {
    if (!r) return '?';
    if (r.kind === 'staged') return `staged: ${(r.stages ?? []).map((x) => this.describe(x)).join(' > ')}`;
    if (r.kind === 'url' && r.url) {
      const local = r.url.includes('/cmcp-audio/local/');
      const f = decodeURIComponent(r.url.split('/').slice(local ? 3 : 4).join('/'));
      return `${local ? 'local' : 'pack'}: ${f}`;
    }
    return r.kind;
  }
  private played(m: SoundMsg, _kind: string): void {
    this.trace(`playing ${m.event} (${this.describe(m.res)}) ctx=${this.be.state?.() ?? '?'}`, m);
    if (this.be.state?.() === 'suspended') this.problem('suspended', 'Sound failed: the web view keeps audio suspended until you click or press a key in the window');
    const st = useAudioStats.getState();
    st.set({ played: st.played + 1, last: `${m.event ?? '?'} [${this.describe(m.res)}]`, ctx: this.be.state?.() ?? st.ctx });
  }
  private drop2(m: SoundMsg, why: string): void {
    this.log.push(`drop ${m.event}: ${why}`);
    this.trace(`dropped ${m.event}: ${why}`, m);
    const st = useAudioStats.getState();
    st.set({ dropped: st.dropped + 1, lastDrop: `${m.event ?? '?'}: ${why}` });
  }
  /** a file could not be loaded: say so, and play the pack's recipe for the event instead when there is one */
  /** told once with the exact reason when a sound cannot play ("Sound failed: ..."); also written to the app's client.log */
  onProblem?: (text: string) => void;
  sink?: (line: string, session?: string) => void;
  private told = new Set<string>();
  /** one line of the audio path for the diagnostics log (no cap: the log rolls over and has a size budget): what arrived, what was decided, how each file fared; ev= is the id the Go side gave this Sound.Play */
  trace(line: string, m?: SoundMsg): void {
    this.sink?.(`${m?.evId ? `ev=${m.evId} ` : ''}${line}`, m?.session);
  }
  private problem(key: string, text: string): void {
    this.sink?.(`problem: ${text}`);
    if (this.told.has(key)) return;
    this.told.add(key);
    this.onProblem?.(text);
  }

  private failedUrl(v: Voice, i: Instr, m: SoundMsg, why: string): void {
    this.problem(`fail:${i.url ?? ''}`, `Sound failed: ${m.event ?? '?'} (${i.url ?? 'url'}): ${why}${i.alt ? ' - trying the fallback' : ''}`);
    const st = useAudioStats.getState();
    st.set({ failed: st.failed + 1, lastError: `${m.event ?? '?'}: ${why}` });
    this.log.push(`fail ${m.event}: ${why}${i.alt ? ' (playing the recipe)' : ''}`);
    if (i.alt && this.voices.has(v.id)) v.handle = this.start(v, i.alt, 0, { ...m, res: i.alt });
  }

  /** the first user gesture unlocks the audio context (a WebKit view starts it suspended) */
  unlock(): void {
    this.be.unlock?.();
    useAudioStats.getState().set({ ctx: this.be.state?.() ?? 'none' });
  }

  /** "Test sound": a short two-tone chirp straight through the engine (independent of any game); returns the audio context's state */
  test(): string {
    this.unlock();
    const chirp: ResolvedRecipe = { duration: 0.5, gain: 1, pan: 0, detuneCents: 0, voices: [
      { type: 'osc', wave: 'sine', freq: { start: 660 }, amp: { Peak: 0.5, A: 0.01, D: 0.05, S: 0.8, R: 0.1 }, detuneCents: 0, delay: 0, pan: 0, gain: 1 },
      { type: 'osc', wave: 'sine', freq: { start: 880 }, amp: { Peak: 0.5, A: 0.01, D: 0.05, S: 0.8, R: 0.1 }, detuneCents: 0, delay: 0.25, pan: 0, gain: 1 },
    ] };
    const vol = this.settings.muted ? 0 : this.settings.volume / 100;
    const st = useAudioStats.getState();
    if (vol <= 0) { st.set({ lastDrop: 'test: sound is muted or the volume is 0' }); return 'muted'; }
    this.be.playRecipe(chirp, { gain: vol, pan: 0, onEnd: () => undefined });
    st.set({ played: st.played + 1, last: 'test chirp (recipe)', ctx: this.be.state?.() ?? 'none' });
    return this.be.state?.() ?? 'none';
  }

  private instrBase(m: SoundMsg, i: Instr): number { return (m.volume || 1) * (i.volume || 1) * (i.gain || 1); }

  private start(v: Voice, i0: Instr, fadeMs: number, m: SoundMsg): Handle | null {
    let i = i0;
    // a view that cannot decode Ogg Vorbis (WebKit before 18.4) goes straight to the fallback (the pack's wav, then the recipe)
    while (i.kind === 'url' && i.alt && /\.ogg(\?|$)/i.test(i.url ?? '') && this.be.canDecode && !this.be.canDecode('ogg')) i = i.alt;
    v.base = this.instrBase(m, i);
    const g = this.gain(v);
    const onEnd = (): void => { if (!i.loop && !m.loop) { this.trace(`ended ${m.event ?? ''}`, m); this.drop(v); } };
    let h: Handle | null = null;
    if (i.kind === 'url' && i.url) h = this.be.playUrl(i.url, { gain: fadeMs > 0 ? 0 : g, loop: !!(i.loop || m.loop), crossfadeMs: i.crossfadeMs ?? 0, pan: m.pan ?? 0, onEnd, onFail: (why) => this.failedUrl(v, i, m, why), trace: (l) => this.trace(l, m) });
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
      const onEnd = (): void => { if (idx === stages.length - 1 && !loop) { this.trace(`ended ${m.event ?? ''} (stage ${idx + 1}/${stages.length})`, m); this.drop(v); } };
      let h: Handle | null = null;
      if (st.kind === 'url' && st.url) h = this.be.playUrl(st.url, { gain: xf > 0 ? 0 : g, loop, crossfadeMs: st.crossfadeMs ?? 0, pan: m.pan ?? 0, onEnd, trace: (l) => this.trace(l, m) });
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
  unlock(): void {
    try { void this.c; } catch { /* no audio in this view */ }
  }
  state(): string { return this.ctx ? this.ctx.state : 'none'; }
  canDecode(fmt: string): boolean {
    try {
      const a = new Audio();
      const t: Record<string, string> = { ogg: 'audio/ogg; codecs="vorbis"', mp3: 'audio/mpeg', wav: 'audio/wav' };
      return a.canPlayType(t[fmt] ?? '') !== '';
    } catch { return true; }
  }
  private get c(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Files are fetched from the app's own audio handler and decoded into buffers: a buffer source needs only a running AudioContext (a user
   * gesture unlocks it), where an <audio> element needs its own autoplay permission in a WebKit view. A load or decode failure reports
   * through onFail so the caller can fall back to the pack's recipe. */
  private buffers = new Map<string, Promise<AudioBuffer>>();
  playUrl(url: string, o: { gain: number; loop: boolean; crossfadeMs: number; pan: number; onEnd: () => void; onFail?: (why: string) => void; trace?: (l: string) => void }): Handle {
    const c = this.c;
    o.trace?.(`fetching ${url} (ctx ${c.state})`);
    const gain = c.createGain();
    gain.gain.value = o.gain;
    const pan = c.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, o.pan));
    gain.connect(pan).connect(this.out!);
    let stopped = false;
    const timers: number[] = [];
    const live = new Set<AudioBufferSourceNode>();
    let load = this.buffers.get(url);
    if (!load) {
      load = fetch(url).then((r) => { o.trace?.(`fetched ${url}: HTTP ${r.status} ${r.headers.get('content-type') ?? ''}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }).then((b) => { o.trace?.(`decoding ${url}: ${b.byteLength} bytes`); return c.decodeAudioData(b); });
      this.buffers.set(url, load);
      load.catch(() => this.buffers.delete(url));
    }
    const begin = (buf: AudioBuffer, when: number, fadeInS: number, lastOne: boolean): AudioBufferSourceNode => {
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      src.connect(g).connect(gain);
      if (fadeInS > 0) { g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(1, when + fadeInS); }
      live.add(src);
      src.onended = (): void => { live.delete(src); try { g.disconnect(); } catch { /* gone */ } if (lastOne && !stopped && live.size === 0) o.onEnd(); };
      src.start(when);
      return src;
    };
    void load.then((buf) => {
      o.trace?.(`decoded ${url}: ${buf.duration.toFixed(2)} s, starting (ctx ${c.state})`);
      if (stopped) return;
      const xf = o.crossfadeMs / 1000, d = buf.duration;
      if (o.loop && xf > 0 && d > xf * 2.5) {
        // a crossfaded loop: the next copy starts xf before this one ends and fades in while this one fades out
        let when = c.currentTime + 0.02;
        const next = (first: boolean): void => {
          if (stopped) return;
          begin(buf, when, first ? 0 : xf, false);
          when = when + d - xf;
          timers.push(window.setTimeout(() => next(false), Math.max(20, (when - c.currentTime - 0.4) * 1000)));
        };
        next(true);
      } else if (o.loop) {
        begin(buf, c.currentTime + 0.02, 0, false).loop = true;
      } else {
        begin(buf, c.currentTime + 0.02, 0, true);
      }
    }).catch((e: unknown) => { o.trace?.(`FAILED ${url}: ${String(e)}`); if (!stopped) { o.onFail?.(String(e)); o.onEnd(); } });
    return {
      setGain: (g) => { gain.gain.setTargetAtTime(g, c.currentTime, 0.02); },
      fadeIn: (ms, to) => { gain.gain.cancelScheduledValues(c.currentTime); gain.gain.setValueAtTime(0, c.currentTime); gain.gain.linearRampToValueAtTime(to, c.currentTime + ms / 1000); },
      stop: (ms) => {
        stopped = true;
        timers.forEach((t) => window.clearTimeout(t));
        gain.gain.cancelScheduledValues(c.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, c.currentTime);
        gain.gain.linearRampToValueAtTime(0, c.currentTime + Math.max(0.005, ms / 1000));
        window.setTimeout(() => { for (const n of live) { try { n.stop(); } catch { /* already stopped */ } } gain.disconnect(); }, ms + 60);
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

let current: CmcpAudio | null = null;
/** the running sound engine (the Settings "Test sound" button uses it) */
export const setAudioEngine = (a: CmcpAudio | null): void => { current = a; };
export const getAudioEngine = (): CmcpAudio | null => current;
