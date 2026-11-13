# Softcode editor foundation

Reusable pieces for editing MUSH softcode (PennMUSH / TinyMUX / CobraMUSH family): a pure library
(`frontend/src/lib/mushcode`) and a CodeMirror 6 component (`frontend/src/components/codeeditor`).
Planned consumers: the command window's editor mode, a `/edit <dbref/attr>` attribute-editor window,
and a snippets library.

Everything here is a **tolerant approximation**, built for highlighting, bracket help and reversible
formatting. It is not a server-exact parser: servers differ (and games add functions), so nothing in
this code ever refuses or rewrites input it does not understand.

## 1. Syntax model (tokenizer)

`tokenize(code)` returns tokens `{kind, start, end, text}`. It never throws and the tokens always
tile the input (`tokens.map(t => t.text).join('') === code`); this is fuzz-tested.

| kind                           | what it matches                                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `function` / `unknownFunction` | identifier `[A-Za-z_][A-Za-z0-9_]*` directly followed by `(` (the name only; `(` is a `paren` token). Known = in the generated function list, case-insensitive                                                            |
| `bracket` `brace` `paren`      | `[ ]`, `{ }`, `( )`                                                                                                                                                                                                       |
| `comma` `semicolon`            | `,` `;`                                                                                                                                                                                                                   |
| `substitution`                 | `%0`-`%9`, `%#`, `%!`, `%@`, `%N %n %L %l %c %C`, `%q0`-`%qz`, `%q<name>`, `%r %b %t %s %\|`, `%=<attr>`, `%va`-`%vz`, `%i0`, `%xr`, `%x<...>`, `%%`, `%+`, `%$` and any other `%` + one character; also `##`, `#@`, `#$` |
| `escape`                       | `\` + one character, and `%(` `%)` `%[` `%]` `%{` `%}` `%,` `%;` (escaped structure)                                                                                                                                      |
| `number`                       | `-?\d+(\.\d+)?` at a word boundary                                                                                                                                                                                        |
| `dbref`                        | `#123`, `#-1`, `#lambda`                                                                                                                                                                                                  |
| `attrdef`                      | `&ATTR` at the start of a line                                                                                                                                                                                            |
| `command`                      | `@word` (with `/switches`) at a _command position_                                                                                                                                                                        |
| `pattern`                      | `$`/`^` pattern from the sigil through the first unescaped `:`, at the start of a line or after `=`                                                                                                                       |
| `comment`                      | `@@` at a command position, to the end of the line                                                                                                                                                                        |
| `text`                         | everything else                                                                                                                                                                                                           |

Command position = start of a line, or after `;`, `{`, `,`, `=`, or directly after a `$`/`^` pattern.

### Limits (known, deliberate)

- No evaluation model: text inside `{ }` is tokenized like any other text (functions in braces are
  still coloured), and the tokenizer does not know which arguments a function evaluates.
- `@` words outside a command position (`say meet @home`) are plain text; `@word` after other
  characters (`think x @set`) is not recognised as a command.
- Bare commands (`think`, `say`, `+who`) are not highlighted; only `@`-commands and `&`.
- `%c` is always the 2-character "last command" substitution; MUX colour codes `%cr` are `%c` + `r`.
  `%x`/`%X` colour codes are handled (`%xr`, `%x<name>`).
- Function names with characters outside `[A-Za-z0-9_]` (for example `@@()`) are not recognised.
- An identifier before `(` in prose (`Hello(there)`) is coloured as an unknown function.
- `$`/`^` patterns need a `:` on the same line; otherwise the sigil is plain text.
- Lines: `\n`, `\r\n`. A lone `\r` is treated as ordinary text by the formatter.
- Unknown (custom/global) functions get the `mc-function-unknown` style (dotted underline): a soft
  hint, never an error, because games add functions with `@function`.

## 2. Function names

`npm run gen:functions` (`frontend/scripts/gen-mush-functions.mjs`, not hooked into the build) reads
`<game>/game/txt/hlp/*.hlp` (override: first argument or `$MUSH_HELP_DIR`)
and writes the committed `src/lib/mushcode/functions.generated.json` (sorted, deduplicated, lowercase,
plus the list of source files). Names come from `& NAME()` help topic headings and from category
listing lines made only of `name()` tokens. If the directory is missing the committed file is kept.
The `penn*.hlp` files in that directory are change logs and contribute nothing.

## 3. Bracket balance (`balance.ts`)

`checkBalance(code, {mode})` returns `[{kind, index, line, col, expected?, message}]` for `()`, `[]`, `{}`.

- Kinds: `unclosed` (opener never closed), `unmatched` (closer with no opener), `mismatch` (closer
  that matches a deeper opener, e.g. `[add(1,2]`; reported once, at the closer).
- `\x` and `%(`-style escapes never count. Brackets inside `$`/`^` patterns and `@@` comments do not
  count either (they come from the tokenizer).
- `mode: 'lenient'` is for text that mixes prose and code: a `(` that is not a function call is never
  reported, and a `)` with no function call or `[` around it (smileys, "(see below)") is tolerated.
  Real code problems are still reported. Default is `'code'`.
- `matchBracketAt(code, index)` gives `{open, close}` for the pair at the cursor (char after the cursor
  first, then the one before), or `null`.

## 4. Expand / collapse (`format.ts`)

The send-side convention this relies on: **a line that starts with whitespace continues the previous
line** (its leading whitespace is removed, nothing is inserted).

- `expand(code, {indent = 2, maxInline = 60})`: every logical line (a line plus its continuation lines)
  is joined and then rewritten. A function call whose single-line source is longer than `maxInline` is
  broken: newline + indent after `(` and after each argument-separating comma, and the closing `)` on
  its own line. Nothing else changes. Nested calls are broken by the same rule at deeper indent.
- Never broken: anything inside `{ }`, escapes, substitutions, `$`/`^` patterns, comments, unbalanced
  code, and calls that fit in `maxInline`.
- All continuation lines are indented by at least one level (the outermost call's closing `)` sits one
  level in), so every continuation line starts with whitespace and the block collapses when sent.
- A space that followed `(` or a comma stays at the end of the previous line (`a, `) so that
  `collapse` restores the text byte for byte.
- `collapse(text)` removes every newline and the whitespace after it. Identity on single-line text.
- `joinContinuations(text)` is the send-side rule: only newlines followed by whitespace are removed;
  other lines stay separate commands. It does **not** trim trailing whitespace (see warning below).

Guarantees (property-tested on thousands of random softcode strings): `collapse(expand(x)) === x`
for single-line `x`; `expand` is idempotent (also `expand(collapse(expand(x))) === expand(x)`); only a
newline plus spaces is ever inserted, never inside braces, after a backslash or inside a `%`
substitution. The rule is lossy only for whitespace that deliberately starts a continuation line (it is
indistinguishable from indentation).

Warning for senders: `lib/softcode.ts prepareBlock` trims trailing whitespace of every line before
joining. Expanded code can contain `a, ` + newline; the trimmed space after a comma is harmless for
most MUSH functions (argument leading space is normally stripped) but is not byte-exact. If exactness
matters, send with `joinContinuations`.

## 5. `CodeEditor` component

```tsx
import { LazyCodeEditor } from './components/codeeditor';   // CodeMirror-free entry
<LazyCodeEditor ref={handle} value={text} onChange={setText} wrap lineNumbers
  onSend={(t) => ...} onSendLine={(t) => ...} onIssues={(i) => ...} onCursor={(c) => ...}
  height={240} ariaLabel="Attribute value" balanceMode="code" />
```

Props: `value onChange readOnly wrap lineNumbers onSendLine onSend autoFocus height ariaLabel` plus
`balanceMode ('code'|'lenient')`, `onIssues`, `onCursor`, `className`. `autoFocus` focuses on mount. Handle: `focus getValue setValue
insertAtCursor getSelection getCursor getIssues expand collapse`.

Import `CodeEditor` itself (and `expandSelection` / `collapseSelection` from `./commands`) only from
code that is already lazily loaded; `index.ts` deliberately exports just `LazyCodeEditor` and types.

Keys (inside the editor only): `Mod-Alt-]` expand, `Mod-Alt-[` collapse (selection, or the whole
document; with no selection collapse uses `joinContinuations` so separate commands are not merged),
`Mod-Enter` onSend (selection or everything), `Mod-Shift-Enter` onSendLine (selection, or the logical
line with its continuation lines), `Mod-F` search/replace panel (the handler prevents the browser/app
default only while the editor has focus), `Tab`/`Shift-Tab` indent by 2 spaces, undo/redo, bracket
auto-close for `( [ {` only (no quote pairing: apostrophes are everywhere in MUSH text).
Accessibility: `role=textbox`, `aria-multiline`, `aria-label`; `Escape` never traps focus, and
`Escape` then `Tab` moves focus out instead of indenting. Cursor blink is disabled and CSS animations
are removed under `prefers-reduced-motion`.

Rendering is theme-driven (`src/styles/codeeditor.css`): editor colours come from `--bg --fg --font
--selection --cursor --ui-*`; token colours are `--mc-*` variables derived from `--ansi-N` (bright
half on dark themes, normal half when `color-scheme: light`). `tests/codeeditor.theme.test.ts` checks
every token colour for >= 4.5:1 contrast on the three built-in themes. Highlighting is a ViewPlugin
driven by `tokenize` (no Lezer grammar), skipped above 300k characters.

## 6. Tests

`tests/mushcode.*.test.ts` (tokenizer classes and fuzz, balance tables, matchBracketAt, format unit and
property tests, function list), `tests/codeeditor.test.tsx` (component in jsdom, lazy wrapper),
`tests/codeeditor.theme.test.ts` (contrast).
