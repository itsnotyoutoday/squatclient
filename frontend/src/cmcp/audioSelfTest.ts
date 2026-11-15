import type { EngineAPI } from '../api/types';
import { useAudioStats } from './audio';
import { useSoundMute } from '../state/soundMute';
import { useSessions, useSettings } from '../state/stores';

/** Developer self-test of the sound path inside the REAL web view (SQUATCLIENT_AUDIO_SELFTEST_DIR=<folder with wav/ogg samples> on a run of the app):
 * the audio context, which formats the view can decode, and for each file fetch + decodeAudioData through the app's own audio handler. Every line
 * goes to client.log in the config folder, because a WKWebView has no inspector in a release build. */
export async function runAudioSelfTest(engine: EngineAPI, files: string[]): Promise<void> {
  const log = (l: string): void => { void engine.clientLog(`selftest: ${l}`).catch(() => undefined); };
  log(`start ua=${navigator.userAgent}`);
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    log(`AudioContext state=${ctx.state} rate=${ctx.sampleRate}`);
    try { await ctx.resume(); log(`after resume() state=${ctx.state}`); } catch (e) { log(`resume() threw ${String(e)}`); }
  } catch (e) {
    log(`new AudioContext() threw ${String(e)}`);
  }
  try {
    const a = new Audio();
    log(`canPlayType ogg-vorbis="${a.canPlayType('audio/ogg; codecs="vorbis"')}" mp3="${a.canPlayType('audio/mpeg')}" wav="${a.canPlayType('audio/wav')}"`);
  } catch (e) { log(`canPlayType threw ${String(e)}`); }
  for (const f of files) {
    const url = f.startsWith('/') ? f : `/cmcp-audio/selftest/${f}`;
    try {
      const r = await fetch(url);
      const ct = r.headers.get('content-type');
      const buf = await r.arrayBuffer();
      log(`fetch ${url} -> ${r.status} ${ct} ${buf.byteLength} bytes`);
      if (!ctx) continue;
      try {
        const d = await ctx.decodeAudioData(buf.slice(0));
        log(`decode ${url} ok: ${d.duration.toFixed(2)} s ${d.numberOfChannels} ch ${d.sampleRate} Hz`);
      } catch (e) {
        log(`decode ${url} FAILED: ${(e as Error)?.name ?? ''} ${(e as Error)?.message ?? String(e)}`);
      }
    } catch (e) {
      log(`fetch ${url} FAILED: ${String(e)}`);
    }
  }
  if (ctx) log(`end state=${ctx.state}`);
  const onGesture = (): void => {
    void ctx?.resume().then(() => log(`after a user gesture: state=${ctx?.state}`)).catch((e: unknown) => log(`resume after gesture threw ${String(e)}`));
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
  };
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
}

/** The live self-test: connect to a game, run its commands, and log what the sound engine did (SQUATCLIENT_AUDIO_SELFTEST_LIVE="host:port|cmd|cmd...").
 * Steps beginning with "!" drive the real UI: `!open host:port` (another session, in front), `!fg N` (the N-th session's tab), `!mute` / `!unmute` (the world
 * speaker button of the status bar), `!global` (the toolbar speaker), `!wait N` (seconds), `!stats` (log the sound state of every session). */
export async function runLiveSelfTest(engine: EngineAPI, script: string): Promise<void> {
  const log = (l: string): void => { void engine.clientLog(`selftest-live: ${l}`).catch(() => undefined); };
  const [addr, ...cmds] = script.split('|');
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const sessions: string[] = [];
  const click = (label: string): boolean => {
    const b = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    b?.click();
    return !!b;
  };
  const stats = (tag: string): void => {
    const st = useAudioStats.getState();
    const fg = useSessions.getState().fg;
    const mutes = sessions.map((id) => `${id}=${useSoundMute.getState().by[id] || 'audible'}`).join(' ');
    log(`${tag}: played=${st.played} failed=${st.failed} dropped=${st.dropped} last="${st.last}" lastDrop="${st.lastDrop}" ctx=${st.ctx} fg=${fg} mute[${mutes}] global=${useSettings.getState().settings.soundMuted}`);
  };
  const open = async (a: string): Promise<string> => {
    // "world:Name@host:port" saves a world first and connects through it (a saved world has an id: the mute is stored on it)
    const m = /^world:([^@]+)@(.+)$/.exec(a);
    const [host, port] = (m ? m[2] : a).split(':');
    let target: { host: string; port: number; tls: boolean; worldId?: string } = { host, port: Number(port), tls: false };
    if (m) {
      const w = await engine.saveWorld({ id: '', name: m[1], host, port: Number(port), tls: false, tlsVerify: 'strict', encoding: 'utf-8', via: 'direct' } as never);
      target = { ...target, worldId: w.id };
    }
    const si = await engine.connect(target as never);
    sessions.push(si.id);
    useSessions.getState().setFg(si.id);
    log(`opened session ${si.id} (${a})`);
    return si.id;
  };
  try {
    await open(addr);
    await sleep(2500);
    for (const c of cmds) {
      if (c.startsWith('!open ')) { await open(c.slice(6)); await sleep(2500); continue; }
      if (c.startsWith('!fg ')) { const id = sessions[Number(c.slice(4))]; useSessions.getState().setFg(id); log(`!fg ${id}`); await sleep(800); stats('after fg'); continue; }
      if (c === '!mute' || c === '!unmute') { log(`${c}: button ${click(c === '!mute' ? 'Mute sound for this world' : 'Unmute sound for this world') ? 'clicked' : 'NOT FOUND'}`); await sleep(1200); stats(`after ${c}`); continue; }
      if (c === '!global') { log(`!global: button ${click('Mute all sound') || click('Unmute all sound') ? 'clicked' : 'NOT FOUND'}`); await sleep(1200); stats('after global'); continue; }
      if (c.startsWith('!wait ')) { await sleep(Number(c.slice(6)) * 1000); stats('wait'); continue; }
      if (c === '!stats') { stats('stats'); continue; }
      const id = useSessions.getState().fg ?? sessions[0];
      await engine.input(id, c);
      log(`sent to ${id}: "${c}"`);
      await sleep(2000);
    }
    stats('end');
  } catch (e) {
    log(`failed: ${String(e)}`);
  }
}
