// Extracts MUSH function names (names only) from the game's help files and writes
// src/lib/mushcode/functions.generated.json (sorted, deduplicated, with the source files recorded).
//
// Usage:  node scripts/gen-mush-functions.mjs [helpDir]
//   helpDir defaults to $MUSH_HELP_DIR or <game>/game/txt/hlp
// If the directory (or any *.hlp file in it) is missing, the committed JSON is left untouched.
//
// What counts as a function name:
//   1. help topic headings of the form `& NAME()` (e.g. `& ADD()`), and
//   2. tokens `name()` on category listing lines that contain nothing but such tokens (the
//      "Math functions" style topics), which also catches functions documented under a shared heading.
// Only names matching [A-Za-z_][A-Za-z0-9_]* are kept (that is what the tokenizer can recognise).
// pennv*.hlp are change logs and contribute nothing; they are scanned anyway so new help layouts work.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/lib/mushcode/functions.generated.json');
const dir = process.argv[2] ?? process.env.MUSH_HELP_DIR ?? '<game>/game/txt/hlp';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADING = /^&\s*([^\s()]+)\(\)\s*$/;
const LISTING = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*\(\)\s*)+$/;

/** Pure extraction, exported for tests. Returns names (lowercase, unsorted). */
export function extractNames(text) {
  const out = new Set();
  for (const line of text.split(/\r?\n/)) {
    const h = HEADING.exec(line);
    if (h) {
      if (NAME.test(h[1])) out.add(h[1].toLowerCase());
      continue;
    }
    if (LISTING.test(line)) {
      for (const m of line.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\(\)/g)) out.add(m[1].toLowerCase());
    }
  }
  return out;
}

function main() {
  if (!existsSync(dir)) {
    console.log(`gen-mush-functions: ${dir} not found; keeping the committed ${OUT}`);
    return;
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.hlp'))
    .sort();
  if (files.length === 0) {
    console.log(`gen-mush-functions: no .hlp files in ${dir}; keeping the committed JSON`);
    return;
  }
  const all = new Set();
  const sources = [];
  for (const f of files) {
    const names = extractNames(readFileSync(join(dir, f), 'utf8'));
    if (names.size === 0) continue;
    sources.push(f);
    for (const n of names) all.add(n);
  }
  const functions = [...all].sort();
  const json = { generatedBy: 'scripts/gen-mush-functions.mjs', sources, count: functions.length, functions };
  writeFileSync(OUT, JSON.stringify(json, null, 2) + '\n');
  console.log(`gen-mush-functions: ${functions.length} functions from ${sources.join(', ')} -> ${OUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
