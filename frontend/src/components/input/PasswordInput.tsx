import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { DEFAULT_KEYMAP, handleKey, initialEdit, keyName, NO_NAV } from '../../lib/keymap';
import type { EditState, Keymap } from '../../lib/keymap';

const NATIVE_DELETE = new Set(['Backspace', 'Delete', 'C-h', 'C-d']);
const BLOCKED = new Set(['Up', 'Down', 'C-p', 'C-n', 'S-Enter']);

export interface PasswordInputProps {
  disabled?: boolean;
  keymap?: Keymap;
  /** Called with the typed secret on Enter. It is never recorded in any history. */
  onSubmit(text: string): void;
}

/** The input while the server has echo off: masked, no history, no multi-line, separate from the normal input text. */
export function PasswordInput({ disabled, keymap = DEFAULT_KEYMAP, onSubmit }: PasswordInputProps) {
  const [st, setSt] = useState<EditState>(() => initialEdit());
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => ref.current?.focus(), []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.selectionStart !== st.cursor && document.activeElement === el) {
      el.setSelectionRange(st.cursor, st.cursor);
    }
  }, [st.text, st.cursor]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing || disabled) return;
    const name = keyName(e);
    const el = e.currentTarget;
    if (NATIVE_DELETE.has(name) && el.selectionStart !== el.selectionEnd) return;
    if (BLOCKED.has(name)) {
      e.preventDefault();
      return;
    }
    const res = handleKey({ ...st, cursor: el.selectionStart ?? st.cursor }, name, [], keymap);
    if (!res) return;
    e.preventDefault();
    setSt(res.state);
    if (res.submit !== undefined) onSubmit(res.submit);
  };

  return (
    <div className="inputline password">
      <span className="prompt-mark" aria-hidden="true">
        {'\u{1F512}'}
      </span>
      <input
        ref={ref}
        aria-label="Password input"
        type="password"
        value={st.text}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        onKeyDown={onKeyDown}
        onSelect={(e) => {
          const c = e.currentTarget.selectionStart ?? 0;
          setSt((s) => (s.cursor === c ? s : { ...s, cursor: c }));
        }}
        onChange={(e) =>
          setSt({
            ...st,
            text: e.target.value,
            cursor: e.target.selectionStart ?? e.target.value.length,
            nav: NO_NAV,
          })
        }
      />
    </div>
  );
}
