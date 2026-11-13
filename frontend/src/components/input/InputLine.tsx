import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { handleKey, initialEdit, keyName, NO_NAV, pasteToLines } from '../../lib/keymap';
import type { EditState, Keymap } from '../../lib/keymap';
import { DEFAULT_KEYMAP } from '../../lib/keymap';
import { currentChunk, indentSelection, prepareBlock } from '../../lib/softcode';
import type { EditResult } from '../../lib/softcode';
import { sendBlock } from '../../lib/blocksender';
import type { BlockProgress, BlockSend } from '../../lib/blocksender';
import { clampInputHeight, heightBounds, lineHeightPx } from '../../lib/inputsize';
import { loadDraft, loadEditorPrefs, saveDraft, saveEditorPrefs } from '../../lib/drafts';
import type { EditorPrefs, InputDraft } from '../../lib/drafts';
import { HISTORY_USE_EVENT, TOGGLE_EDITOR_EVENT } from '../../lib/inputevents';
import type { HistoryUseDetail } from '../../lib/inputevents';
import { worldKey } from '../../lib/worldkey';
import { getHistory, recordHistory, seedHistory } from '../../state/history';
import { useSessions, useSettings, useUi } from '../../state/stores';
import { INSERT_EVENT, openHelp, parseHelpCommand } from '../../help/command';
import type { InsertDetail } from '../../help/command';
import { EditorPane, modLabel } from './EditorPane';
import { PasswordInput } from './PasswordInput';
import { ResizeHandle } from './ResizeHandle';

const NATIVE_DELETE = new Set(['Backspace', 'Delete', 'C-h', 'C-d']);
const DEFAULT_EDITOR_H = 240;

export interface InputLineProps {
  sessionId: string;
  remoteEcho: boolean;
  disabled?: boolean;
  keymap?: Keymap;
}

const blockOpts = (): { join: boolean; stripBlank: boolean } => {
  const s = useSettings.getState().settings;
  return { join: s.softcodeJoin, stripBlank: s.stripBlankLines };
};

/** What survives a tab switch or restart: the editor flag and any multi-line / editor text. */
const draftOf = (editor: boolean, text: string): InputDraft =>
  editor || text.includes('\n') ? { editor, text } : { editor: false, text: '' };

export function InputLine({ sessionId, remoteEcho, disabled, keymap = DEFAULT_KEYMAP }: InputLineProps) {
  const engine = useUi((s) => s.engine);
  const settings = useSettings((s) => s.settings);
  const session = useSessions((s) => s.sessions[sessionId]);
  const key = session ? worldKey(session) : sessionId;

  const [st, setSt] = useState<EditState>(() => initialEdit());
  const [editor, setEditor] = useState(false);
  const [prefs, setPrefs] = useState<EditorPrefs>(() => loadEditorPrefs());
  const [progress, setProgress] = useState<BlockProgress | null>(null);
  const [winH, setWinH] = useState(() => window.innerHeight);
  const ref = useRef<HTMLTextAreaElement>(null);
  const selRef = useRef<[number, number] | null>(null);
  const blockRef = useRef<BlockSend | null>(null);
  const loadedKey = useRef('');
  const latest = useRef({ editor, text: st.text });

  useEffect(() => {
    latest.current = { editor, text: st.text };
  });

  // Switching sessions: park the outgoing draft, load the world's draft, seed recall from the persistent history.
  useEffect(() => {
    const d = loadDraft(key);
    loadedKey.current = key;
    setEditor(d.editor);
    setSt(initialEdit(d.text));
    if (engine) void seedHistory(engine, sessionId);
    return () => {
      const l = latest.current;
      saveDraft(key, draftOf(l.editor, l.text));
    };
  }, [sessionId, key, engine]);

  // Keep the draft on disk (debounced) while editing.
  useEffect(() => {
    const t = setTimeout(() => {
      if (loadedKey.current === key) saveDraft(key, draftOf(editor, st.text));
    }, 250);
    return () => clearTimeout(t);
  }, [key, editor, st.text]);

  useEffect(() => {
    if (!remoteEcho) ref.current?.focus();
  }, [sessionId, editor, remoteEcho]);

  useEffect(() => {
    const onResize = (): void => setWinH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      blockRef.current?.cancel();
    };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (selRef.current) {
      el.setSelectionRange(selRef.current[0], selRef.current[1]);
      selRef.current = null;
      return;
    }
    // follow programmatic cursor moves, but never collapse a selection the user is making
    const selecting = el.selectionStart !== el.selectionEnd && el.selectionStart === st.cursor;
    if (!selecting && el.selectionStart !== st.cursor && document.activeElement === el) {
      el.setSelectionRange(st.cursor, st.cursor);
    }
  }, [st.text, st.cursor]);

  // ---- sending

  const sendOne = useCallback(
    (sid: string, l: string): void => {
      // /help is a UI feature: open the help browser instead of sending it.
      const help = parseHelpCommand(l);
      if (help !== null) {
        openHelp(help);
        return;
      }
      if (!engine) return;
      void engine.input(sid, l).catch((e: unknown) => useUi.getState().toast('error', String(e)));
    },
    [engine],
  );

  const run = useCallback(
    (lines: string[]): void => {
      if (lines.length === 0) return;
      const sid = sessionId;
      const delay = useSettings.getState().settings.sendLineDelayMs;
      if (delay > 0 && lines.length > 1) {
        setProgress({ sent: 0, total: lines.length });
        const b = sendBlock(lines, delay, (l) => sendOne(sid, l), setProgress);
        blockRef.current = b;
        void b.done.then((r) => {
          setProgress(null);
          if (blockRef.current === b) blockRef.current = null;
          if (r.cancelled && r.sent < r.total)
            useUi
              .getState()
              .toast('info', `Block cancelled: ${r.total - r.sent} of ${r.total} lines not sent`);
        });
      } else {
        sendBlock(lines, 0, (l) => sendOne(sid, l));
      }
    },
    [sessionId, sendOne],
  );

  const record = (text: string): void => recordHistory(engine, sessionId, text.replace(/\s+$/, ''));

  const submit = (text: string): void => {
    record(text);
    for (const l of text.split('\n')) sendOne(sessionId, l);
  };

  const sendBuffer = (): void => {
    const lines = prepareBlock(st.text, blockOpts());
    if (lines.length === 0 || blockRef.current) return;
    record(st.text);
    setSt((s) => ({ ...initialEdit(), kill: s.kill }));
    run(lines);
  };

  const sendChunk = (): void => {
    const el = ref.current;
    if (!el || blockRef.current) return;
    const chunk = currentChunk(st.text, el.selectionStart, el.selectionEnd, blockOpts().join);
    const lines = prepareBlock(chunk, blockOpts());
    if (lines.length === 0) return;
    record(chunk);
    run(lines);
  };

  // Hooks for events registered once: always call the newest closures.
  const api = useRef({ run, record, toggle: (): void => undefined, load: (_t: string): void => undefined });
  useEffect(() => {
    api.current = {
      run,
      record,
      toggle: () => {
        if (!remoteEcho && !disabled) setEditor((e) => !e);
      },
      load: (text) => {
        if (text.includes('\n')) setEditor(true);
        setSt((s) => ({ ...initialEdit(text), kill: s.kill }));
        setTimeout(() => ref.current?.focus(), 0);
      },
    };
  });

  useEffect(() => {
    const onToggle = (): void => api.current.toggle();
    const onUse = (ev: Event): void => {
      const d = (ev as CustomEvent<HistoryUseDetail>).detail;
      if (!d || d.handled || d.sessionId !== sessionId || remoteEcho || disabled) return;
      d.handled = true;
      if (d.send) {
        api.current.record(d.text);
        api.current.run(d.text.includes('\n') ? prepareBlock(d.text, blockOpts()) : [d.text]);
      } else api.current.load(d.text);
    };
    // "Insert into input" from the help browser: put text at the cursor, never send it.
    const onInsert = (ev: Event): void => {
      const d = (ev as CustomEvent<InsertDetail>).detail;
      if (remoteEcho || disabled || !d || d.handled) return;
      d.handled = true;
      const at = ref.current?.selectionStart ?? null;
      setSt((s) => {
        const c = Math.min(at ?? s.cursor, s.text.length);
        return {
          ...s,
          text: s.text.slice(0, c) + d.text + s.text.slice(c),
          cursor: c + d.text.length,
          nav: NO_NAV,
        };
      });
    };
    window.addEventListener(TOGGLE_EDITOR_EVENT, onToggle);
    window.addEventListener(HISTORY_USE_EVENT, onUse);
    window.addEventListener(INSERT_EVENT, onInsert);
    return () => {
      window.removeEventListener(TOGGLE_EDITOR_EVENT, onToggle);
      window.removeEventListener(HISTORY_USE_EVENT, onUse);
      window.removeEventListener(INSERT_EVENT, onInsert);
    };
  }, [sessionId, remoteEcho, disabled]);

  // ---- size

  const fontSize = settings.fontSize;
  const lh = lineHeightPx(fontSize);
  const { min, max } = heightBounds(winH, fontSize);
  const field = editor ? 'editorHeight' : 'inputHeight';
  const stored = settings[field];
  const fixed = editor
    ? clampInputHeight(stored || DEFAULT_EDITOR_H, winH, fontSize)
    : stored > 0
      ? clampInputHeight(stored, winH, fontSize)
      : 0;
  const rows = Math.min(8, st.text.split('\n').length);
  const shown = fixed || min + (rows - 1) * lh;

  const setHeight = (px: number, commit: boolean): void => {
    const next = { ...useSettings.getState().settings, [field]: px };
    useSettings.getState().set(next);
    if (commit)
      void engine?.saveSettings(next).catch((e: unknown) => useUi.getState().toast('error', String(e)));
  };

  // ---- keys

  const apply = (r: EditResult): void => {
    selRef.current = [r.start, r.end];
    setSt((s) => ({ ...s, text: r.text, cursor: r.start, nav: NO_NAV }));
  };

  const onEditorKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing || disabled) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && mod) {
      e.preventDefault();
      if (e.shiftKey) sendChunk();
      else sendBuffer();
    } else if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const r = indentSelection(el.value, el.selectionStart, el.selectionEnd, e.shiftKey);
      if (r) apply(r);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditor(false); // the text stays: nothing is lost by leaving editor mode
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing || disabled) return;
    const name = keyName(e);
    const el = e.currentTarget;
    if (NATIVE_DELETE.has(name) && el.selectionStart !== el.selectionEnd) return;
    const res = handleKey(
      { ...st, cursor: el.selectionStart ?? st.cursor },
      name,
      getHistory(sessionId),
      keymap,
    );
    if (!res) return;
    e.preventDefault();
    setSt(res.state);
    if (res.submit !== undefined) submit(res.submit);
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const text = e.clipboardData.getData('text');
    if (!/[\r\n]/.test(text)) return;
    e.preventDefault();
    const { lines, state } = pasteToLines(
      { ...st, cursor: e.currentTarget.selectionStart ?? st.cursor },
      text,
    );
    setSt(state);
    for (const l of lines) recordHistory(engine, sessionId, l);
    for (const l of lines) sendOne(sessionId, l);
  };

  const common = {
    ref,
    value: st.text,
    disabled,
    spellCheck: false,
    autoComplete: 'off',
    autoCapitalize: 'off',
    autoCorrect: 'off',
  } as const;

  const openHistory = (): void => useUi.getState().openDialog('history');
  const setPref = (p: Partial<EditorPrefs>): void => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    saveEditorPrefs(next);
  };

  const handle = (
    <ResizeHandle
      value={shown}
      measure={() => ref.current?.offsetHeight || shown}
      min={min}
      max={max}
      lineHeight={lh}
      onChange={setHeight}
      onReset={() => setHeight(editor ? DEFAULT_EDITOR_H : 0, true)}
    />
  );

  if (remoteEcho) {
    return (
      <div className="inputdock">
        <PasswordInput
          disabled={disabled}
          keymap={keymap}
          onSubmit={(t) => {
            if (engine)
              void engine
                .input(sessionId, t)
                .catch((e: unknown) => useUi.getState().toast('error', String(e)));
          }}
        />
      </div>
    );
  }

  if (editor) {
    return (
      <div className="inputdock">
        {handle}
        <div className="inputline editor">
          <EditorPane
            textareaRef={ref}
            text={st.text}
            cursor={st.cursor}
            height={fixed}
            wrap={prefs.wrap}
            lineNumbers={prefs.lineNumbers}
            disabled={disabled}
            progress={progress}
            onText={(text, cursor) => setSt((s) => ({ ...s, text, cursor, nav: NO_NAV }))}
            onSelect={(c) => setSt((s) => (s.cursor === c ? s : { ...s, cursor: c }))}
            onKeyDown={onEditorKeyDown}
            onSend={sendBuffer}
            onSendChunk={sendChunk}
            onClear={() => {
              setSt((s) => ({ ...initialEdit(), kill: s.kill }));
              ref.current?.focus();
            }}
            onCancel={() => blockRef.current?.cancel()}
            onWrap={(wrap) => setPref({ wrap })}
            onLineNumbers={(lineNumbers) => setPref({ lineNumbers })}
            onExit={() => setEditor(false)}
            onHistory={openHistory}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="inputdock">
      {handle}
      <div className="inputline">
        <span className="prompt-mark" aria-hidden="true">
          {'›'}
        </span>
        <textarea
          {...common}
          aria-label="Command input"
          rows={rows}
          style={fixed ? { height: fixed } : undefined}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onSelect={(e) => {
            const c = e.currentTarget.selectionStart;
            setSt((s) => (s.cursor === c ? s : { ...s, cursor: c }));
          }}
          onChange={(e) => {
            const v = e.target.value;
            const c = e.target.selectionStart;
            setSt(v === st.text ? { ...st, cursor: c } : { ...st, text: v, cursor: c, nav: NO_NAV });
          }}
        />
        <span className="ibtns">
          {progress && (
            <button type="button" onClick={() => blockRef.current?.cancel()} aria-label="Cancel block">
              Cancel {progress.sent}/{progress.total}
            </button>
          )}
          <button
            type="button"
            onClick={openHistory}
            title="Command history (Ctrl+R)"
            aria-label="Open history"
          >
            History
          </button>
          <button
            type="button"
            onClick={() => setEditor(true)}
            aria-pressed={false}
            title={`Editor mode for big pieces of code (${modLabel()}+Shift+E)`}
            aria-label="Editor mode"
          >
            Editor
          </button>
        </span>
      </div>
    </div>
  );
}
