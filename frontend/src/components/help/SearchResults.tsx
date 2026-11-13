import { getTopic } from '../../help/data';
import { search, tokenize } from '../../help/search';

function Marked({ text, tokens }: { text: string; tokens: string[] }) {
  if (tokens.length === 0) return <>{text}</>;
  const re = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="hit">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

export interface SearchResultsProps {
  query: string;
  onOpen(id: string, anchor: string | undefined, term: string): void;
}

export function SearchResults({ query, onOpen }: SearchResultsProps) {
  const results = search(query);
  const tokens = tokenize(query);
  return (
    <section className="helpresults" aria-label="Search results">
      <p role="status" className="count">
        {results.length === 0
          ? `No help topics match “${query}”. Try fewer or different words.`
          : `${results.length} ${results.length === 1 ? 'topic matches' : 'topics match'} “${query}”`}
      </p>
      <ol>
        {results.map((r) => {
          const topic = getTopic(r.topic);
          if (!topic) return null;
          return (
            <li key={r.topic}>
              <button
                type="button"
                className="result"
                onClick={() => onOpen(r.topic, r.anchor || undefined, query)}
              >
                <span className="rtitle">
                  <Marked text={topic.title} tokens={tokens} />
                </span>
                <span className="rsnip">
                  <Marked text={r.snippet} tokens={tokens} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
