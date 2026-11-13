import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import type { HelpTopic } from './types';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** DOM id for a heading anchor. Prefixed so ids never collide with the app's own elements. */
export const anchorDomId = (anchor: string): string => `help-a-${anchor}`;

let queue: string[] = [];

const marked = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const id = queue.shift();
      return `<h${depth}${id ? ` id="${esc(anchorDomId(id))}"` : ''}>${text}</h${depth}>\n`;
    },
    code({ text }) {
      return (
        '<div class="codeblock"><div class="codebar">' +
        '<button type="button" class="codebtn" data-act="copy" aria-label="Copy code">Copy</button>' +
        '<button type="button" class="codebtn" data-act="insert" aria-label="Insert code into input line">Insert into input</button>' +
        `</div><pre><code>${esc(text)}</code></pre></div>\n`
      );
    },
  },
});

/** Only http(s), help: and in-page links survive; javascript:, data: etc. are removed. */
const ALLOWED_URI = /^(?:(?:https?|help):|#)/i;

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    FORBID_TAGS: ['style', 'form', 'input', 'textarea', 'select', 'iframe', 'object', 'embed', 'img'],
    FORBID_ATTR: ['style', 'srcset'],
  });
}

/** Markdown to sanitised HTML. Headings get ids from the generated heading list, in document order. */
export function renderMarkdown(body: string, headingIds: string[] = []): string {
  queue = [...headingIds];
  try {
    return sanitize(marked.parse(body, { async: false }) as string);
  } finally {
    queue = [];
  }
}

export const renderTopic = (t: HelpTopic): string =>
  renderMarkdown(
    t.body,
    t.headings.map((h) => h.id),
  );
