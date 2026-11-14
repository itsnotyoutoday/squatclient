import { createContext, useContext } from 'react';

/** What every layout component can reach: the session it draws for and a few actions. */
export interface LayoutEnv {
  sessionId: string;
  /** Where script variables live: the world id, or the session id for a quick connect. */
  scope: string;
  /** Send a line to the game, through the normal input pipeline (Lua aliases and input handlers see it). */
  send(text: string): void;
  /** Mush and InputBar tell the host they are present (the host requires exactly one of each). */
  register(kind: 'mush' | 'input'): () => void;
}

export const LayoutContext = createContext<LayoutEnv | null>(null);

export function useLayoutEnv(): LayoutEnv {
  const e = useContext(LayoutContext);
  if (!e) throw new Error('layout components can only be used inside a layout');
  return e;
}
