import { useLayoutEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { ancestorsOf, childrenOf, getTopic } from '../../help/data';
import { isExternalUrl, parseHelpHref } from '../../help/lookup';
import { anchorDomId, renderTopic } from '../../help/render';
import { tokenize } from '../../help/search';
import { insertIntoInput } from '../../help/command';
import { openExternal } from '../../api/wails';
import { useUi } from '../../state/stores';
import { highlightTerms } from './highlight';

export interface TopicPageProps {
  id: string;
  anchor?: string;
  term?: string;
  onNavigate(id: string, anchor?: string): void;
}

/** One rendered help page: breadcrumbs, title, table of contents, sanitised Markdown, child links. */
export function TopicPage({ id, anchor, term, onNavigate }: TopicPageProps) {
  const topic = getTopic(id);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || !topic) return;
    el.innerHTML = renderTopic(topic);
    const marks = term ? highlightTerms(el, tokenize(term)) : [];
    const target = anchor ? el.querySelector<HTMLElement>(`[id="${anchorDomId(anchor)}"]`) : null;
    const scroller = pageRef.current;
    // The clicked link was just replaced; keep keyboard focus inside the dialog so Escape and Alt-Left still work.
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) scroller?.focus({ preventScroll: true });
    if (target) target.scrollIntoView?.({ block: 'start' });
    else if (marks[0]) marks[0].scrollIntoView?.({ block: 'center' });
    else if (scroller) scroller.scrollTop = 0;
  }, [topic, anchor, term]);

  if (!topic) {
    return (
      <article className="helppage" role="alert">
        <p>That help topic does not exist.</p>
      </article>
    );
  }

  const crumbs = ancestorsOf(id);
  const kids = childrenOf(id);
  const toc = topic.headings.filter((h) => h.level <= 3);

  const onClick = (e: MouseEvent<HTMLDivElement>): void => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLElement>('button[data-act]');
    if (btn) {
      const code = btn.closest('.codeblock')?.querySelector('code')?.textContent ?? '';
      const text = code.replace(/\n$/, '');
      if (btn.dataset.act === 'copy') {
        void (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard')))
          .then(() => useUi.getState().toast('info', 'Copied to the clipboard.'))
          .catch(() => useUi.getState().toast('warn', 'Could not copy to the clipboard.'));
      } else if (insertIntoInput(text)) {
        useUi.getState().toast('info', 'Inserted into the input line. Close help to edit it.');
      } else {
        useUi.getState().toast('warn', 'Open a session first: there is no input line to insert into.');
      }
      return;
    }
    const a = t.closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') ?? '';
    const internal = parseHelpHref(href, id);
    if (internal) onNavigate(internal.id, internal.anchor);
    else if (isExternalUrl(href)) openExternal(href);
  };

  return (
    <article className="helppage" ref={pageRef} aria-labelledby="help-title" tabIndex={-1}>
      <nav aria-label="Breadcrumb" className="crumbs">
        <ol>
          {[
            ...(id === 'home' ? [] : [{ id: 'home', title: 'Home' }]),
            ...crumbs.filter((c) => c.id !== 'home'),
          ].map((c) => (
            <li key={c.id}>
              <button type="button" className="link" onClick={() => onNavigate(c.id)}>
                {c.title}
              </button>
            </li>
          ))}
          <li aria-current="page">{topic.title}</li>
        </ol>
      </nav>
      <h1 id="help-title">{topic.title}</h1>
      {toc.length >= 3 && (
        <nav aria-label="On this page" className="toc">
          <h2 className="tochead">On this page</h2>
          <ul>
            {toc.map((h) => (
              <li key={h.id} className={`lvl${h.level}`}>
                <button type="button" className="link" onClick={() => onNavigate(id, h.id)}>
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className="helpbody" ref={bodyRef} onClick={onClick} />
      {kids.length > 0 && (
        <nav aria-label="In this section" className="kids">
          <h2>In this section</h2>
          <ul>
            {kids.map((k) => (
              <li key={k.id}>
                <button type="button" className="link" onClick={() => onNavigate(k.id)}>
                  {k.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </article>
  );
}
