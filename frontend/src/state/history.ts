import type { EngineAPI } from '../api/types';
import { pushHistory } from '../lib/keymap';

/**
 * Recall list of the input line (oldest first), per session. It is SEEDED from the persistent,
 * per-world history kept by the app (engine.history) and extended locally on every send.
 */
const store = new Map<string, string[]>();
const adds = new Map<string, string[]>(); // everything added locally, to merge into a seed that was in flight
const pending = new Map<string, Promise<unknown>>();
const SEED = 1000;

export const getHistory = (sessionId: string): string[] => store.get(sessionId) ?? [];

/** Local-only add (no persistence): used by tests and by recordHistory. */
export function addHistory(sessionId: string, text: string): string[] {
  const next = pushHistory(getHistory(sessionId), text);
  store.set(sessionId, next);
  const a = adds.get(sessionId) ?? [];
  a.push(text);
  adds.set(sessionId, a);
  return next;
}

/** Remember an input line or block (ONE entry) locally and persistently. Never call for passwords. */
export function recordHistory(engine: EngineAPI | null, sessionId: string, text: string): void {
  if (!text.trim()) return;
  addHistory(sessionId, text);
  if (!engine) return;
  const p = engine.recordHistory(sessionId, text).catch(() => undefined);
  pending.set(sessionId, Promise.all([pending.get(sessionId), p]));
}

/** (Re)load the recall list from the persistent history of the session's world. */
export async function seedHistory(engine: EngineAPI, sessionId: string): Promise<void> {
  await pending.get(sessionId);
  const mark = adds.get(sessionId)?.length ?? 0;
  let page;
  try {
    page = await engine.history(sessionId, '', { limit: SEED });
  } catch {
    return; // keep what we have
  }
  let list: string[] = [];
  for (const e of [...page.entries].reverse()) list = pushHistory(list, e.text);
  for (const t of (adds.get(sessionId) ?? []).slice(mark)) list = pushHistory(list, t);
  store.set(sessionId, list);
}

export function clearHistories(): void {
  store.clear();
  adds.clear();
  pending.clear();
}
