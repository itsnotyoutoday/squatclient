import { pushHistory } from '../lib/keymap';

const store = new Map<string, string[]>();

export const getHistory = (sessionId: string): string[] => store.get(sessionId) ?? [];
export function addHistory(sessionId: string, text: string): string[] {
  const next = pushHistory(getHistory(sessionId), text);
  store.set(sessionId, next);
  return next;
}
export const clearHistories = (): void => store.clear();
