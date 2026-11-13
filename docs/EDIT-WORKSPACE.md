# Editor workspace (`/edit`): design spec

Status: phases 1 and 2 built 2026-11-13 (see "Implementation status" at the end); original note: approved by the owner 2026-11-13; build starts when the foundations land
(code editor: `frontend/src/components/codeeditor/**` + `frontend/src/lib/mushcode/**`;
engine capture/object API: `pkg/engine/capture*.go`, `mushobj*.go`, bound as `EditFetchObject`,
`EditFetchAttr`, `EditSaveAttr`; command window/history agent: `components/input/**`, `components/history/**`).

## 1. What it is

A full-window **Object Editor** (view) for working on game objects as if they were files. `/edit` (no arguments),
`/edit <dbref>`, `/edit <dbref/attr>`, the Cmd/Ctrl+E shortcut and an "Object Editor" button flip to it;
Cmd/Ctrl+E or Escape (when nothing is selected) flips back to the terminal. The game connection and
output keep running underneath. (Wails v2 is single-window, so this is a view, not a second window; a
detachable window can come later.)

```
[ startrekkin.net ]  [ other-game ]                         row 1: connected worlds (sessions)
 ┌ [ Command Console (#12) ] [ Nav Console (#13) ] [ + ]    row 2: objects open in that world
 │ ATTRIBUTES          │  &CMD_ENGAGE #12              ● unsaved   Revert  Save ⌘S
 │ filter…             │ ─────────────────────────────────────────────────────────
 │ ● CMD_ENGAGE        │  (CodeEditor: MUSH highlighting, bracket matching + warnings,
 │   FN_CHECKPOWER     │   line numbers, Expand/Collapse, search)
 │ 🔒 LOCKED_ATTR      │
 │   DESCRIBE          │ ─────────────────────────────────────────────────────────
 │ + new attribute     │  Problems (0)   Game: Set. ✓   Owner: Nveid   Flags: ...
 └─                    │
```

- **Row 1** shows connected sessions only (click to switch world). The terminal keeps its own tabs.
- **Row 2** is per world: one tab per open object, label `Name (#dbref)`, close buttons, drag to reorder,
  `[+]` asks for a target (`#123`, `me`, `here`, an object name; resolved through the game, see 4.1).
  A tab can open a specific attribute directly (`/edit #12/CMD_ENGAGE`).
- **Left pane**: attribute list for the selected object with a filter box; markers for modified (dot),
  saving (spinner), error (red), read-only/locked (lock), new (+); a "+ new attribute" row; list is
  virtualised (objects can have hundreds); keyboard: Up/Down, Enter opens, F2 rename (later).
- **Main pane**: `CodeEditor` for the selected attribute (one editor buffer per open attribute; switching
  attributes keeps unsaved buffers and undo history). Toolbar: Save, Revert, Expand/Collapse, wrap toggle,
  "show %r as line breaks" toggle (reversible), Compare (diff against the game's current value).
- **Bottom strip**: problems (bracket issues from the linter), last game reply, object info (owner, flags,
  whether you control it).
- Ctrl/Cmd-click on `u(#12/FN_X)`, `ufun(...)`, `get(#12/ATTR)`, `v()`/`xget()` style references jumps to that
  attribute (opens a tab for the object if needed).
- "Search all attributes" (Cmd/Ctrl+Shift+F in the view): searches values of every attribute of the
  current object (fetched lazily, cached) and lists hits.

## 2. State model (frontend, zustand store `editorStore`)

```ts
interface EditorWorkspace {                 // per world (session worldKey)
  objects: OpenObject[]; activeObject: string | null;
}
interface OpenObject {
  dbref: string; name?: string; owner?: string; flags?: string; type?: string;
  controls: boolean | 'unknown';            // does the user control it (4.2)
  attrs: AttrEntry[]; attrsLoadedAt?: number; activeAttr: string | null;
  buffers: Record<string, Buffer>;          // by attribute name
  loading: boolean; error?: string;
}
interface AttrEntry { name: string; flags?: string; writable: boolean | 'unknown'; }
interface Buffer {
  original: string;                         // value when opened/last saved (raw game text)
  text: string;                             // editor text (view form: %r shown as newlines if toggle on)
  dirty: boolean; saving: boolean; lastError?: string; lastReply?: string;
}
```

Persistence (localStorage, try/catch, per worldKey): open object tabs (dbref + name), active tab/attribute and
**unsaved buffers** (so a restart never loses work; clearly marked "restored draft"). Never persist anything
the game rejected as secret. Nothing is ever sent to the game by merely opening or switching tabs except
read-only fetches.

## 3. Engine API (bound methods; names fixed by `docs/EDIT.md` of the engine repo)

`EditFetchObject(sessionId, dbref)`, `EditFetchAttr(sessionId, dbref, attr)`, `EditSaveAttr(sessionId, dbref, attr, value)`.
The workspace work adds, in the same style (engine `mushobj*.go` + app `edit*.go`):
`EditResolve(sessionId, target)` (name / `me` / `here` / `#n` -> {dbref, name}), `EditControls(sessionId, dbref)` (4.2),
`EditAttrInfo(sessionId, dbref, attr)` (flags/owner when the game can tell: `examine`-style or
`lattr`+attribute flags functions, best effort). TS side: `EngineAPI` additions with MockEngine implementations
(a fake game with objects, attributes, permissions and a slow/error mode) so the whole view is testable without a server.

## 4. Behaviour

### 4.1 Opening
`[+]` / `/edit X`: resolve X (`EditResolve`), fetch object + attribute list, show a loading state, then select the
first attribute (or the one named). Errors (`no such object`, `permission denied to see it`) show inline on the tab
with Retry. Re-fetch on demand (refresh button) and when the world reconnects.

### 4.2 Permissions (must be clear and safe)
- On open, `EditControls` asks the game whether the user controls the object (PennMUSH-family `controls(me,<obj>)`;
  tolerant fallbacks; result `unknown` if the game cannot say).
- `controls == false`: the object opens **read-only** with a banner ("You do not control #12 (owner: X); editing is
  disabled. You can still read and copy."); Save is disabled, the editor is read-only, Copy/Compare still work.
- `unknown`: editable, but a banner says permissions could not be checked; the game decides on save.
- Attribute-level: attributes whose flags/locks indicate you cannot write (when `EditAttrInfo` can tell) show the lock icon
  and open read-only. Otherwise the game's reply on save is authoritative.
- **A rejected save never loses text**: the buffer stays dirty, the error is shown prominently (and in the tab/list marker),
  with the game's exact reply, and the Save button remains available. Recognised rejections: `#-1`, `Permission denied`,
  `You can't`, `I don't see that here`, `No such attribute`, (configurable list from the engine).

### 4.3 Saving (safe)
1. Re-read the attribute (`EditFetchAttr`). If it differs from `buffer.original` (changed by someone/something else since it
   was opened), stop and show a **conflict dialog** with a side-by-side diff and choices: Overwrite / Reload theirs /
   Keep editing.
2. Send `EditSaveAttr` (engine compresses real newlines to `%r` etc. per `ExpandEscapes/CompressEscapes` rules).
3. Re-read and compare with what was sent; show "Saved ✓" or a mismatch warning (the server may have altered the text).
4. Update `original`, clear dirty. Cmd/Ctrl+S saves the current attribute; Cmd/Ctrl+Shift+S saves all dirty attributes
   of the object. Unsaved buffers prompt on tab/view close.
Programmatic reads/writes are **never** recorded in command history or echoed to the terminal.

### 4.4 Formatting and the send rule
Expanded (indented) code is a *view*: the value sent to the game is always the collapsed single line
(`collapse()` from `lib/mushcode`), identical to the block-send join rule. A toggle remembers per attribute whether the
buffer is shown expanded. "Format" and "Collapse" never change meaning (reversibility is property-tested in the
mushcode library).

## 5. Keyboard and accessibility
Cmd/Ctrl+E toggle view; Cmd/Ctrl+S save; Cmd/Ctrl+Shift+S save all; Cmd/Ctrl+W close object tab; Cmd/Ctrl+T new
object tab (`[+]`); Cmd/Ctrl+1..9 switch object tabs; Alt+1..9 switch world (existing); Cmd/Ctrl+P quick-open attribute (fuzzy);
Ctrl/Cmd+click go-to-definition; Escape leaves the view when no dialog is open. All panes are keyboard reachable with
ARIA roles (tablist/tab/tabpanel, listbox for attributes), labelled, focus-visible, reduced-motion respected; screen-reader
mode announces save results and rejections.

## 6. Phases
1. **One object, done well**: view toggle, `/edit <dbref|dbref/attr>`, attribute list, CodeEditor buffer per attribute,
   permission banner/handling, safe save with conflict + verification, rejection handling, drafts persistence, MockEngine.
2. **Tabs**: multiple objects per world, multiple worlds, `[+]` flow, restore on restart, go-to-definition, quick-open.
3. **Richer object info**: flags/locks/owner/parent, create/delete/rename attributes, search across attributes, compare.
4. **Snippets and portability**: local snippet library with placeholders (`{{target}}` for dbrefs), insert-with-mapping,
   export/import portable packages for moving code between games (no dbref pasting).

## 7. Out of scope for the first cut
Object creation/destruction, flag/lock editing UI, exits/contents browser, version history. (All fit the same
workspace later.)

## 8. Implementation status (phases 1 and 2)

Built and covered by tests; **not verified against a real game or in the real window** (only jsdom and the
scripted fake MUSH in the engine tests). Phases 3 and 4 are not started except where noted.

Where things live:

| What | Where |
|---|---|
| view toggle (`uiStore.view`), `/edit` interception, Cmd/Ctrl-E, top-bar button | `state/stores.ts`, `lib/editor/command.ts` + `view.ts`, `components/input/InputLine.tsx` (`sendOne`), `global-keys.ts`, `components/tabs/TabBar.tsx`, `App.tsx` (lazy) |
| workspace state, open/save/conflict/search/persistence | `state/editorStore.ts` (zustand: `useEditor` data, `useEditorUi` transient UI) |
| pure libraries | `lib/editor/`: `escapes` (mirror of the engine), `serialize` (what is sent), `diff`, `refs` (go to definition), `fuzzy`, `search`, `validate`, `persist` |
| components | `components/editor/`: `EditorWorkspace`, `WorldTabs`, `ObjectTabs` (+ `[+]` prompt), `AttrList` (virtualised listbox), `AttrEditor`, `SearchPanel`, `EditorDialogs` (conflict, compare, quick-open, close confirm), `SideBySide` |
| styles | `styles/editorworkspace.css` (every class prefixed `ew-`) |
| fake game | `api/mock-game.ts` (`MockEngine.game`: latency, `rejectRate`, `failNext`, `alterOnSave`, `externalSet`, the `RACE` attribute that changes on every read) |
| engine/app | engine `pkg/engine/mushobj_ctl.go`; app `internal/app/edit2.go`, `app_edit2.go`; API shapes in `docs/EDIT.md` section 10 |

Decisions worth knowing:

- **Two views of one value.** The buffer is either `code` (the text is the stored value; newlines are formatting and the
  value sent is `collapse(text)`, spec 4.4) or `lines` (`%r`/`%t` shown as newlines; sent as `compressEscapes(text)`;
  no code formatting). Collapsing a `%r` newline would change meaning, so the two must never mix. Values the game stored
  with real newlines open in `lines`. Dirty = packed text differs from the stored value, so Expand alone never makes a buffer dirty.
- **Save = re-read, compare with `original`, `EditSaveAttr` (the engine verifies by reading back), mismatch -> re-read and keep dirty.**
  A rejected save never touches the text. The game's reply is shown with the engine's `engine: ...:` prefix stripped.
- **Per-session runtime state, per-world persistence**: workspaces are keyed by session id and stored under
  `squat.editor.v1.<worldKey>` (drafts, tabs, active attribute, view modes). Two sessions of the same world share the stored key (last writer wins).
- **Editors stay mounted (hidden) for the last 6 visited attributes** so undo history survives switching; older ones are
  re-created from the buffer text.
- **Cmd-W** is a native menu accelerator ("Close Session", `menu.go`): the webview never sees it on macOS. The `close-session`
  menu event is therefore routed to "close object tab" while the editor view is showing (`state/controller.ts`).
  TODO (needs Go menu code): a View > Editor item emitting `menu` action `editor` (already handled), and optionally a
  dedicated "Close Tab" accelerator.
- Cmd-click on macOS also adds a CodeMirror cursor; go to definition removes it again with `goTo`.

**Object details (phase 3, built).** The first entry of the attribute list, "Object details", shows identity, location,
relations, flags, powers, locks (with lock flags, a lock editor with a Test button), warnings (+ `@wcheck`), contents,
exits and a raw `examine` tab; a Move/Set home/Set destination dialog (search, nearby, recently used, look-around without
moving); an attribute context menu (flags, `@atrlock`, chown, rename, delete, copy, open). Code: `state/detailsStore.ts`,
`components/editor/{DetailsPane,PropWidgets,PlaceDialog,PickDialog,LockEditor,AttrMenu,AttrActionDialog,RawExamine}.tsx`,
`lib/editor/props.ts`, mock in `api/mock-game.ts`; engine/app API in `docs/EDIT.md` section 11. Real-WebKit check:
`npm run editor:probe`. "Open in a new tab" of an attribute opens it in the editor (tabs are per object).
Not verified against a live game: see EDIT.md section 11.

Not done: (attribute flags/locks/parent in the list are now done above; rename/delete attributes, richer object info; Compare and
search-across-attributes are done), phase 4, drag-reordering by keyboard, detachable window.
