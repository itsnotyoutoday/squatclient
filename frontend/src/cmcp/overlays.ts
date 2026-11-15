import { create } from 'zustand';

/** A real DOM input the scene cannot draw (the gfx scene has no text entry): placed over the scene at scene-unit coordinates.
 * It can never sit over the game text (the scene's text port is clipped out of the scene box and the controller never places an
 * overlay inside it) and the app's input bar is outside the scene box altogether. */
export interface Overlay {
  id: string;
  x: number; y: number; w: number; h: number; // scene units
  label: string;
  value: string;
  kind: 'int' | 'number';
  min: number; max: number;
  /** what Enter sends: the widget path, the event, and how to build $value from the typed number */
  path: string;
  event: string;
  build: (n: number) => unknown;
}
interface OverlayState {
  by: Record<string, { w: number; h: number; items: Overlay[] }>;
  set(session: string, w: number, h: number, items: Overlay[]): void;
  clear(session: string): void;
}
export const useOverlays = create<OverlayState>((set) => ({
  by: {},
  set: (session, w, h, items) => set((s) => ({ by: { ...s.by, [session]: { w, h, items } } })),
  clear: (session) => set((s) => { const by = { ...s.by }; delete by[session]; return { by }; }),
}));
