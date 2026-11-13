# Help browser

`/help` (also F1, Cmd-?, the Help menu and the **?** button) opens an interactive help browser: topic tree,
Markdown pages, instant ranked search, history, table of contents and copy/insert buttons on code blocks.
Help is a **UI feature**: `/help ...` is intercepted in `InputLine` before text is sent to the engine (never
while a password is being typed), so it works in mock mode and with no session. `/help` opens Home;
`/help def`, `/help /def`, `/help expressions`, `/help triggers`, `/help keys` open that topic (TF-style
command and function names resolve through an alias map); other words open a search.

## Where things live

```
frontend/src/help/topics/*.md        authored topics (front matter: title, order, parent, keywords, aliases)
                                      file name = topic id; "__" in the name becomes "/" (squatter__routing.md = squatter/routing)
frontend/src/help/imported/*.md      copies of TF-LANGUAGE.md, TF-COMPAT.md, LUA-API.md from the ENGINE repo
frontend/src/help/build/             build-help.mjs (generator), extra-aliases.json (hand-curated alias -> topic)
frontend/src/help/generated/         topics.json + search-index.json  (COMMITTED, deterministic)
frontend/src/help/*.ts               lookup, search, render (marked + DOMPurify), store, command
frontend/src/components/help/        HelpBrowser, TopicTree, TopicPage, SearchResults
scripts/sync-help.sh                 copies the three engine docs into imported/ and rebuilds
```

## Single source of truth

The scripting and Lua docs are authoritative in `squatClientDaemon/docs`. Do not edit `imported/`; run

```
scripts/sync-help.sh [path-to-squatClientDaemon]    # default ../squatClientDaemon or $SQUAT_ENGINE_DIR
```

review the diff and commit. If the engine repo is absent the script keeps the committed copy.

`npm run help:build` (run by `predev`, `prebuild` and `pretest`) splits each imported file at its `##`
headings into one topic per section (`###` headings become anchors inside the page), derives an alias for
every command and function name it finds, and writes the generated files. **The generated files are
committed** so builds, CI and `wails build` need neither the engine checkout nor a manual step; the generator
is deterministic, so a clean build produces no diff. Imported topics are children of the hand-written hubs
`scripting`, `compat` and `lua`, which carry the TinyFugue/Ken Keys credit.

## Authoring

* Links between topics: `[text](help:topic-id)` or `[text](help:topic-id#heading-slug)`; `#slug` links stay on the page.
  A test checks that every link and anchor in every topic resolves.
* Heading slugs are lower-case with non-alphanumerics replaced by `-` (`/suspend and /detach` is `suspend-and-detach`).
* Do not use a level-1 heading; the title comes from the front matter.
* Code blocks automatically get **Copy** and **Insert into input** buttons (insert never sends).
* Keyboard shortcuts: the table in `topics/keys.md` must list every binding in `lib/keymap.ts` (enforced by a test).
* Content is rendered with `marked`, then sanitised with DOMPurify: only `http(s):`, `help:` and `#` links survive,
  scripts, event handlers, iframes and images are stripped. External links open in the system browser only.

## Search

A flat index of title, heading, keyword and body entries; every query word must occur in a topic (substring match);
weights title > heading > keyword > body, with bonuses for whole-word hits, entries that contain all words, exact
title matches and an exact command/function-name match.

## Tests

`tests/help.content.test.ts` (lookup, search ranking, links, credits, keymap sync, sanitisation),
`tests/help.store.test.ts` (history), `tests/help.ui.test.tsx` (`/help` interception, navigation, tree, links, insert).
