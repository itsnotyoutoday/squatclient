# APP: Go side of SquatClient

```
main.go / app.go / menu.go   Wails bootstrap, bound App methods (thin), native menu, window state
internal/app                 Service: EngineAPI -> pkg/engine, engine events -> UI events (batched); squatters.go = pairing, device key, suspend/resume
internal/config              worlds/settings/squatters/window JSON files, atomic writes, versioned
internal/secrets             go-keyring (MIT) keychain store + in-memory fake; no plaintext fallback
```

## Data and paths
* Config dir: `os.UserConfigDir()/SquatClient` (macOS `~/Library/Application Support/SquatClient`), files `worlds.json settings.json squatters.json window.json` (mode 0600, `version: 1`). Override with `SQUATCLIENT_CONFIG_DIR`.
* Scripts: `startup.tf`, `plugins/*.lua`, `logs/` live in the same directory (STRUCTURE.md: never write elsewhere); override with `SQUATCLIENT_SCRIPTS_DIR` (e.g. `~/.squatclient`).
* Game passwords: OS keychain, service `com.itsnotyoutoday.squatclient`, key `world:<id>`. `login.hasPassword` in worlds.json is only a flag. If the keychain fails, connecting to a world that needs a password fails with an error (never an empty password).
* Device key (ed25519 seed, base64): OS keychain, same service, key `device-key`; created on first pairing; never written to a file. If the keychain is unavailable pairing fails (no plaintext fallback).
* Squatters: `squatters.json` holds id, name, host, port, pinned TLS fingerprint and the `paired` flag only (never the pairing code or the key).
* Command history: `history/<worldKey>.ndjson` in the config dir (mode 0600), one `{id, ts, text}` per line; `<worldKey>` is `w-<worldId>` or `h-<host>:<port>` (file-name sanitised, hash suffix when sanitising changed it). Appends are single `O_APPEND` writes; deletes and cap compaction rewrite atomically (temp + fsync + rename); torn or corrupt lines are skipped on load. Capped at `settings.historyMax` (default 20,000, 100..1,000,000), oldest dropped first (in memory at once, on disk when the file exceeds the cap by 25% and at startup). Consecutive duplicates are collapsed; blank text is ignored. Password lines (`engine.MaskSecret`) and anything typed while the server has echo off are never stored: the entry is skipped entirely, not stored masked. Bound methods: `RecordHistory`, `History`, `DeleteHistory`, `ClearHistory`.
* Scrollback is memory-only (`settings.scrollbackLines` lines per session, applied at app start).

## Squatters (optional remote relay)

`squatterd` (from the squatClientDaemon repo) holds game connections so they survive the app closing; reattaching replays what you missed. The app works fully without it.

1. On the machine that should hold sessions: `make build` in squatClientDaemon, then `./squatterd serve` (default port 10327, TLS with a self-signed certificate; `--bind 127.0.0.1` for local-only, `--data-dir`).
2. `./squatterd pair` prints a single-use 10-minute pairing code and the server's TLS fingerprint.
3. In the app: cloud button -> Squatters -> Name, Host, Port, Pair code -> **Pair**. The app connects, reads the certificate fingerprint WITHOUT sending the code, and shows it. Compare it with the one `squatterd pair` printed; only then click **Trust and pair**. The fingerprint is pinned: a changed certificate later is refused with a clear message (no silent re-trust).
4. In a world's settings choose that squatter in "Connect via". Connecting such a world makes the squatter open the game connection; the login (character + keychain password) is sent by the app, the squatter stores no passwords.
5. Close the app: sessions keep running. Start it: the squatter reconnects once, sessions reappear, what was missed is replayed (gag/hilite apply, triggers do not fire) and "While you were away" lists unread output and ended sessions with their reason.
6. `/suspend` (or Session -> Suspend) detaches from the squatter and minimises the window; **Resume** (status bar or Session menu) re-attaches. For direct connections `/suspend` only minimises.
7. Status: the status bar shows `Detached` / `Squatter unreachable`; sessions never reconnect by themselves, use Reconnect in the Squatters dialog. `squatterd revoke <deviceId>` removes this device on the server.

Known limitation: the squatter records an echo line for what the app sends, and masks it only while the game has turned echo off. A `connect name password` login line therefore appears in clear in the squatter's history (it needs a daemon `send` option to suppress echo). Use a squatter you control.

## Window (ADR 0002)
macOS: `TitleBarHiddenInset`, dark appearance, background `#14161a`; the front end shows a 28px draggable strip (`--wails-draggable: drag`) only under `html.mac-titlebar` (set when Wails + macOS are detected). Other platforms keep the native frame. Min size 700x420; size/position are saved on close and restored. Native menu: App (About/Hide/Quit), Session (New Connection Cmd-N, Worlds Cmd-O, Settings Cmd-, , Suspend Cmd-Shift-D, Resume Cmd-Shift-R, Close Session Cmd-W), Edit, View, Window, Help.

## Build / run
```
make build     # npm install if needed, npm run build, wails build -> build/bin/squatclient.app
make dev       # wails dev
make test      # go test -race ./... + vitest
make lint      # gofmt, go vet, staticcheck, tsc, eslint
open build/bin/squatclient.app
```
`go.mod` has `replace github.com/itsnotyoutoday/squatClientDaemon => ../squatClientDaemon` (Wails runs `go mod tidy`, which ignores go.work); drop it once the engine is tagged. Regenerate the icon with `make icon`.

## Command window (front end)
* **Resize**: a drag handle on the top edge of the input (also a keyboard separator: Up/Down one line, PageUp/PageDown five, Home tallest, End smallest; double-click resets). Height is clamped from one line to 70% of the window and stored in `settings.inputHeight` (single line; 0 = automatic, grows to 8 lines) or `settings.editorHeight` (editor mode, default 240).
* **Editor mode** (button, Cmd/Ctrl+Shift+E; Escape returns to one line and keeps the text, unless the editor's search panel is open, which Escape closes first): the large editor is the lazy-loaded CodeMirror `LazyCodeEditor` (docs/EDITOR.md), so CodeMirror stays out of the main bundle until the first use. MUSH highlighting, bracket matching, auto-close of `( [ {`, balance lint underlines (the toolbar shows the count), line numbers and Wrap toggles (remembered in localStorage `squat.editor.prefs`), search/replace on Cmd/Ctrl+F, undo/redo, Tab/Shift+Tab indent by two spaces, and toolbar buttons Expand and Collapse (the reversible `lib/mushcode/format` commands, on the selection or the whole buffer). Enter = newline (with the editor's auto-indent), Cmd/Ctrl+Enter sends the buffer, Cmd/Ctrl+Shift+Enter sends the selection or the current logical line. `components/input/EditorPane.tsx` is the toolbar + editor; `InputLine.tsx` owns the text (`st.text`), drafts and sending.
* **Unbalanced-bracket check**: before sending from the editor (buffer, selection or line) the code is checked with `checkBalance` (mode `code`); with `settings.warnUnbalanced` (default on) a confirm lists the line numbers (numbered by the editor, also for a selection): **Fix first** (nothing is sent, the cursor goes to the first problem via `CodeEditorHandle.goTo`) or **Send anyway**. Single-line input, password input and history re-sends are not checked.
* **Global Cmd/Ctrl+F**: `global-keys.ts` does not handle the search shortcuts when the event comes from inside `.cm-editor`, so the editor's own search opens instead of the output search.
* **Block rules** (`frontend/src/lib/softcode.ts`, pure and unit-tested): CRLF/CR/LF end lines; trailing whitespace is removed; with `stripBlankLines` blank lines and `@@` comment-only lines are dropped BEFORE joining; with `softcodeJoin` a line starting with a space or tab is appended DIRECTLY (no space inserted) to the previous sent line after removing its leading whitespace; with blank lines kept, an empty line ends a continuation. Each resulting line goes to `engine.input` separately; `sendLineDelayMs > 0` paces them with a progress indicator and Cancel (lines already sent cannot be recalled).
* **Drafts**: the editor flag and unsent editor (or multi-line) text are kept per world in localStorage (`squat.input.<worldKey>`), restored on tab switches and restarts. Password input has its own state and is never drafted.
* **`/upload`** (`frontend/src/lib/upload/`, `frontend/src/components/upload/`; Go in `internal/app/files.go`, `app_files.go`): `/upload` opens the native picker (`PickFile`), `/upload <path>` uses the path (`~/` ok, quotes ok), and a text file dropped on the window opens it too (`FileReader`, `lib/upload/decode.ts`, same rules as Go). The upload dialog (never sends anything until Send) shows file name, size, line count, a virtualised numbered preview with a second tab for the prepared commands, options initialised from settings (join continuation lines, skip blank/`@@` lines, delay per line = `sendLineDelayMs` or 50 ms when that is 0, an optional prefix per command), the target session (the foreground world when the upload started; Send is disabled when it is not connected), a bracket-balance warning (first five problems; the button becomes "Send anyway"), then progress (bar, current line, elapsed), Pause/Resume/Cancel (`lib/blocksender.ts` gained `pause/resume` and `batch` chunking, so 100k+ lines never freeze the UI) and a final summary (sent N, skipped M, cancelled at command K). Closing the dialog while sending cancels the rest. History gets ONE entry `/upload <file name>`.
  * `ReadTextFile` safety: absolute or `~/` paths only; regular files only (symlinks followed, devices/pipes/sockets/directories refused before opening); 5 MiB cap (`MaxUploadBytes`); binary refused (NUL bytes, more than 2% control characters, more than 20% invalid UTF-8); UTF-8 (BOM stripped) with Latin-1 fallback; CRLF/CR become LF; errors are returned inside the result. The picker starts in the last used folder (`<config>/files.json`).
* **History browser**: Ctrl+R / Cmd+Shift+H or the History button; virtualised, paged (300 per request), newest first.
