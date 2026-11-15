# Diagnostics log

SquatClient writes one redacted, timestamped timeline of the whole session so a problem can be found without guessing. This page is the maintainers' reference; the user's version is the help topic "Sending a diagnostics log".

## Policy (build time)

`-X main.diagnosticsMode=always|optin|off` (the Makefile default is `always`; the release workflow sets `always` for the alpha):

| mode     | behaviour |
| -------- | --------- |
| `always` | on from the first start; stays on at every start unless the user turned it off in the dialog (that choice persists in `diagnostics.json` in the config folder) |
| `optin`  | off until the user turns it on; the choice persists |
| `off`    | compiled out: no logger, no files, no Help menu entry, the Wails methods refuse |

Other build constants (all `-X main.<name>=...`, defaults in `app_dlog.go`, mirrored by Makefile variables `DIAG_MODE`, `REPO_SLUG`, `CONTACT_NAME`, `CONTACT_HOST`, `CONTACT_PORT`):

- `repoSlug` (default `itsnotyoutoday/squatclient`): where the issue form is opened.
- `contactName`, `contactHost`, `contactPort` (default Nveid, startrekkin.net, 1701): who arranges a private delivery. There is no email address anywhere in the app.

## Where it lives

`<config>/diagnostics/<session-id>/` holds `current.log` and gzip segments `001.log.gz`, `002.log.gz`... (files are `0600`). The writer (`internal/dlog`) is one goroutine fed by a bounded queue: logging never blocks the caller, and a full queue is counted and reported as a `[diag] N lines dropped` line. The buffer reaches the disk every second, on every `[error]` line, on `Flush`, and at exit.

Retention: at start every session older than the previous one is deleted (a crash's leftover `current.log` is sealed into a segment). A segment closes at 20 MB. If the current and previous session together exceed 100 MB, the previous session's oldest segments go first, then the current session's. Nothing else is capped: there is no line limit anywhere.

## Line format

```
2026-11-15 12:00:00.123 [layer] sid=s2 tab="World name" text
```

Layers: `ui`, `web-audio`, `engine`, `cmcp`, `sound`, `packs`, `net`, `settings`, `session`, `snapshot`, `error`, `diag`.

One Sound.Play carries an id (`ev=e12`): `wire` (what the game sent) -> `resolved` -> `emitted cmcp-audio` (Go) -> `received` -> `playing` or `dropped <reason with the compared values, e.g. session=s2 fg=s1>` -> `ended` (web).

Control-plane payloads (`Cobra.*`, `Sound.*`, `Core.*`, both directions) are logged in full. The high-volume streams (`Space.*`, `Crew.*`, `Mission.*`, `Cobra.Ship.Status`, `Cobra.Pulse`, `Cobra.Ping`) become one `stream` counter line per package every 5 s (count, bytes, last seq); a full document, a resync or an error is still logged in full.

Also logged: UI events (tab switches with old/new foreground and session ids, mute clicks with before/after, dialogs, screen menu choices, X/close, SCREEN OFF), settings changes (key, old, new; secret-named keys are not logged), world saves, connects, disconnects and every session state change, errors (`window.onerror`, unhandled rejections, `console.error`/`warn` with stack, Go panics recovered at the event pump with their stack, failed Service calls), the environment header (build, mode, OS, arch, Go, WebView and display, audio decode support, shared core version), a "sound path check" line, and snapshots: at start, on request, when logging is switched on, and every 30 s while connected (one line per session: world, host:port, state, foreground, effective mute, CMCP state, ship, aboard, console, context stack, screen, alert, theme, notice, pack store hits and misses; plus the page's tabs and audio engine state).

## Redaction

`internal/dlog/redact.go`, applied when a line is written and again when a zip is built: `connect|create <name> <password>`, `/pair` and pairing codes, TinyFugue `/world` and `/addworld` arguments, `login` blocks of worlds.json, authorization headers, `password`/`token`/`secret`/`key`-style fields, "password is ...", `user:password@` in URLs and long key-like tokens (content hashes are kept). The page repeats the main rules for anything that goes into an issue address (`frontend/src/lib/diaglog.ts`).

## Sending (never automatic)

Help > Send Diagnostics Log... is a four-step walkthrough: what is included (sessions, sizes, redaction count, the game-text warning, a note, "current session only"), save the zip (`squatclient-diagnostics-<build>-<date>.zip` in Downloads or a Save As choice, path and size shown, "Show in folder"), open the prefilled GitHub issue form (`.github/ISSUE_TEMPLATE/diagnostics.yml`; the address carries only title, build, OS, mode, the last error lines and the note, at most 1800 characters; the log is never in it), and optionally delete the zip. Nothing is uploaded: the app only opens the browser and reveals the file. The repository is public, so the dialog warns, and offers the private route (contact constants above).

## Tests

`internal/dlog` (redaction, rollover, retention, budget, non-blocking, mode matrix, zip content), `internal/app/diaglog_test.go` (modes and persistence, clear, the mute/tab timeline, settings changes without secrets, zip without secrets, delete only our zips), `issue_template_test.go` (the template), `frontend/tests/diaglog.test.tsx` (steps, URL builder, dialog), `pkg/engine` `TestCmcpTrailSummarizesStreams`.
