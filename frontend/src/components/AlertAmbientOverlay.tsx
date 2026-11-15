import { useSessions } from '../state/stores';
import { useAmbient, usePane } from '../cmcp/pane';

/** The ship-wide alert look for the plain text UI (spec 6.17.1): while the foreground session is on a red or yellow alert and no console
 * screen is up (a room, the dock, away), a coloured edge and a soft inner glow frame the window. It never covers the text or the input line
 * (pointer-events none, nothing but an inset shadow). With a console screen up the scene draws the ambience itself. */
export function AlertAmbientOverlay() {
  const fg = useSessions((s) => s.fg);
  const amb = useAmbient((s) => (fg ? s.by[fg] : undefined));
  const sceneUp = usePane((s) => (fg ? !!s.by[fg]?.has && !s.by[fg]?.off : false));
  if (!fg || !amb || sceneUp) return null;
  return (
    <div
      className="alert-ambient"
      aria-hidden="true"
      data-testid="alert-ambient"
      style={{ boxShadow: `inset 0 0 0 4px ${amb.edge}, inset 0 0 36px 6px ${amb.hueBg ?? amb.edge}55` }}
    />
  );
}
