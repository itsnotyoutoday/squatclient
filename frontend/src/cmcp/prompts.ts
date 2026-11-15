import { create } from 'zustand';
import type { CmcpNote } from './types';

/** A question the game's interface pack raises on first use (cmcp spec 8.8). Only packs that passed every check get here. */
export interface PackPrompt { session: string; id: string; version: string; sha256: string; host: string; trust: string; signed: boolean }

interface PromptState {
  prompts: PackPrompt[];
  add(p: PackPrompt): void;
  remove(session: string, id: string): void;
}

export const usePackPrompts = create<PromptState>((set) => ({
  prompts: [],
  add: (p) => set((s) => (s.prompts.some((x) => x.session === p.session && x.id === p.id) ? s : { prompts: [...s.prompts, p] })),
  remove: (session, id) => set((s) => ({ prompts: s.prompts.filter((x) => !(x.session === session && x.id === id)) })),
}));

/** Feeds the prompt store from the engine's notes. */
export function collectPrompts(session: string, notes: CmcpNote[]): void {
  for (const n of notes) {
    if (n.kind !== 'pack-consent') continue;
    const pk = n.pack;
    if (!pk) continue;
    const trust = String(n.params?.trust ?? 'unsigned');
    usePackPrompts.getState().add({ session, id: pk.id, version: pk.version, sha256: pk.sha256, host: n.text ?? '', trust, signed: trust !== 'unsigned' });
  }
}
