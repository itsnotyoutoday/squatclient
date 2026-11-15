import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useSessions, useSettings, useUi, setBufferCap } from '../../state/stores';
import { seedHistory } from '../../state/history';
import type { ScriptFolders, Settings } from '../../api/types';
import { DEFAULT_FONT } from '../../api/types';
import { allThemes, parseThemeJson, useThemeVersion } from '../../themes';
import { Dialog, Field } from './Dialog';
import { useThemeInUse } from '../../cmcp/pane';
import { getAudioEngine, useAudioStats } from '../../cmcp/audio';

/** Which console theme is drawn now and where it came from: built in, downloaded from the game, or plain. */
function ThemeInUse() {
  const t = useThemeInUse();
  if (!t.theme) return null;
  const from = t.source === 'pack' ? `downloaded from the game${t.version ? `, version ${t.version}` : ''}` : t.source === 'builtin' ? 'built in' : 'plain (no theme available)';
  return <p className="hint">Theme in use: {t.theme} ({from})</p>;
}

/** "Sound: N played, last: event [source: file]", the audio context and the last problem, with a Test sound button. */
function SoundDiagnostics() {
  const st = useAudioStats();
  const [res, setRes] = useState('');
  return (
    <div className="hint" aria-label="Sound diagnostics">
      <button type="button" onClick={() => setRes(getAudioEngine()?.test() ?? 'no sound engine (open a console first)')}>Test sound</button>
      {res && <span> {res === 'running' ? 'audio is running: you should hear a two-tone chirp' : `audio: ${res}`}</span>}
      <p>
        Sound: {st.played} played{st.last ? `, last: ${st.last}` : ''} (audio {st.ctx}){st.failed ? `; ${st.failed} failed, last: ${st.lastError}` : ''}
        {st.dropped ? `; ${st.dropped} not played, last: ${st.lastDrop}` : ''}
      </p>
    </div>
  );
}

export function SettingsDialog() {
  const engine = useUi((s) => s.engine);
  const settings = useSettings((s) => s.settings);
  const [err, setErr] = useState('');
  useThemeVersion((s) => s.version); // re-render when the themes folder changes
  const [themesDir, setThemesDir] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const fg = useSessions((s) => s.fg);
  const [stored, setStored] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [folders, setFolders] = useState<ScriptFolders | null>(null);

  useEffect(() => {
    void engine
      ?.scriptFolders()
      .then(setFolders)
      .catch(() => undefined);
  }, [engine]);

  useEffect(() => {
    void engine
      ?.themesDir()
      .then(setThemesDir)
      .catch(() => undefined);
  }, [engine]);

  // how many commands the foreground world has stored (refreshed when the size setting changes)
  useEffect(() => {
    if (!engine || !fg) {
      setStored(null);
      return;
    }
    let live = true;
    void engine
      .history(fg, '', { limit: 1 })
      .then((p) => live && setStored(p.total))
      .catch(() => live && setStored(null));
    return () => {
      live = false;
    };
  }, [engine, fg, settings.historyMax]);

  const clearHistory = (): void => {
    if (!engine || !fg) return;
    void engine
      .clearHistory(fg)
      .then(() => {
        setStored(0);
        setConfirmClear(false);
        void seedHistory(engine, fg);
      })
      .catch((e: unknown) => setErr(String(e)));
  };

  // Settings apply live (instant theme/font switching) and persist through the engine.
  const openFolder = (path: string): void => {
    void engine?.openFolder(path).catch((e: unknown) => setErr(String(e)));
  };
  const browse = (): void => {
    void engine
      ?.pickFolder('Choose the scripts folder', settings.scriptsDir ?? '')
      .then((p) => p && update({ scriptsDir: p }))
      .catch((e: unknown) => setErr(String(e)));
  };

  const update = (patch: Partial<Settings>): void => {
    const next = { ...useSettings.getState().settings, ...patch };
    useSettings.getState().set(next);
    if (patch.scrollbackLines) setBufferCap(patch.scrollbackLines);
    void engine?.saveSettings(next).catch((e: unknown) => setErr(String(e)));
  };

  const num =
    (
      k: 'fontSize' | 'scrollbackLines' | 'minContrast' | 'sendLineDelayMs' | 'historyMax',
      min: number,
      max: number,
    ) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      if (Number.isFinite(v)) update({ [k]: Math.min(max, Math.max(min, v)) });
    };

  const importTheme = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const t = parseThemeJson(await f.text());
      if (!engine) throw new Error('not connected to the engine');
      await engine.saveTheme(t.id, JSON.stringify(JSON.parse(await f.text()), null, 2));
      update({ theme: t.id });
      setErr('');
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    }
    e.target.value = '';
  };

  const check = (k: keyof Settings, label: string, hint?: string) => (
    <label className="check" key={k}>
      <input
        type="checkbox"
        checked={Boolean(settings[k])}
        onChange={(e) => update({ [k]: e.target.checked } as Partial<Settings>)}
      />{' '}
      {label}
      {hint && <span className="hint"> {hint}</span>}
    </label>
  );

  return (
    <Dialog title="Settings" onClose={() => useUi.getState().openDialog(null)} wide>
      <div className="form grid">
        <Field label="Theme">
          <select value={settings.theme} onChange={(e) => update({ theme: e.target.value })}>
            {allThemes().map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Themes folder"
          hint="Put a theme here as name.json (or name/theme.json); it appears in the list at once"
        >
          <code>{themesDir}</code>
        </Field>
        <Field label="Add a theme file">
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            onChange={(e) => void importTheme(e)}
          />
        </Field>
        <Field label="Font family">
          <input
            value={settings.fontFamily}
            onChange={(e) => update({ fontFamily: e.target.value || DEFAULT_FONT })}
          />
        </Field>
        <Field label="Font size (px)">
          <input type="number" min={8} max={40} value={settings.fontSize} onChange={num('fontSize', 8, 40)} />
        </Field>
        <Field label="Scrollback lines in memory" hint="Older history is fetched on demand">
          <input
            type="number"
            min={1000}
            max={1000000}
            step={1000}
            value={settings.scrollbackLines}
            onChange={num('scrollbackLines', 1000, 1_000_000)}
          />
        </Field>
        <Field label="Minimum contrast (0 = off, 4.5 = WCAG AA)">
          <input
            type="number"
            min={0}
            max={21}
            step={0.5}
            value={settings.minContrast}
            onChange={num('minContrast', 0, 21)}
          />
        </Field>
        <Field label="Default encoding">
          <select
            value={settings.defaultEncoding}
            onChange={(e) => update({ defaultEncoding: e.target.value as Settings['defaultEncoding'] })}
          >
            <option value="utf-8">UTF-8</option>
            <option value="latin1">Latin-1</option>
          </select>
        </Field>
        <Field
          label="Command history size (entries per world)"
          hint="Stored on disk for each world and shared by all its sessions. Older entries are dropped first; lowering this trims on the next write and at startup."
        >
          <input
            type="number"
            min={100}
            max={1000000}
            step={1000}
            value={settings.historyMax}
            onChange={num('historyMax', 100, 1_000_000)}
          />
        </Field>
        <div className="field">
          <span className="lbl">History of the current world</span>
          {fg === null || stored === null ? (
            <span className="hint">Open a session to see its stored entries.</span>
          ) : confirmClear ? (
            <span role="alert">
              Delete all {stored} stored commands?{' '}
              <button type="button" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>{' '}
              <button type="button" className="danger" onClick={clearHistory}>
                Clear history
              </button>
            </span>
          ) : (
            <span>
              {stored} stored{' '}
              <button type="button" onClick={() => setConfirmClear(true)} disabled={stored === 0}>
                Clear history
              </button>
            </span>
          )}
        </div>
        <Field
          label="Scripts folder"
          hint="Where a relative /load, /require, /log and /save start. Empty = the app-data folder. Takes effect the next time SquatClient starts."
        >
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              value={settings.scriptsDir ?? ''}
              placeholder={folders?.appData ?? ''}
              spellCheck={false}
              onChange={(e) => update({ scriptsDir: e.target.value })}
            />
            <button type="button" onClick={browse}>
              Browse...
            </button>
            <button type="button" onClick={() => openFolder(settings.scriptsDir || folders?.scripts || '')}>
              Open
            </button>
          </span>
        </Field>
        <Field
          label="Extra library folders (one per line)"
          hint="Searched by /load and /require after the built-in library (lib/squat, then the classic TinyFugue library in lib/tf). Absolute paths, or ~/... for your home folder. Takes effect the next time SquatClient starts."
        >
          <textarea
            rows={3}
            spellCheck={false}
            value={(settings.libDirs ?? []).join('\n')}
            onChange={(e) => update({ libDirs: e.target.value.split('\n') })}
          />
        </Field>
        <h3 className="group">Game consoles (CMCP) and sound</h3>
        {check('cmcp', 'Let games draw their consoles from protocol data', '(advertised when you connect; off = text only. Takes effect on the next connection.)')}
        <Field label="Console theme" hint="Follow the ship (default): a Klingon ship looks Klingon, a Romulan one Romulan. Fixed: always the theme chosen here.">
          <select aria-label="Console theme" value={settings.consoleThemeMode === 'fixed' ? settings.consoleTheme : 'ship'} onChange={(e) => (e.target.value === 'ship' ? update({ consoleThemeMode: 'ship' }) : update({ consoleThemeMode: 'fixed', consoleTheme: e.target.value }))}>
            <option value="ship">follow the ship (default)</option>
            {['tng', 'soft', 'klingon', 'romulan', 'tos', 'ferengi', 'ops'].map((t) => (
              <option key={t} value={t}>
                fixed: {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Accept interface packs from games" hint="Always (default): packs and themes the game announces load by themselves after every check (hash, size, origin, schema). Ask: a dialog the first time. Never: only the built-in screens and themes.">
          <select aria-label="Accept interface packs" value={settings.cmcpPackConsent || 'always'} onChange={(e) => update({ cmcpPackConsent: e.target.value as 'always' | 'ask' | 'never' })}>
            <option value="always">Always (default)</option>
            <option value="ask">Ask</option>
            <option value="never">Never</option>
          </select>
        </Field>
        <Field label="Alert recolour" hint="What turns red on a red alert. Theme (default): the theme decides (green-identity themes only change their edge and pill). Full: the whole console. Edge: frame edge and alert pill only. Off: no recolour (the pill and strip still say ALERT RED).">
          <select aria-label="Alert recolour" value={settings.cmcpAlertRecolour || 'theme'} onChange={(e) => update({ cmcpAlertRecolour: e.target.value as 'theme' | 'full' | 'edge' | 'off' })}>
            <option value="theme">Theme decides (default)</option>
            <option value="full">Full</option>
            <option value="edge">Edge only</option>
            <option value="off">Off</option>
          </select>
        </Field>
        <Field label="Red alert pulse" hint="Whether a red alert pulses the alert pill, the edge and the red roles. Theme (default): the theme decides (every theme pulses by default). Calm mode slows it, reduced motion keeps it steady.">
          <select aria-label="Red alert pulse" value={settings.cmcpAlertPulse || 'theme'} onChange={(e) => update({ cmcpAlertPulse: e.target.value as 'theme' | 'on' | 'off' })}>
            <option value="theme">Theme decides (default)</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </Field>
        <ThemeInUse />
        <SoundDiagnostics />
        <Field label="Sound era" hint="Which set of sounds to use for your own recordings. Empty = what the game or the ship's theme suggests.">
          <select aria-label="Sound era" value={settings.soundEra} onChange={(e) => update({ soundEra: e.target.value })}>
            {['', 'tos', 'tng', 'ds9', 'voy', 'klingon', 'romulan', 'ferengi', 'any'].map((t) => (
              <option key={t} value={t}>
                {t || '(automatic)'}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Local sound folder"
          hint="Your own sounds, read from here and never uploaded or copied. A map in <folder>/era-maps/<era>.json names the files; any event you leave out falls back to the game's sound, then to a synthesised one."
        >
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              aria-label="Local sound folder"
              value={settings.soundFolder}
              spellCheck={false}
              onChange={(e) => update({ soundFolder: e.target.value })}
            />
            <button
              type="button"
              onClick={() =>
                void engine
                  ?.pickFolder('Choose your sound folder', settings.soundFolder)
                  .then((p) => p && update({ soundFolder: p }))
                  .catch((e: unknown) => setErr(String(e)))
              }
            >
              Browse...
            </button>
            <button type="button" disabled={!settings.soundFolder} onClick={() => openFolder(settings.soundFolder)}>
              Open
            </button>
          </span>
        </Field>
        {check('soundMuted', 'Sounds off')}
        <Field label={`Master volume ${settings.soundVolume}%`}>
          <input
            type="range"
            min={0}
            max={100}
            aria-label="Master volume"
            value={settings.soundVolume}
            onChange={(e) => update({ soundVolume: Number(e.target.value) })}
          />
        </Field>
        {['alert', 'weapon', 'impact', 'system', 'ambient', 'ui'].map((c) => (
          <Field key={c} label={`${c[0].toUpperCase()}${c.slice(1)} sounds ${settings.soundCategoryVolumes?.[c] ?? 100}%`}>
            <input
              type="range"
              min={0}
              max={100}
              aria-label={`${c} volume`}
              value={settings.soundCategoryVolumes?.[c] ?? 100}
              onChange={(e) => update({ soundCategoryVolumes: { ...(settings.soundCategoryVolumes ?? {}), [c]: Number(e.target.value) } })}
            />
          </Field>
        ))}
        {folders && (
          <div className="field">
            <span className="lbl">Built-in libraries (managed, rewritten at every start)</span>
            <span className="hint">
              {folders.lib} and {folders.tfLib}{' '}
              <button type="button" onClick={() => openFolder(folders.lib)}>
                Open
              </button>
            </span>
          </div>
        )}
        <Field
          label="Delay between block lines (ms, 0 = none)"
          hint="Multi-line mode: paces big blocks so they do not flood the game"
        >
          <input
            type="number"
            min={0}
            max={10000}
            step={10}
            value={settings.sendLineDelayMs}
            onChange={num('sendLineDelayMs', 0, 10000)}
          />
        </Field>
        <div className="checks">
          {check(
            'softcodeJoin',
            'Multi-line: join indented lines to the previous line',
            '(softcode continuation)',
          )}
          {check('stripBlankLines', 'Multi-line: drop blank and @@ comment lines')}
          {check('warnUnbalanced', 'Multi-line: ask before sending unbalanced brackets')}
          {check(
            'autoReconnectSquatters',
            'Reconnect to squatters automatically',
            '(after sleep or a network drop)',
          )}
          {check(
            'showGagged',
            'Show lines TinyFugue gagged',
            '(TinyFugue squatters; the lines are marked, not removed)',
          )}
          {check(
            'tfHideQueries',
            "Keep SquatClient's own queries off TinyFugue's screen",
            '(sends TinyFugue a small script when an admin device connects; needs squat_scripts)',
          )}
          {check('timestamps', 'Show timestamps')}
          {check('boldAsBright', 'Bold text uses bright colours')}
          {check('linkify', 'Make bare URLs clickable')}
          {check('pauseOnScroll', 'Pause output when scrolled up')}
          {check('notifications', 'Desktop notifications')}
          {check('screenReader', 'Screen-reader mode', '(announces new lines)')}
        </div>
      </div>
      {err && (
        <p role="alert" className="err">
          {err}
        </p>
      )}
    </Dialog>
  );
}
