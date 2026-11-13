import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { handleKey, initialEdit, keyName, NO_NAV, pasteToLines } from '../../lib/keymap';
import type { EditState, Keymap } from '../../lib/keymap';
import { DEFAULT_KEYMAP } from '../../lib/keymap';
import { addHistory, getHistory } from '../../state/history';
import { useUi } from '../../state/stores';

type El = HTMLTextAreaElement | HTMLInputElement;
const NATIVE_DELETE = new Set(['Backspace', 'Delete', 'C-h', 'C-d']);

export interface InputLineProps {
  sessionId: string;
  remoteEcho: boolean;
  disabled?: boolean;
  keymap?: Keymap;
}

export function InputLine({ sessionId, remoteEcho, disabled, keymap = DEFAULT_KEYMAP }: InputLineProps) {
  const engine = useUi((s) => s.engine);
  const [st, setSt] = useState<EditState>(() => initialEdit());
  const ref = useRef<El>(null);
  const history = getHistory(sessionId);

  // Reset when switching sessions; focus the input.
  useEffect(() => {
    setSt(initialEdit());
    ref.current?.focus();
  }, [sessionId]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (
      el &&
      (el.selectionStart !== st.cursor || el.selectionEnd !== st.cursor) &&
      document.activeElement === el
    ) {
      el.setSelectionRange(st.cursor, st.cursor);
    }
  }, [st.text, st.cursor]);

  const send = (lines: string[]): void => {
    if (!engine) return;
    for (const l of lines)
      void engine.input(sessionId, l).catch((e: unknown) => useUi.getState().toast('error', String(e)));
  };

  const submit = (text: string): void => {
    if (!remoteEcho) addHistory(sessionId, text);
    send(text.split('\n'));
  };

  const onKeyDown = (e: KeyboardEvent<El>): void => {
    if (e.nativeEvent.isComposing || disabled) return;
    const name = keyName(e);
    const el = e.currentTarget;
    if (NATIVE_DELETE.has(name) && el.selectionStart !== el.selectionEnd) return;
    if (
      remoteEcho &&
      (name === 'Up' || name === 'Down' || name === 'C-p' || name === 'C-n' || name === 'S-Enter')
    ) {
      e.preventDefault();
      return;
    }
    const res = handleKey({ ...st, cursor: el.selectionStart ?? st.cursor }, name, history, keymap);
    if (!res) return;
    e.preventDefault();
    setSt(res.state);
    if (res.submit !== undefined) submit(res.submit);
  };

  const onPaste = (e: ClipboardEvent<El>): void => {
    const text = e.clipboardData.getData('text');
    if (remoteEcho || !/[\r\n]/.test(text)) return;
    e.preventDefault();
    const { lines, state } = pasteToLines(
      { ...st, cursor: e.currentTarget.selectionStart ?? st.cursor },
      text,
    );
    setSt(state);
    for (const l of lines) if (!remoteEcho) addHistory(sessionId, l);
    send(lines);
  };

  const common = {
    'aria-label': remoteEcho ? 'Password input' : 'Command input',
    value: st.text,
    disabled,
    spellCheck: false,
    autoComplete: 'off',
    autoCapitalize: 'off',
    autoCorrect: 'off',
    onKeyDown,
    onPaste,
    onSelect: (e: React.SyntheticEvent<El>) => {
      const c = e.currentTarget.selectionStart ?? 0;
      setSt((s) => (s.cursor === c ? s : { ...s, cursor: c }));
    },
  };

  const rows = Math.min(8, st.text.split('\n').length);
  return (
    <div className={`inputline${remoteEcho ? ' password' : ''}`}>
      <span className="prompt-mark" aria-hidden="true">
        {remoteEcho ? '\u{1F512}' : '›'}
      </span>
      {remoteEcho ? (
        <input
          {...common}
          ref={ref as React.RefObject<HTMLInputElement>}
          type="password"
          onChange={(e) =>
            setSt({
              ...st,
              text: e.target.value,
              cursor: e.target.selectionStart ?? e.target.value.length,
              nav: NO_NAV,
            })
          }
        />
      ) : (
        <textarea
          {...common}
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          rows={rows}
          onChange={(e) => {
            const v = e.target.value;
            const c = e.target.selectionStart ?? v.length;
            setSt(v === st.text ? { ...st, cursor: c } : { ...st, text: v, cursor: c, nav: NO_NAV });
          }}
        />
      )}
    </div>
  );
}
