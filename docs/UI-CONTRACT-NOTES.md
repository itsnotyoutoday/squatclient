# UI-CONTRACT notes (ambiguities hit by the front end)

1. **Session removal event.** The contract has no event for a dismissed session. The UI removes a session locally after `dismiss()` resolves; other attached clients would not learn of it. Suggest a `session` event with a `removed` marker or a `session.removed` event.
2. **`endReason` type.** UI-CONTRACT says `string`, PROTOCOL.md lists an enum. The UI types it as `string` and humanises known values (`remote_closed`, `reset`, `timeout`, `tls_error`, `connect_failed`, `client_quit`, `squatter_stopped`), falling back to prettified text.
3. **"Connect again" needs a world.** `SessionInfo` has no `worldId`. The UI matches by `host`+`port` against `listWorlds()`; if none matches it connects with `{host, port, tls}`. Suggest adding `worldId?` to `SessionInfo`.
4. **Wails method names.** The WailsEngine calls `window.go.main.App.<Name>` with capitalised EngineAPI names: ListWorlds, SaveWorld, DeleteWorld, SetWorldPassword, GetSettings, SaveSettings, ListSquatters, PairSquatter, ConfirmSquatter, RemoveSquatter, Connect, Disconnect, Dismiss, ListSessions, Foreground, Input, Resize, Scrollback, Search, Ack. Arguments are passed positionally; `Connect` gets the target object, `Scrollback`/`Search` get the opts object. Events via `runtime.EventsOn(name)` with names `line session status notice bell gmcp quit`; payload is the first callback argument.
5. **Notices.** `notice` events are rendered as local system lines with a fractional `seq` (lastSeq + 0.001n) so they sort in place and never collide with engine seqs. If the engine also emits a `system` line for the same notice it would appear twice; decide which side owns it.
6. **Unread/ack.** The UI acks the highest integer seq of the foreground session (debounced 250 ms) only while not paused-scrolled-up, and relies on a `session` event for the new `unread`.
7. **Ctrl-F.** Emacs Ctrl-F (forward char) wins inside the input line. Search opens with Cmd-F / Ctrl-Shift-F anywhere, and Ctrl-F when focus is outside the input.
8. **Password input.** When `remoteEcho` is true the UI uses a masked `<input type=password>`, skips history and still sends via `input()`.
9. **`SearchHit`** has only `seq` and `preview`; the UI highlights matches itself in loaded lines and uses engine hits only for history older than the loaded buffer.
10. **`resize`** is sent (debounced) with measured cols/rows of the output pane using canvas text metrics.

## Decisions made by the Go side (internal/app, settled)

1. **Session removal**: after `dismiss` the app emits `session-removed` `{id}`. Coalesced `session` events are never emitted after it for that id. The UI also removes locally (idempotent).
3. **worldId**: `SessionInfo` now carries `worldId?` (absent for quick connects) and `via: "direct"`. "Connect again" matches by `worldId`, falling back to host+port.
5. **Notices**: notices that belong to a session (connect/end messages, script errors, `/echo`, unknown commands) are stored by the engine as `system` lines (they replay and have real seqs). The `notice` event is used ONLY for messages without a session (startup/script-load errors, auto-connect failures); the UI shows those as before. No duplication.
6. **Unread/ack**: the engine counts unread (non-prompt `game` lines since the last `ack`) for every session including the foreground one; `ack(id, seq)` takes an integer seq.
4. **Method names**: exactly as listed in note 4 (positional args). `Connect` takes `{worldId}` or `{host, port, tls}`; `Scrollback` takes `{beforeSeq?, limit}`; `Search` takes `{regex?, caseSensitive?}` and always returns an array. Squatter methods are real (see 7-12 below).

New runtime events (additions to the contract):

| Event | Payload | Meaning |
|---|---|---|
| `session-removed` | `{id}` | a session was dismissed |
| `foreground` | `{session}` | a script/engine changed the foreground session (`/fg`, first session, fallback after dismiss). The UI's own `foreground()` calls are not echoed back |
| `reset` | `{session}` | the view filter (`/limit`) changed: drop the buffer and refetch `scrollback` |
| `menu` | `{action}` | native menu: `quick-connect`, `worlds`, `settings`, `search`, `help`, `close-session` |
| `squatter` | `{id,name,host,port,state,problem?,message?,sessions,suspended?}` | a squatter's connection state changed. `state`: `idle connecting connected disconnected unreachable refused`; `problem` (with `refused`/`unreachable`): `fingerprint_mismatch auth_failed rate_limited unreachable connection_lost`; `message` is user-readable |
| `suspend` | `{suspended}` | `/suspend` detached the squatter sessions (true) / Resume re-attached them (false) |
| `away` | `{sessions:[{session,name,squatter,unread,ended,endReason?,endedAt?,lastText?}]}` | after (re)attaching to a squatter: sessions with unread output (and ended ones whose end was not acknowledged). The UI opens "While you were away" for the ids it knows |

Delivery: lines, gmcp, notices, bells and removals are never dropped and keep order; `session` and `status` events are coalesced per ~12 ms batch and sent after the batch's lines. A `/quit` from a script emits `quit` and closes the window.

## Squatters (remote daemon), added with the engine's RemoteSession

7. **Bound methods added**: `ReconnectSquatter(id)`, `Suspend() -> number` (sessions detached), `Resume()`. `ListSquatters()` now returns the SquatterConfig fields plus `state`, `problem?`, `message?`, `sessions` (all optional on the UI side).
8. **Pairing (trust on first use)**: `PairSquatter(host, port, name, code)` performs ONLY a TLS handshake and returns `{id, fingerprint}` (SHA-256, `AA:BB:..`); the code is kept in memory and is not sent. `ConfirmSquatter(id, true)` pins that fingerprint, creates the device key in the OS keychain (key `device-key`, never a file) if needed, connects sending the code, and stores the squatter with `paired: true`; failure removes the half-added entry and rejects with a readable message. `ConfirmSquatter(id, false)` forgets it (the code is never sent). The default squatterd port is 10327 (the dialog default).
9. **`SessionInfo`** gains `via` = the squatter id (still `"direct"` for direct sessions) and `link`: `attached | detached | unreachable` (squatter sessions only). Session ids of squatter sessions are `<squatterId>:<daemonSessionId>`. The status bar shows the link when it is not `attached`; the tab shows a badge. Sending while `detached`/`unreachable` prints a system line explaining it; nothing reconnects by itself (the Squatters dialog has a Reconnect button).
10. **`WorldConfig.via`** = a paired squatter id routes `connect({worldId})` through it (the login template is still run client-side with the keychain password). If that squatter is not connected, `connect()` makes one explicit connection attempt first.
11. **`/suspend` and `/detach`** (typed or the Session menu): squatter sessions are detached (the daemon keeps them running), the window is minimised by the app, `suspend {suspended:true}` is emitted and the status bar shows "Suspended - Resume". Direct sessions stay connected; with only direct sessions nothing is "suspended". `Resume()` re-attaches with `since`, replays what was missed (display effects only: replayed lines never fire triggers) and emits `away`.
12. **App start**: every paired squatter is connected once in the background (no retry loop); worlds with `autoConnect` that go through one wait for it. Closing the app only detaches from squatters; their sessions keep running.

## Command history and the command window

13. **History is per WORLD**: `recordHistory/history/deleteHistory/clearHistory` take a session id but act on that session's world (key = world id, else `host:port`), so all sessions of a world share it and it survives restarts. Stored by the Go app as `<config>/history/<key>.ndjson` (`{id, ts, text}` per line).
14. **`recordHistory`** is a silent no-op (resolves) when the session has `remoteEcho` (a password is being typed) or when any line is a password line per `engine.MaskSecret`. Such entries are SKIPPED, not stored masked. Blank text and an exact repeat of the newest entry are ignored. A block is recorded once (text with newlines).
15. **`history(sid, query, opts)`** returns newest first; `total` counts all matches, `limit`/`offset` page through them (default limit: all, max 50000). `regex` uses Go RE2 syntax; an invalid regex rejects with "invalid regular expression: ...". Empty query = everything.
16. **`Settings`** gains `inputHeight`, `editorHeight`, `softcodeJoin`, `stripBlankLines`, `sendLineDelayMs`, `historyMax`. `saveSettings` CLAMPS them (does not reject): heights 0..4000, delay 0..10000, historyMax 100..1000000 (0 becomes 100). Missing keys in an old settings.json get the defaults (0 / 240 / true / true / 0 / 20000). Lowering `historyMax` trims on the next write and at startup.
17. Draft text, the editor-mode flag and editor prefs (wrap, line numbers) are UI-only (localStorage), not part of the contract.
