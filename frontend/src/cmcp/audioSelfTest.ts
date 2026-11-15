import type { EngineAPI } from '../api/types';
import { useAudioStats } from './audio';
import { useSoundMute } from '../state/soundMute';
import { useSettings } from '../state/stores';

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

/** The live self-test: connect to a game, run its commands, and log what the sound engine did (SQUATCLIENT_AUDIO_SELFTEST_LIVE="host:port|cmd|cmd..."). */
export async function runLiveSelfTest(engine: EngineAPI, script: string): Promise<void> {
  const log = (l: string): void => { void engine.clientLog(`selftest-live: ${l}`).catch(() => undefined); };
  const [addr, ...cmds] = script.split('|');
  const [host, port] = addr.split(':');
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  try {
    const si = await engine.connect({ host, port: Number(port), tls: false });
    log(`connected session ${si.id}`);
    await sleep(2500);
    for (const c of cmds) {
      await engine.input(si.id, c);
      log(`sent "${c}"`);
      await sleep(2000);
    }
    for (let i = 0; i < 6; i++) {
      await sleep(2500);
      const st = useAudioStats.getState();
      log(`sound stats: played=${st.played} failed=${st.failed} dropped=${st.dropped} last="${st.last}" lastError="${st.lastError}" lastDrop="${st.lastDrop}" ctx=${st.ctx} muteState="${useSoundMute.getState().by[si.id] ?? ''}" settings.muted=${useSettings.getState().settings.soundMuted} volume=${useSettings.getState().settings.soundVolume} folder=${useSettings.getState().settings.soundFolder}`);
    }
  } catch (e) {
    log(`failed: ${String(e)}`);
  }
}
