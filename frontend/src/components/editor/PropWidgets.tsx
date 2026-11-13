import { useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { EditCatalogItem } from '../../api/types';
import type { CatalogState } from '../../state/detailsStore';
import { checkFlagName } from '../../lib/editor/props';

/** Small pieces of the Object details view. Every class is prefixed `ew-`. */

export function Busy({ label = 'Working' }: { label?: string }) {
  return <span className="ew-spin" role="img" aria-label={label} />;
}

/** An inline error that keeps the game's exact reply. */
export function FieldError({ text, reply }: { text: string; reply?: string }) {
  return (
    <div className="ew-fielderr" role="alert">
      <span>{text}</span>
      {reply && !text.includes(reply) && (
        <span className="ew-reply">
          {' '}
          The game said: <q>{reply}</q>
        </span>
      )}
    </div>
  );
}

export function Section({
  title,
  id,
  actions,
  children,
}: {
  title: string;
  id: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ew-sec" aria-labelledby={id}>
      <header className="ew-sechead">
        <h3 id={id}>{title}</h3>
        {actions && <div className="ew-secactions">{actions}</div>}
      </header>
      <div className="ew-secbody">{children}</div>
    </section>
  );
}

export interface ChipProps {
  name: string;
  tip: string;
  busy?: boolean;
  disabled?: boolean;
  onRemove(): void;
  what: string;
}

/** A flag or power: the name, with a button that turns it off. */
export function Chip({ name, tip, busy, disabled, onRemove, what }: ChipProps) {
  return (
    <li className="ew-chip" title={tip}>
      <span className="ew-chipname">{name}</span>
      {busy ? (
        <Busy label={`Updating ${name}`} />
      ) : (
        <button
          type="button"
          className="ew-chipx"
          aria-label={`Turn off ${what} ${name}`}
          title={disabled ? 'You cannot change this object' : `Turn off ${name}`}
          disabled={disabled}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </li>
  );
}

export interface FlagComboProps {
  label: string;
  cat?: CatalogState;
  /** names already set (not offered again) */
  taken: string[];
  disabled?: boolean;
  busy?: boolean;
  placeholder: string;
  onAdd(name: string): Promise<boolean>;
}

/** Combobox over the game's flags or powers, with their descriptions; any valid name can be typed too. */
export function FlagCombo({ label, cat, taken, disabled, busy, placeholder, onAdd }: FlagComboProps) {
  const id = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(-1);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const items = useMemo<EditCatalogItem[]>(() => {
    const q = text.trim().toLowerCase();
    const t = new Set(taken.map((x) => x.toUpperCase()));
    return (cat?.items ?? []).filter(
      (i) =>
        !t.has(i.name.toUpperCase()) &&
        (!q ||
          i.name.toLowerCase().includes(q) ||
          i.desc.toLowerCase().includes(q) ||
          i.letter.toLowerCase() === q),
    );
  }, [cat, text, taken]);
  const optId = (i: number): string => `${id}-o${i}`;
  const optClass = (on: boolean): string => (on ? 'ew-comboopt ew-active' : 'ew-comboopt');

  const add = async (name: string): Promise<void> => {
    const bad = checkFlagName(name);
    if (bad) {
      setErr(bad);
      return;
    }
    setErr('');
    setOpen(false);
    const ok = await onAdd(name);
    if (ok) {
      setText('');
      setIdx(-1);
    }
    input.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setIdx((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = open && idx >= 0 ? items[idx] : undefined;
      const name = pick ? pick.name : text.trim();
      if (name) void add(name);
    }
  };

  return (
    <div className="ew-combo">
      <div className="ew-comboin">
        <input
          ref={input}
          type="text"
          role="combobox"
          className="ew-comboinput"
          aria-label={label}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && idx >= 0 ? optId(idx) : undefined}
          aria-invalid={err ? true : undefined}
          placeholder={placeholder}
          value={text}
          disabled={disabled || busy}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setIdx(0);
            setOpen(true);
            setErr('');
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
        />
        <button
          type="button"
          disabled={disabled || busy || !text.trim()}
          onClick={() => void add(text.trim())}
          title={`Add ${label.toLowerCase()}`}
        >
          Add
        </button>
        {busy && <Busy label={`Adding ${label.toLowerCase()}`} />}
      </div>
      {open && !disabled && (
        <ul id={`${id}-list`} role="listbox" aria-label={`${label} suggestions`} className="ew-combolist">
          {items.slice(0, 60).map((i, k) => (
            <li
              key={i.name}
              id={optId(k)}
              role="option"
              aria-selected={k === idx}
              className={optClass(k === idx)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void add(i.name)}
            >
              <span className="ew-comboname">
                {i.name}
                {i.letter && <span className="ew-letter"> {i.letter}</span>}
              </span>
              {i.desc && <span className="ew-combodesc">{i.desc}</span>}
            </li>
          ))}
          {items.length === 0 && (
            <li className="ew-comboempty" role="presentation">
              {cat?.state === 'loading'
                ? 'Loading the list...'
                : cat && cat.known
                  ? text.trim()
                    ? 'Nothing in the list matches. Press Enter to try the name anyway.'
                    : 'Everything is already set.'
                  : 'The game did not list them. Type a name and press Enter.'}
            </li>
          )}
        </ul>
      )}
      {err && (
        <div className="ew-fielderr" role="alert">
          {err}
        </div>
      )}
    </div>
  );
}
