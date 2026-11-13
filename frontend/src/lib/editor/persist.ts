import type { ViewMode } from './serialize';

/** What survives a restart for one world: open objects, the active attribute and unsaved drafts. */
export interface PersistedDraft {
  text: string;
  mode: ViewMode;
  /** the stored value the draft was based on (to notice changes made meanwhile) */
  original: string;
}

export interface PersistedObject {
  dbref: string;
  name?: string;
  activeAttr: string | null;
  drafts: Record<string, PersistedDraft>;
  /** per-attribute view mode (raw code or %r shown as line breaks) */
  modes: Record<string, ViewMode>;
}

export interface PersistedWorkspace {
  v: 1;
  active: string | null;
  objects: PersistedObject[];
}

export const persistKey = (worldKey: string): string => `squat.editor.v1.${worldKey}`;

const isMode = (m: unknown): m is ViewMode => m === 'code' || m === 'lines';

/** Parse and sanitise stored JSON; anything unexpected yields null (never throws). */
export function parsePersisted(json: string | null): PersistedWorkspace | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Partial<PersistedWorkspace> | null;
    if (!raw || raw.v !== 1 || !Array.isArray(raw.objects)) return null;
    const objects: PersistedObject[] = [];
    for (const o of raw.objects) {
      if (!o || typeof o.dbref !== 'string' || !/^#-?\d+$/.test(o.dbref)) continue;
      const drafts: Record<string, PersistedDraft> = {};
      for (const [k, d] of Object.entries(o.drafts ?? {})) {
        if (d && typeof d.text === 'string' && typeof d.original === 'string' && isMode(d.mode)) {
          drafts[k] = { text: d.text, original: d.original, mode: d.mode };
        }
      }
      const modes: Record<string, ViewMode> = {};
      for (const [k, m] of Object.entries(o.modes ?? {})) if (isMode(m)) modes[k] = m;
      objects.push({
        dbref: o.dbref,
        name: typeof o.name === 'string' ? o.name : undefined,
        activeAttr: typeof o.activeAttr === 'string' ? o.activeAttr : null,
        drafts,
        modes,
      });
    }
    return { v: 1, active: typeof raw.active === 'string' ? raw.active : null, objects };
  } catch {
    return null;
  }
}

export function loadPersisted(worldKey: string): PersistedWorkspace | null {
  try {
    return parsePersisted(localStorage.getItem(persistKey(worldKey)));
  } catch {
    return null;
  }
}

export function savePersisted(worldKey: string, ws: PersistedWorkspace | null): void {
  try {
    if (ws && ws.objects.length > 0) localStorage.setItem(persistKey(worldKey), JSON.stringify(ws));
    else localStorage.removeItem(persistKey(worldKey));
  } catch {
    /* storage may be unavailable (private window, quota): the workspace still works */
  }
}
