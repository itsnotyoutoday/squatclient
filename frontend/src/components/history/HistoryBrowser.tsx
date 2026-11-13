import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Dialog } from '../dialogs/Dialog';
import { HistoryList, optionId } from './HistoryList';
import { useSessions, useUi } from '../../state/stores';
import { seedHistory } from '../../state/history';
import { requestHistoryEntry } from '../../lib/inputevents';
import type { HistoryEntry } from '../../api/types';

const PAGE = 300;
const close = (): void => useUi.getState().openDialog(null);

/** Search, browse, reuse and delete the world's command history (Ctrl+R). */
export default function HistoryBrowser() {
  const engine = useUi((s) => s.engine);
  const sid = useSessions((s) => s.fg);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const [cs, setCs] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [sel, setSel] = useState(0);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const epoch = useRef(0);
  const loading = useRef(false);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const input = useRef<HTMLInputElement>(null);

  // (re)load the first page whenever the query, its options or the data change
  useEffect(() => {
    if (!engine || !sid) return;
    const mine = ++epoch.current;
    const t = setTimeout(
      () => {
        loading.current = true;
        engine
          .history(sid, query, { regex, caseSensitive: cs, limit: PAGE, offset: 0 })
          .then((p) => {
            if (mine !== epoch.current) return;
            setEntries(p.entries);
            setTotal(p.total);
            setSel(0);
            setError('');
            setReady(true);
          })
          .catch((e: unknown) => {
            if (mine !== epoch.current) return;
            setEntries([]);
            setTotal(0);
            setError(e instanceof Error ? e.message : String(e));
            setReady(true);
          })
          .finally(() => {
            if (mine === epoch.current) loading.current = false;
          });
      },
      query ? 80 : 0,
    );
    return () => clearTimeout(t);
  }, [engine, sid, query, regex, cs]);

  /** Make sure rows up to index `upTo` (plus a page of look-ahead) are loaded. */
  const ensure = useCallback(
    (upTo: number): void => {
      const have = entriesRef.current.length;
      if (!engine || !sid || loading.current || upTo < have - 40 || have >= total) return;
      loading.current = true;
      const mine = epoch.current;
      engine
        .history(sid, query, {
          regex,
          caseSensitive: cs,
          limit: Math.max(PAGE, upTo + 100 - have),
          offset: have,
        })
        .then((p) => {
          if (mine !== epoch.current) return;
          setEntries((cur) => (cur.length === have ? [...cur, ...p.entries] : cur));
        })
        .catch(() => undefined)
        .finally(() => {
          loading.current = false;
        });
    },
    [engine, sid, query, regex, cs, total],
  );

  const current: HistoryEntry | undefined = entries[sel];

  const move = (to: number): void => {
    const i = Math.max(0, Math.min(total - 1, to));
    setSel(i);
    ensure(i + 60);
  };

  const applyEntry = (e: HistoryEntry | undefined, send: boolean): void => {
    if (!e || !sid) return;
    if (requestHistoryEntry(sid, e.text, send)) close();
    else useUi.getState().toast('warn', 'No input line is available to receive this entry.');
  };

  const remove = (i: number): void => {
    const e = entries[i];
    if (!e || !engine || !sid) return;
    void engine
      .deleteHistory(sid, e.id)
      .then(() => {
        epoch.current++; // drop any page still in flight
        setEntries((cur) => cur.filter((x) => x.id !== e.id));
        setTotal((n) => Math.max(0, n - 1));
        setSel((s) => Math.max(0, Math.min(s, total - 2)));
        void seedHistory(engine, sid);
      })
      .catch((x: unknown) => useUi.getState().toast('error', String(x)));
  };

  const copy = (e: HistoryEntry | undefined): void => {
    if (!e) return;
    const done = (): void => useUi.getState().toast('info', 'Copied to the clipboard');
    const fail = (): void => useUi.getState().toast('warn', 'Could not copy to the clipboard');
    try {
      void navigator.clipboard.writeText(e.text).then(done, fail);
    } catch {
      fail();
    }
  };

  const clearAll = (): void => {
    if (!engine || !sid) return;
    void engine
      .clearHistory(sid)
      .then(() => {
        epoch.current++;
        setConfirm(false);
        setEntries([]);
        setTotal(0);
        void seedHistory(engine, sid);
      })
      .catch((x: unknown) => useUi.getState().toast('error', String(x)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (confirm) return;
    const t = e.target as HTMLElement;
    const inField = t instanceof HTMLInputElement && t.type === 'search';
    const mod = e.metaKey || e.ctrlKey;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(sel + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(sel - 1);
        break;
      case 'PageDown':
        e.preventDefault();
        move(sel + 8);
        break;
      case 'PageUp':
        e.preventDefault();
        move(sel - 8);
        break;
      case 'Home':
        if (!inField || mod) {
          e.preventDefault();
          move(0);
        }
        break;
      case 'End':
        if (!inField || mod) {
          e.preventDefault();
          move(total - 1);
        }
        break;
      case 'Enter':
        if (t instanceof HTMLButtonElement) return; // let buttons act
        e.preventDefault();
        applyEntry(current, e.shiftKey);
        break;
      case 'Delete':
        if (inField && (t as HTMLInputElement).selectionStart !== (t as HTMLInputElement).value.length)
          return;
        e.preventDefault();
        remove(sel);
        break;
      case 'c':
      case 'C':
        if (mod && !e.altKey) {
          const hasSel = inField
            ? (t as HTMLInputElement).selectionStart !== (t as HTMLInputElement).selectionEnd
            : (window.getSelection()?.toString() ?? '') !== '';
          if (!hasSel) {
            e.preventDefault();
            copy(current);
          }
        }
        break;
      default:
    }
  };

  const status = error
    ? ''
    : !ready
      ? 'Loading…'
      : total === 0
        ? query
          ? 'No matching commands'
          : 'No commands remembered yet'
        : `${sel + 1} of ${total}${query ? ' matches' : ''}`;

  return (
    <Dialog
      title="Command history"
      wide
      onClose={close}
      footer={
        confirm ? (
          <div className="hconfirm" role="alert">
            <span>Delete all {total} remembered commands of this world? This cannot be undone.</span>
            <button type="button" ref={(el) => el?.focus()} onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button type="button" className="danger" onClick={clearAll}>
              Clear history
            </button>
          </div>
        ) : (
          <>
            <span className="hint grow">
              Up/Down select · Enter load · Shift+Enter send · Del remove ·{' '}
              {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+C copy
            </span>
            <button
              type="button"
              onClick={() => setConfirm(true)}
              disabled={!ready || (total === 0 && !query)}
            >
              Clear history…
            </button>
            <button type="button" onClick={() => remove(sel)} disabled={!current}>
              Delete
            </button>
            <button type="button" onClick={() => applyEntry(current, false)} disabled={!current}>
              Load
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => applyEntry(current, true)}
              disabled={!current}
            >
              Send
            </button>
          </>
        )
      }
    >
      <div className="hbrowser" onKeyDown={onKeyDown}>
        <div className="hsearch">
          <input
            ref={input}
            data-autofocus
            type="search"
            aria-label="Search history"
            placeholder="Search history…"
            value={query}
            role="searchbox"
            aria-controls={listId}
            aria-activedescendant={total > 0 ? optionId(listId, sel) : undefined}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            aria-pressed={regex}
            onClick={() => setRegex((v) => !v)}
            title="Regular expression"
          >
            .*
          </button>
          <button type="button" aria-pressed={cs} onClick={() => setCs((v) => !v)} title="Match case">
            Aa
          </button>
        </div>
        <div className="hstatus" role="status" aria-label="History results">
          {status}
        </div>
        {error && (
          <p role="alert" className="err">
            {error}
          </p>
        )}
        <HistoryList
          id={listId}
          entries={entries}
          total={total}
          selected={sel}
          query={query}
          match={{ regex, caseSensitive: cs }}
          onSelect={setSel}
          onOpen={(i) => applyEntry(entries[i], false)}
          onNeed={ensure}
        />
      </div>
    </Dialog>
  );
}
