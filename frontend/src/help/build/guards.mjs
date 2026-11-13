/**
 * Content guards for the in-app help. The help must be a self-contained user guide: it may not point at
 * repository files, folders, packages or documents that are not part of the help itself, and every help:
 * link must resolve. Used by build-help.mjs (fails the build) and by tests/help.guards.test.ts.
 *
 * checkTopics(topics) -> string[] of problems (empty when clean). A topic needs {id, title, body, headings}.
 */

/** [regex, description] pairs; matched against the body with http(s) URLs removed. */
export const FORBIDDEN = [
  [/\b(?:docs|pkg|internal|frontend|cmd|testdata|scripts)\/[\w.-]/, 'repository path'],
  [/\b[\w-]+\.(?:go|ts|tsx|mjs|jsx)\b/i, 'source file name'],
  [/\b[\w-]+\.md\b/i, 'markdown file name'],
  [/\bREADME\b/, 'README'],
  [
    /\b(?:STRUCTURE|PROTOCOL|DESIGN|AUTOMATION|ENGINE|DAEMON)\b(?=\s*(?:\.md|document|doc\b))/,
    'internal document',
  ],
  [/\bADRs?\b/, 'ADR'],
  [/bug-for-bug/i, '"bug-for-bug"'],
  [/not implemented/i, '"not implemented"'],
  [/clean-room/i, '"clean-room"'],
  [/\boracle\b/i, '"oracle"'],
  [/\bHost interface\b/i, '"Host interface"'],
  [/\b(?:goroutine|ndjson)\b/i, 'developer jargon'],
  [/\bsee the source\b/i, '"see the source"'],
];

const stripUrls = (s) => s.replace(/https?:\/\/[^\s)>\]]+/g, ' ');

export function checkTopics(topics) {
  const problems = [];
  const byId = new Map(topics.map((t) => [t.id, t]));
  for (const t of topics) {
    if (!t.title || !String(t.title).trim()) problems.push(`${t.id}: topic has no title`);
    const body = t.body ?? '';
    const scan = stripUrls(body).replace(/\]\(help:[^)]*\)/g, ']');
    const lines = scan.split('\n');
    for (const [re, what] of FORBIDDEN) {
      lines.forEach((ln, i) => {
        const m = re.exec(ln);
        if (m) problems.push(`${t.id}: ${what} "${m[0]}" (line ${i + 1} of the topic)`);
      });
    }
    for (const m of body.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1];
      if (/^https?:\/\//.test(href)) continue;
      let id = t.id;
      let anchor;
      if (href.startsWith('#')) anchor = href.slice(1);
      else if (href.startsWith('help:')) [id, anchor] = href.slice(5).split('#');
      else {
        problems.push(`${t.id}: unsupported link target "${href}"`);
        continue;
      }
      const target = byId.get(id);
      if (!target) problems.push(`${t.id}: link "${href}" points to a missing topic "${id}"`);
      else if (anchor && !(target.headings ?? []).some((h) => h.id === anchor))
        problems.push(`${t.id}: link "${href}" points to a missing section "${anchor}"`);
    }
  }
  return problems;
}
