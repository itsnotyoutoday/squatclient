# SquatClient <-> gtf: findings

Test: `scripts/gtf-integration.sh` (`internal/app/gtf_integration_test.go`), run against a real gtf
(`/Users/rock/mush/squat/gtf` at b91ca9c, `main`, built with a working tree that had uncommitted
changes in `internal/client`), engine v0.0.10. Everything below was reproduced with that test.

Verified working end to end (no mismatch): pairing with the code and fingerprint read off gtf's
`/pair`, fingerprint equality, single-use code, role admin/operator/viewer, 8 features announced
(`noEcho tf control worlds state gmcp msdp tfexec`), sessions already open in gtf discovered and
replayed (colours, UTF-8, echoes of both sides, trigger output `[tf]`), live lines, prompts (GA)
shown once, `input()` raw (`%`, `;`, `/` untouched), a typed `/command` run in the session's world
with output returned, `tfExec` (ok and not-ok results), a remote `/def -t` trigger running in gtf
and answering the game, GMCP and MSDP in both directions (`GetSessionData` snapshot), ad hoc and by
reference connects started from the app, `noEcho` login (the password is in no scrollback and not on
gtf's screen), Suspend/Resume and an explicit reconnect with replay (each line exactly once), a kick
from gtf followed by the app's automatic reconnect and catch-up, the end of a session
(`remote_closed`), `/squatter unpair` followed by a refused reconnect with an explanation
(`auth_failed`, "Pair it again"). 668 frontend tests and all Go tests pass.

## Fixed in SquatClient (this branch)

| # | mismatch | fix |
|---|---|---|
| S1 | Saving a world with "connect via gtf" or connecting it posted two warnings every time ("TinyFugue was not updated: world.put is not supported by gtf", "Could not update ... connecting by address instead"): the app mirrors worlds into a TinyFugue squatter | squatter flavor `gtf` (picked in the dialog): no mirroring, connect by host and port |
| S2 | The Worlds dialog offered add/edit/delete and the Scripts dialog upload on gtf; all fail (`bad_request: ... not supported by gtf`) | gtf: list and Connect only; Scripts hidden |
| S3 | The status bar offered "Take the keyboard / Take over fully" for gtf sessions; gtf answers `control.set` with success and the unchanged state, so it looked like it worked and nothing changed | fixed text for gtf sessions; the automation choice is refused for gtf |
| S4 | A `viewer` device's input returned nil and the user saw only a late notice (`forbidden: your device role does not allow sending text`) | the engine refuses at once with a line naming the role (daemon `pkg/engine/remote.go`) |
| S5 | Tab menu "Rename (in TinyFugue)" fails on gtf (`world.rename`) | hidden for gtf; `RenameTFSession` explains |
| S6 | Add-a-squatter had no gtf path | Type "gtf (GoTinyFugue)": port 10328, host localhost, gtf wording, fingerprint comparison text |

## Open: gtf side (the lead applies; I did not touch gtf)

| # | severity | repro | expected | actual | owner |
|---|---|---|---|---|---|
| G1 | medium (leak) | Pair a device, connect any world in gtf, type `/squatter list` (or `/squatter`) in gtf | output of the squatter's own commands stays local: not in any session's scrollback | "squatter: listening ...", the TLS fingerprint, the state directory path, every paired device name with its device id and role, appear as lines of the foreground world and are replayed to every paired device including `viewer` ones (`/pair` is correctly kept out) | gtf (`internal/client/squatter.go`: do not tap output of `/squatter`, like `/pair`) |
| G2 | low | App connects a world "adhoc" through gtf (`session.connect` host+port, world name "adhoc") | the session/tab is named "adhoc" (or the request's `world.name`) | session and TF world are `(unnamed1)` (a temporary world); the tab shows `(unnamed1)` | gtf: use `world.name` as the temp world's name for the session; or SquatClient could rename locally (open decision, see below) |
| G3 | low | `/squatter unpair SquatClient on myhost` in gtf (SquatClient's default device name has spaces) | unpairs, or says which devices match | `usage: /squatter unpair <name>`; only an id prefix works (`/squatter unpair 8930b089`). Same for `kick`. The name is taken as one word, so the documented "by device name" never works for SquatClient | gtf: take the rest of the line as the name; report ambiguity. (SquatClient could also send a space-free device name: owner decision) |
| G4 | low | `world.put` / `world.delete` / `world.rename` / `tf.script.*` from the app | an error code the client can test (`unsupported`) and per-operation wording | all answer `bad_request: <op> is not supported by gtf (use tf.exec with /addworld, /undefn, /load)`, the same text for scripts (where `/addworld` is irrelevant) | gtf (the SWP-GTF extension is meant to add world.* from peers) |
| G5 | low | `/connect fake` in gtf, then look at `SessionInfo.tf` | `fg: true` for gtf's foreground world | `fg` is always false | gtf (`session`/`tf` info) |
| G6 | note | `control.set` input=remote / automation=client / preset takeover | by design (docs/SQUATTER.md): success, unchanged state. The app now hides these controls for gtf. Consider an explicit `unsupported` so other clients are not misled | | gtf, optional |
| G7 | docs | gtf `docs/SQUATTER.md` | says to add "a squatter of kind TinyFugue" and "Not tested against a real SquatClient" | now: type "gtf (GoTinyFugue)" and this test exists | gtf docs |
| G8 | note | gtf's welcome has `updateAvailable` and `reload`, and it sends `server.restarting` | SquatClient could use them (reconnect at once after `/restart`, "gtf update available") | SquatClient ignores them: the unknown fields are dropped, `server.restarting` arrives as an unhandled `wire.Ext` (harmless; the automatic reconnect covers a restart) | SquatClient, future; gtf side needs nothing |

## Open: SquatClient side, not fixed here

* No path to create a gtf world from the app (gtf has no `world.put`). Workaround: `tfExec` with
  `/addworld NAME HOST PORT`. Comes with the negotiated extension (hook described in
  GTF-INTEGRATION.md).
* The session name from G2: renaming locally would hide that gtf has `(unnamed1)`; left for the owner.
* `ListTFWorlds` shows gtf's temporary `(unnamedN)` worlds (flag `temp`), as it does for TinyFugue.

## Could not test

* The Wails GUI (headless): the dialog, status bar and tab menu changes are covered by the mock-engine
  UI tests (vitest, 668 pass) and tsc/eslint, not by a real window.
* A wrongly set `squatter_tls=off` (ws://) gtf; a non-loopback bind; a hot `/restart` of gtf
  (`server.restarting`); gtf's `squatter_commands=off` (admin `tf.exec` refused); the 5-failures
  rate limit; `squatter_scrollback` overflow (gap frames) against gtf.
