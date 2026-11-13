# Editor workspace (`/edit`): design spec

Status: approved by the owner 2026-11-13; build starts when the foundations land
(code editor: `frontend/src/components/codeeditor/**` + `frontend/src/lib/mushcode/**`;
engine capture/object API: `pkg/engine/capture*.go`, `mushobj*.go`, bound as `EditFetchObject`,
`EditFetchAttr`, `EditSaveAttr`; command window/history agent: `components/input/**`, `components/history/**`).

## 1. What it is

A full-window **Editor view** for working on game objects as if they were files. `/edit` (no arguments),
`/edit <dbref>`, `/edit <dbref/attr>`, the Cmd/Ctrl+E shortcut and an "Editor" button flip to it;
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
