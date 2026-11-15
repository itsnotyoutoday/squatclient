import { diagLog } from '../lib/diaglog';
import { create } from 'zustand';
import type { EngineAPI } from '../api/types';

/** What mutes a session's sound, as the Go side reports it (the effective mute = the global setting OR the world's): "global", "world" or "" (audible). */
export type MuteState = '' | 'global' | 'world';
interface MuteStore { by: Record<string, MuteState>; set(session: string, s: MuteState): void; setAll(s: MuteState): void }
export const useSoundMute = create<MuteStore>((set) => ({
  by: {},
  set: (session, s) => set((st) => (st.by[session] === s ? st : { by: { ...st.by, [session]: s } })),
  setAll: (s) => set((st) => ({ by: Object.fromEntries(Object.keys(st.by).map((k) => [k, s])) })),
}));

/** the mute of a session, "" when unknown */
export const muteOf = (session: string | null | undefined): MuteState => (session ? useSoundMute.getState().by[session] ?? '' : '');

/** Mutes or unmutes the sound of one session's world (saved on the world; a quick connect for this connection) and returns once the engine confirms. */
export async function setWorldMuted(engine: EngineAPI | null, session: string, muted: boolean, onError: (e: string) => void): Promise<void> {
  if (!engine) return;
  try {
    const before = muteOf(session) || 'audible';
    await engine.setWorldSoundMuted(session, muted);
    useSoundMute.getState().set(session, await engine.soundMuteState(session));
    diagLog('ui', `world mute click: want ${muted ? 'muted' : 'audible'}, before=${before} after=${muteOf(session) || 'audible'}`, session);
  } catch (e) {
    diagLog('error', `world mute click failed: ${String(e)}`, session);
    onError(String(e instanceof Error ? e.message : e));
  }
}
