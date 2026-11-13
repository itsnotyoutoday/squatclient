import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useUi } from '../../state/stores';
import { currentView, lastTopicId, useHelp } from '../../help/store';
import { HOME_ID } from '../../help/home';
import { resolveQuery } from '../../help/lookup';
import { Dialog } from '../dialogs/Dialog';
import { TopicTree } from './TopicTree';
import { TopicPage } from './TopicPage';
import { SearchResults } from './SearchResults';
import './help.css';

/** The interactive help browser. Opened by `/help`, F1, Cmd-? and the Help menu. */
export function HelpBrowser() {
  const view = useHelp(currentView);
  const canBack = useHelp((s) => s.pos > 0);
  const canForward = useHelp((s) => s.pos < s.stack.length - 1);
  const pending = useHelp((s) => s.pending);
  const currentId = useHelp(lastTopicId);
  const searchRef = useRef<HTMLInputElement>(null);
  const close = (): void => useUi.getState().openDialog(null);

  // Resolve a `/help ...` request: topic, TF-style name, or search words.
  useEffect(() => {
    if (pending === null) return;
    const h = useHelp.getState();
    const q = h.takePending() ?? '';
    const r = resolveQuery(q);
    if (r.kind === 'search') h.setSearch(r.query);
    else h.go({ kind: 'topic', id: r.id, anchor: r.anchor, term: r.term });
  }, [pending]);

  const query = view.kind === 'search' ? view.query : '';
  const open = (id: string, anchor?: string, term?: string): void =>
    useHelp.getState().go({ kind: 'topic', id, anchor, term });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const h = useHelp.getState();
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      h.back();
    } else if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      h.forward();
    } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      e.stopPropagation();
      useHelp.getState().setSearch('');
    }
  };

  return (
    <Dialog title="SquatClient Help" onClose={close} wide>
      <div className="helpbrowser" onKeyDown={onKeyDown}>
        <div className="helpbar" role="toolbar" aria-label="Help navigation">
          <button
            type="button"
            aria-label="Back"
            title="Back (Alt-Left)"
            disabled={!canBack}
            onClick={() => useHelp.getState().back()}
          >
            &#8592;
          </button>
          <button
            type="button"
            aria-label="Forward"
            title="Forward (Alt-Right)"
            disabled={!canForward}
            onClick={() => useHelp.getState().forward()}
          >
            &#8594;
          </button>
          <button type="button" aria-label="Home" title="Home" onClick={() => open(HOME_ID)}>
            &#8962;
          </button>
          <input
            ref={searchRef}
            data-autofocus
            type="search"
            role="searchbox"
            aria-label="Search help"
            placeholder="Search help (press / to focus)"
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => useHelp.getState().setSearch(e.target.value)}
            onKeyDown={onSearchKey}
          />
        </div>
        <div className="helpmain">
          <nav className="helpside" aria-label="Topics">
            <TopicTree currentId={currentId} onOpen={(id) => open(id)} />
          </nav>
          <div className="helpcontent">
            {view.kind === 'search' ? (
              <SearchResults query={view.query} onOpen={(id, anchor, term) => open(id, anchor, term)} />
            ) : (
              <TopicPage
                id={view.id}
                anchor={view.anchor}
                term={view.term}
                onNavigate={(id, anchor) => open(id, anchor)}
              />
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export default HelpBrowser;
