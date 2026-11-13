/** Window events between the global shortcuts / history browser and the input line. */
export const TOGGLE_EDITOR_EVENT = 'squat:toggle-editor';
export const HISTORY_USE_EVENT = 'squat:history-use';

export interface HistoryUseDetail {
  sessionId: string;
  text: string;
  /** false: load into the input; true: send now */
  send: boolean;
  handled: boolean;
}

export const toggleEditor = (): void => void window.dispatchEvent(new Event(TOGGLE_EDITOR_EVENT));

/** Ask the input line to load (or send) a history entry. False when no input line took it. */
export function requestHistoryEntry(sessionId: string, text: string, send: boolean): boolean {
  const detail: HistoryUseDetail = { sessionId, text, send, handled: false };
  window.dispatchEvent(new CustomEvent<HistoryUseDetail>(HISTORY_USE_EVENT, { detail }));
  return detail.handled;
}
