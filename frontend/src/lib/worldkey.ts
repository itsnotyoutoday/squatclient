import type { SessionInfo } from '../api/types';

/** Same key the app uses for the history file: the world id when known, else host:port. */
export const worldKey = (s: Pick<SessionInfo, 'worldId' | 'host' | 'port'>): string =>
  s.worldId ? `w-${s.worldId}` : `h-${s.host.toLowerCase()}:${s.port}`;
