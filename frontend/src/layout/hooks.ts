import { useMemo } from 'react';
import type { SessionInfo } from '../api/types';
import { useSessions, useUi } from '../state/stores';
import { useLayoutEnv } from './context';
import { getIn, parseBinding, resolveGmcp } from './paths';
import { useLayoutData } from './store';
import type { ChatMessage, ItemRec } from './store';

/**
 * Hooks for layouts. Call them at the top of a component, never conditionally. Each one subscribes to
 * exactly the value it returns, so a component only redraws when that value changes.
 */

/** The value of a GMCP path such as `Char.Vitals.hp` (undefined until the game sends it). */
export function useGmcp(path: string): unknown {
  const { sessionId } = useLayoutEnv();
  return useLayoutData((s) => resolveGmcp(s.sessions[sessionId]?.gmcp, path));
}

/** An MSDP variable (`HEALTH`, or a path into a table: `ROOM.NAME`). */
export function useMsdp(path: string): unknown {
  const { sessionId } = useLayoutEnv();
  return useLayoutData((s) => {
    const segs = path.split('.');
    const m = s.sessions[sessionId]?.msdp;
    return m ? getIn(m[segs[0]], segs.slice(1)) : undefined;
  });
}

/** A script variable: Lua's squat.var (shared with every layout), else one this world's layout set. */
export function useVar(name: string): unknown {
  const { scope } = useLayoutEnv();
  return useLayoutData((s) => {
    const segs = name.split('.');
    return getIn(segs[0] in s.lua ? s.lua[segs[0]] : s.vars[scope]?.[segs[0]], segs.slice(1));
  });
}

/** Set a script variable. It is Lua's too: `squat.var.get(name)` sees it, and Lua's changes come back. */
export function useSetVar(): (name: string, value: unknown) => void {
  const engine = useUi((s) => s.engine);
  return (name, value) => {
    useLayoutData.getState().setLua({ [name]: value });
    void engine?.setLuaVar(name, value ?? null).catch(() => undefined);
  };
}

/** Resolve a binding string (`gmcp:Char.Vitals.hp`, `msdp:HEALTH`, `var:hp`) or pass a literal through. */
export function useBinding(spec: unknown): unknown {
  const { sessionId, scope } = useLayoutEnv();
  const b = useMemo(() => parseBinding(spec), [spec]);
  return useLayoutData((s) => {
    switch (b.kind) {
      case 'literal':
        return b.value;
      case 'gmcp':
        return resolveGmcp(s.sessions[sessionId]?.gmcp, b.path);
      case 'msdp': {
        const segs = b.path.split('.');
        const m = s.sessions[sessionId]?.msdp;
        return m ? getIn(m[segs[0]], segs.slice(1)) : undefined;
      }
      case 'var': {
        const segs = b.path.split('.');
        return getIn(segs[0] in s.lua ? s.lua[segs[0]] : s.vars[scope]?.[segs[0]], segs.slice(1));
      }
    }
  });
}

/** Chat messages from Comm.Channel.* (all channels, or one). */
export function useChat(channel?: string): ChatMessage[] {
  const { sessionId } = useLayoutEnv();
  const all = useLayoutData((s) => s.sessions[sessionId]?.chat);
  return useMemo(() => (all ?? []).filter((m) => !channel || m.channel === channel), [all, channel]);
}

/** The items of a location from Char.Items.* ("inv", "room", "rep123"). */
export function useItems(location = 'inv'): ItemRec[] {
  const { sessionId } = useLayoutEnv();
  const items = useLayoutData((s) => s.sessions[sessionId]?.items[location]);
  return items ?? NONE;
}
const NONE: ItemRec[] = [];

/** Send a line to the game. */
export function useSend(): (text: string) => void {
  return useLayoutEnv().send;
}

/** The session this layout is drawn for (undefined if it was removed). */
export function useSession(): SessionInfo | undefined {
  const { sessionId } = useLayoutEnv();
  return useSessions((s) => s.sessions[sessionId]);
}

/** Short names for use in layout code: `gmcp('Char.Vitals.hp')` (a hook: call at the top of a component). */
export const gmcp = useGmcp;
export const msdp = useMsdp;
