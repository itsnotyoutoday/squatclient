import { useUi } from '../state/stores';
import { useHelp } from './store';

/**
 * `/help` is a UI feature: it is recognised here, before text reaches the engine.
 * Returns the argument text ("" for a bare `/help`) or null when the line is not a help command.
 */
export function parseHelpCommand(line: string): string | null {
  const m = /^\s*\/help(?:\s+([\s\S]*?))?\s*$/i.exec(line);
  return m ? (m[1] ?? '').trim() : null;
}

/** Open the help browser; `query` is what followed `/help` (empty opens the home page). */
export function openHelp(query = ''): void {
  useHelp.getState().request(query);
  useUi.getState().openDialog('help');
}

export const INSERT_EVENT = 'squat:input-insert';
export interface InsertDetail {
  text: string;
  handled: boolean;
}

/** Ask the current session's input line to insert text at its cursor (never sends). False if none accepted it. */
export function insertIntoInput(text: string): boolean {
  const detail: InsertDetail = { text, handled: false };
  window.dispatchEvent(new CustomEvent<InsertDetail>(INSERT_EVENT, { detail }));
  return detail.handled;
}
