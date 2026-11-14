# gtf (GoTinyFugue) as a squatter

gtf has a squatter built into its process (`/set squatter=on`, gtf `docs/SQUATTER.md`). It speaks
tf-squatterd's protocol (SWP v1, kind `tf-squatterd`, path `/tfsp`), so SquatClient reuses its
TinyFugue squatter code. What is different is recorded as **flavor `gtf`** on the squatter record
(`config.Squatter.Flavor`).

## Adding it

Squatters dialog > Add a squatter > Type: **gtf (GoTinyFugue)**. The type fills host `localhost` and
port `10328`. In gtf: `/set squatter=on` (or in `.tfrc`), then `/pair`; enter the code, compare the
fingerprint SquatClient shows with the one `/pair` printed (also `/squatter fingerprint`), Trust and
pair. The code is single use. `/squatter unpair ID` in gtf revokes the device (use the id prefix from
`/squatter list`; see GTF-INTEGRATION-FINDINGS.md for names).

API: `pairSquatter(host, port, name, code, "gtf")` stores `kind: "tf-squatterd", flavor: "gtf"`.
`SquatterConfig.flavor` reaches the UI.

## What the app does differently for flavor gtf

| area | tf-squatterd (TinyFugue) | gtf |
|---|---|---|
| worlds of this app routed through it | mirrored into TinyFugue (`world.put`), connect by record | not mirrored (gtf has no `world.put`); connect by host and port |
| "Worlds..." | list, add, edit, delete | list and Connect only; edit in gtf |
| "Scripts..." | upload, list, delete | hidden (gtf has no `tf.script.*`; use `tf.exec` with `/load`) |
| automation (triggers run in TF / this app) | choice | none: gtf always runs its own; the choice is refused |
| control presets (keyboard/triggers) | status bar menu | fixed text: both type, gtf runs triggers |
| rename a tab's world in TinyFugue | yes | no (rename in gtf) |
| role `viewer` typing | the squatter refuses | the app refuses at once with a line saying so |

Everything else is the same: sessions, scrollback replay and reconnect since a sequence number,
live lines, `input()`, `/commands` typed from the app (run in gtf, output returned), `tfExec`,
GMCP/MSDP, `noEcho` logins, revoked devices.

## Test against the real gtf

`internal/app/gtf_integration_test.go` runs a real gtf under a pty (scratch HOME,
`/set squatter=on`, port 0), reads the pairing code and fingerprint off its screen like a user, and
drives the app's own `Service` (the code the Squatters dialog calls). Skipped without `GTF_BIN`.

    scripts/gtf-integration.sh                       # builds gtf from ../gtf (GTF_SRC) and runs it
    GTF_BIN=/path/to/gtf scripts/gtf-integration.sh

Findings: `GTF-INTEGRATION-FINDINGS.md`.

## Negotiated protocol extensions (hook, nothing negotiated yet)

A gtf protocol extension (shared world editing, presence, per-line author, macro sync ...) is
being specified separately. The connection layer is ready for it without implementing any of it:

- `wire.ClientOptions.Offer` / `Hello.Offer`: the extension names announced in hello (empty: the
  field is omitted, so existing servers see no change).
- `Welcome.Negotiated` -> `wire.Client.Negotiated()` / `HasNegotiated(name)`: what the server
  accepted (never more than offered).
- `wire.Client.SendExt` / `RequestExt`: extension messages, refused until something is negotiated;
  incoming messages of unknown types already arrive as the `wire.Ext` event.
- `engine.Engine.RegisterExtension(engine.Extension)`: a feature registers its name; the engine
  offers it on every squatter connect, calls `Negotiated(squatterID, client)` per connection and
  `Message(squatterID, ext)` for its messages. `SquatterInfo.Negotiated` shows the result.
- The field names `offer` / `negotiated` are placeholders until gtf's `docs/SWP-GTF.md` fixes the
  handshake; only `pkg/wire/ext.go` and the two struct fields in `pkg/wire/msgs.go` (daemon repo)
  change then. Today gtf ignores the unknown hello field (tested).
