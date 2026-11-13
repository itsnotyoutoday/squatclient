import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useSessions, useSettings, useUi, setBufferCap } from '../../state/stores';
import { seedHistory } from '../../state/history';
import type { Settings } from '../../api/types';
import { DEFAULT_FONT } from '../../api/types';
import { allThemes, parseThemeJson, registerTheme } from '../../themes';
import { Dialog, Field } from './Dialog';

export function SettingsDialog() {
  const engine = useUi((s) => s.engine);
  const settings = useSettings((s) => s.settings);
  const [err, setErr] = useState('');
  const [, force] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const fg = useSessions((s) => s.fg);
  const [stored, setStored] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

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
      registerTheme(t);
      update({ theme: t.id });
      setErr('');
      force((n) => n + 1);
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
        <Field label="Import theme (JSON)">
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
            'Editor: join indented lines to the previous line',
            '(softcode continuation)',
          )}
          {check('stripBlankLines', 'Editor: drop blank and @@ comment lines')}
          {check('warnUnbalanced', 'Editor: ask before sending unbalanced brackets')}
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
