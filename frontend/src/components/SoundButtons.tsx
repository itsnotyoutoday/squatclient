import { diagLog } from '../lib/diaglog';
import { useEffect } from 'react';
import { useSessions, useSettings, useUi } from '../state/stores';
import { setWorldMuted, useSoundMute } from '../state/soundMute';

/** Global mute shortcut (Alt+M is the CMCP screen menu). */
export const MUTE_KEY_LABEL = 'Alt+Shift+M';

const Speaker = ({ muted, slash }: { muted: boolean; slash?: boolean }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" fill="currentColor">
    <path d="M2 6h3l4-3v10l-4-3H2z" />
    {muted ? (
      <path d="M11 5.5l4 5m0-5l-4 5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    ) : (
      <path d="M11 5.5a3.5 3.5 0 010 5M12.8 3.8a6 6 0 010 8.4" stroke="currentColor" strokeWidth="1.3" fill="none" />
    )}
    {slash && <path d="M2 14L14 2" stroke="currentColor" strokeWidth="1.5" />}
  </svg>
);

/** Keeps the per-session mute state in step with the engine (events, the session list and the global setting). */
function useMuteSync(): void {
  const engine = useUi((s) => s.engine);
  const ids = useSessions((s) => Object.keys(s.sessions).join(','));
  const globalMuted = useSettings((s) => s.settings.soundMuted);
  useEffect(() => engine?.on('sound-mute', (p) => useSoundMute.getState().set(p.session, p.muted)), [engine]);
  useEffect(() => {
    if (!engine) return;
    for (const id of ids.split(',').filter(Boolean)) void engine.soundMuteState(id).then((m) => useSoundMute.getState().set(id, m)).catch(() => undefined);
  }, [engine, ids, globalMuted]);
}

/** The speaker button of the top-right toolbar: mutes all sound (the soundMuted setting). Alt+Shift+M does the same. */
export function GlobalMuteButton() {
  const muted = useSettings((s) => s.settings.soundMuted);
  const engine = useUi((s) => s.engine);
  useMuteSync();
  const toggle = (): void => {
    const next = { ...useSettings.getState().settings, soundMuted: !useSettings.getState().settings.soundMuted };
    diagLog('ui', `global mute click: before=${useSettings.getState().settings.soundMuted} after=${next.soundMuted}`);
    useSettings.getState().set(next);
    void engine?.saveSettings(next).catch((e: unknown) => useUi.getState().toast('error', String(e instanceof Error ? e.message : e)));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyM') { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <button
      type="button"
      className={`tabadd soundbtn${muted ? ' muted' : ''}`}
      aria-label={muted ? 'Unmute all sound' : 'Mute all sound'}
      aria-pressed={muted}
      title={`${muted ? 'Sound is off: click to unmute' : 'Mute all sound'} (${MUTE_KEY_LABEL})`}
      onClick={toggle}
    >
      <Speaker muted={muted} />
    </button>
  );
}

/** The speaker button next to "Connected": mutes only this world (saved with the world); dim and slashed when the global mute is on. */
export function WorldMuteButton({ session }: { session: string }) {
  const engine = useUi((s) => s.engine);
  const state = useSoundMute((s) => s.by[session] ?? '');
  const globalMuted = useSettings((s) => s.settings.soundMuted);
  const worldMuted = state === 'world';
  const label = globalMuted ? 'Sound is muted by the global mute' : worldMuted ? 'Unmute sound for this world' : 'Mute sound for this world';
  return (
    <button
      type="button"
      className={`seg soundbtn world${worldMuted ? ' muted' : ''}${globalMuted ? ' globalmuted' : ''}`}
      aria-label={label}
      aria-pressed={worldMuted}
      title={globalMuted ? `${label} (${MUTE_KEY_LABEL} to unmute)` : label}
      onClick={() => void setWorldMuted(engine, session, !worldMuted, (m) => useUi.getState().toast('error', m))}
    >
      <Speaker muted={worldMuted || globalMuted} slash={globalMuted && !worldMuted} />
    </button>
  );
}
