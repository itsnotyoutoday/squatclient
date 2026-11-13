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
4. **Method names**: exactly as listed in note 4 (positional args). `Connect` takes `{worldId}` or `{host, port, tls}`; `Scrollback` takes `{beforeSeq?, limit}`; `Search` takes `{regex?, caseSensitive?}` and always returns an array. Squatter methods `PairSquatter`/`ConfirmSquatter` reject with "squatter connections are not available yet"; `ListSquatters`/`RemoveSquatter` work on the stored list.

New runtime events (additions to the contract):

| Event | Payload | Meaning |
|---|---|---|
| `session-removed` | `{id}` | a session was dismissed |
| `foreground` | `{session}` | a script/engine changed the foreground session (`/fg`, first session, fallback after dismiss). The UI's own `foreground()` calls are not echoed back |
| `reset` | `{session}` | the view filter (`/limit`) changed: drop the buffer and refetch `scrollback` |
| `menu` | `{action}` | native menu: `quick-connect`, `worlds`, `settings`, `search`, `help`, `close-session` |

Delivery: lines, gmcp, notices, bells and removals are never dropped and keep order; `session` and `status` events are coalesced per ~12 ms batch and sent after the batch's lines. A `/quit` from a script emits `quit` and closes the window.
