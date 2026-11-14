# Squatter-side automation (design note)

Status: design only, nothing is built. Owner decisions recorded here.

## Goal

Let scripts (TinyFugue-style macros and Lua) run inside `squatterd`, so they keep working while no
client is attached, and so people who like TinyFugue-style automation can run it "whether I am there
or not". It is opt-in at every level.

## Placement, not mirroring

Each script has a **placement**: *client* or *squatter*.

- A client script runs in the app only (as today).
- A squatter script is uploaded to the squatterd and runs there all the time, attached or not. The
  client does not load it.

There is no state mirroring and no "pause when a client attaches": a script is in exactly one place,
so it cannot fire twice. (Mirroring the whole client environment was rejected: a sleeping laptop
cannot upload anything, scripts assume a UI, and two interpreters would have to behave identically.)

What a squatter script does is visible: its `/echo` output and the commands it sends appear in the
session output and scrollback like anything else, and every action goes into a journal that the
client shows.

## No shell, no files, no network: ever, on the squatterd

The squatter host of the interpreters provides only what a script needs to react to a game.

| Allowed | Forbidden |
| --- | --- |
| triggers, hooks (`CONNECT`, ...), macros, timers | shell and process commands (`/sh`, `/sys`, `/exec`, `/quote !`) |
| send to the script's own session | file access (`/load` of arbitrary paths, `/save`, `/log`, `/quote 'file`) |
| `/echo`, notify the user | connecting anywhere else (`/connect`, world operations) |
| a small, size-capped variable store | reading the environment, other sessions, other users' data |

- The TF interpreter (`pkg/tf`) has no shell access at all, and its `/restrict` levels already forbid
  file and world operations; the squatter runs at the strictest level and its host does not implement
  the process commands.
- Lua runs with `io`, `os`, `package`, `debug` and `dofile`/`loadfile` removed, no network.
- Scripts are uploaded as a bundle and stored by name; they never choose a path on the server.
- Limits: the existing step, time and depth limits, plus a cap on sends per second, a memory cap, and
  a per-script kill. Games that forbid unattended automation are the user's responsibility; the
  journal makes it auditable.
- Game passwords are never available to scripts and are never stored on the squatter.

## Opt-in controls

1. `squatterd --allow-automation` (off by default). Without it the squatter refuses script uploads.
2. A per-device permission: a paired device can be allowed to read sessions without being allowed to
   upload code.
3. A kill switch in the client turns all squatter automation off at once.

## Phases

1. **Notify-only triggers.** The squatter matches patterns (your name, a page, a staff line) and
   notifies you. It never sends commands. Proves script sync, storage, the journal and the opt-in.
2. **Squatter-placed scripts** (TF and Lua) with the locked-down host and the limits above.
3. **Client UI**: a "runs on: client / squatter" setting per script, a journal view, the kill switch.

## Open questions

- Which notification channel (desktop push via the app when attached; something else when not).
- Whether variables of squatter scripts are readable and editable from the client.
