import { useEffect, useRef, useState } from 'react';
import {
  clearSearch,
  getBuffer,
  searchAll,
  selectAttr,
  useEditor,
  useEditorUi,
} from '../../state/editorStore';
import type { SearchHit } from '../../lib/editor/search';

/** Cmd/Ctrl-Shift-F: search the values of every attribute of the object (fetched lazily, then cached). */
export function SearchPanel({
  sid,
  dbref,
  onJump,
}: {
  sid: string;
  dbref: string;
  onJump(attr: string, offset: number): void;
}) {
  const st = useEditor((s) => s.ws[sid]?.objects.find((o) => o.dbref === dbref)?.search);
  const total = useEditor((s) => s.ws[sid]?.objects.find((o) => o.dbref === dbref)?.attrs.length ?? 0);
  const [q, setQ] = useState(st?.query ?? '');
  const [regex, setRegex] = useState(false);
  const [cs, setCs] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const run = (): void => void searchAll(sid, dbref, q, { regex, caseSensitive: cs });
  const close = (): void => {
    clearSearch(sid, dbref);
    useEditorUi.getState().set({ searchPanel: false });
  };

  const open = (h: SearchHit): void => {
    void selectAttr(sid, dbref, h.attr).then(() => {
      const b = getBuffer(sid, dbref, h.attr);
      if (!b) return;
      let offset = 0;
      if (b.mode === 'lines') {
        const lines = b.text.split('\n');
        offset = lines.slice(0, h.line - 1).reduce((n, l) => n + l.length + 1, 0) + (h.col - 1);
      } else {
        const at = b.text.toLowerCase().indexOf(q.toLowerCase());
        offset = at < 0 ? 0 : at;
      }
      onJump(h.attr, offset);
    });
  };

  return (
    <div className="ew-searchpanel" role="search" aria-label="Search all attributes">
      <form
        className="ew-searchform"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input
          ref={input}
          type="search"
          aria-label="Search all attributes of this object"
          placeholder="Search all attributes"
          value={q}
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        />
        <label className="ew-check">
          <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> Regex
        </label>
        <label className="ew-check">
          <input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} /> Case
        </label>
        <button type="submit" className="primary" disabled={!q}>
          Search
        </button>
        <button type="button" onClick={close}>
          Close
        </button>
      </form>
      <p className="ew-searchstat" role="status">
        {st
          ? st.running
            ? `Searching... ${st.fetched} of ${total} attributes read, ${st.hits.length} matches`
            : `${st.hits.length} ${st.hits.length === 1 ? 'match' : 'matches'} in ${new Set(st.hits.map((h) => h.attr)).size} attributes`
          : 'Press Enter to search. Attribute values are read once and cached.'}
      </p>
      {st && st.hits.length > 0 && (
        <ul className="ew-hits" aria-label="Search results">
          {st.hits.slice(0, 200).map((h, i) => (
            <li key={`${h.attr}:${h.line}:${i}`}>
              <button type="button" onClick={() => open(h)}>
                <span className="ew-hitattr">{h.attr}</span>
                <span className="dim">:{h.line}</span> <span className="ew-hittext">{h.preview}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
