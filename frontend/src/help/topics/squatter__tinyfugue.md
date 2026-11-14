---
title: TinyFugue as a squatter
parent: squatter
order: 2
keywords: tinyfugue, tf, squat, tf-squatterd, control, keyboard, takeover, triggers, automation, gag, gmcp, msdp, worlds, remote
aliases: tinyfugue, tf, tf-squatterd, takeover, copilot, control
---

If you already run **TinyFugue** (TF) on a server, it can act as your squatter. You see all of its connections in SquatClient, read their history and type into them, while TinyFugue keeps running its own triggers and macros.

## Setting it up

1. In TinyFugue (built with the squat support) run `/squat start`, then `/squat pair`. It prints a one-time **pairing code** and its **fingerprint**.
2. In SquatClient open the Squatters dialog, choose **Add a squatter**, set **Type** to **TinyFugue**, and enter the host, the port (10328 unless you changed it) and the code.
3. Compare the fingerprint, then press **Trust and pair**.

A TinyFugue squatter and a `squatterd` use different ports and different protocol paths. If you pick the wrong Type, SquatClient says so and nothing is sent to the server.

## Who has the keyboard

Every TinyFugue connection shows a badge on its tab and a **Keyboard** control in the status bar:

| Choice | Keyboard | Triggers and macros |
| --- | --- | --- |
| **Watch only** | TinyFugue | TinyFugue |
| **Type too** | both of you | TinyFugue |
| **Take the keyboard** | only SquatClient | TinyFugue |
| **Take over fully** | only SquatClient | SquatClient |

While TinyFugue keeps the keyboard, the input line is disabled and says so. If TinyFugue is set to ask first (`squat_takeover=ask`), the change waits until its user allows it and you see a message meanwhile.

Triggers run in only one place at a time, so nothing fires twice. By default TinyFugue runs them and SquatClient only shows the result. In the Squatters dialog you can choose **this app (while connected)**: SquatClient then takes over triggers whenever it is connected and TinyFugue gets them back when you leave.

Lines you did not type are marked in the output: `[tf]` for TinyFugue's own keyboard and `[remote]` for another device.

## One set of worlds, kept in agreement

A world whose **Connect via** is a TinyFugue squatter *is* a world record in TinyFugue, and the two are kept in agreement both ways:

- **Save, rename or delete it here** and TinyFugue's record is created, renamed or deleted (and saved with `/saveworld`, so it survives a restart). Credentials are never copied: this app logs in with its own saved password, unless the record in TinyFugue has its own login.
- **Rename it in TinyFugue** (or add, delete or change one at its keyboard) and the tab, this app's world and the world lists here follow.
- **Connecting** goes by that record, so the tab, the world and TinyFugue all carry the same name.
- **Rename a tab** (right-click the tab, **Rename (in TinyFugue)…**) and the world is renamed in TinyFugue, here, and on the tab.

A connection you opened by address (not from a world) is only a temporary world in TinyFugue, `(unnamed1)` and the like. Right-click its tab and choose **Save as a world in TinyFugue…**: it becomes a named world in TinyFugue (kept after the connection closes) and in your list, and the tab follows. In TinyFugue itself the same is `/renameworld <name>`.

Tabs of connections that run through TinyFugue end in an orange **(tf)**; hover a tab to see which squatter holds the connection.

## TinyFugue's worlds

Press **Worlds…** next to a TinyFugue squatter to see, add, edit, delete and connect TinyFugue's own world records. Passwords are write-only: they are stored in TinyFugue and never shown or kept by SquatClient. TinyFugue logs in by itself, so SquatClient sends nothing for the login. A **viewer** device can look and connect but not edit.

## Sending scripts to TinyFugue

Press **Scripts…** (admin devices) to send a TinyFugue macro file to TinyFugue and activate it there: pick a file or paste the text, name it (letters, digits, `.` `_` `-`, ending in `.tf`) and press **Send and load**. Sending the same name again replaces the script and loads it again.

What the script may do is decided in TinyFugue, by `squat_scripts`:

| Setting | Effect |
| --- | --- |
| off (default) | uploads are refused |
| `safe` | the script runs **sandboxed**: no shell (`/sh`, `/quote !`), no files, no new connections, no Lua, and it cannot change TinyFugue's `squat_` settings or its restriction level. The same holds whenever one of its triggers or macros fires later |
| `on` | the script runs with TinyFugue's own rights, like a file you loaded yourself |

Use `safe` unless you wrote the script. Deleting a script removes only the file: triggers it already defined stay until you undefine them or TinyFugue restarts.

## Gagged lines

Lines TinyFugue gagged are hidden by default. **Settings → Show lines TinyFugue gagged** shows them, marked as gagged.

## GMCP and MSDP

GMCP and MSDP data from games reaches SquatClient too, and you can send GMCP or MSDP requests to a game through TinyFugue.

## Limits

- What SquatClient may do depends on the role the pairing gave this device (viewer, operator or admin). Running a TinyFugue command or sending a script needs admin, and TinyFugue's `squat_exec` / `squat_scripts` settings must allow it.
- Everything is held by TinyFugue: if it exits, its sessions end.
