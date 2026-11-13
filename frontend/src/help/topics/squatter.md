---
title: Squatter
order: 3
keywords: squatterd, daemon, persistent, session, relay, pair, pairing, fingerprint, trust, suspend, detach, ended, reconnect, screen
aliases: squatterd, daemon, persistent, pairing, suspend, detach, relay
---

A **squatter** keeps your game connections running while SquatClient is closed. It is a small separate program, `squatterd`, that you run on a computer that stays on, such as a home server or a cheap virtual server. Think of `screen` or TinyFugue on a shell account.

## Why use one

- You close the app, and the game never notices: you stay logged in.
- The squatter keeps recording what the game says. When you open SquatClient again it replays everything you missed and carries on live.
- You can attach from different computers.

You do not need a squatter to use SquatClient. Without one, connections are **direct** and end when you quit the app.

What a squatter does **not** do:

- It **never logs in for you** and **stores no game passwords**. SquatClient sends the login lines each time.
- It **never reconnects to a game by itself**. If the game closes the connection, the session is shown as ended, with the reason, until you dismiss it.
- **SquatClient does reconnect to the squatter by itself.** If your laptop sleeps or the network drops, the squatter keeps your games connected; the app reconnects to it a moment after the network is back (or the window is shown again) and catches up on everything you missed. You can turn this off in [Settings](help:settings), and the Squatters dialog has a Reconnect button to do it right away.

## Setting it up

You need two things: `squatterd` running on the server, and SquatClient paired with it. Pairing happens once per computer.

1. Get `squatterd` for the server from <https://github.com/itsnotyoutoday/squatClientDaemon> and start it there:

   ```
   ./squatterd --port 10327
   ```

   The default port is 10327, connections to it are encrypted, and its files live in `~/.squatterd`. Run `./squatterd --help` for the other options, for example `--bind` to limit the address it listens on and `--data-dir` to move its files.

2. On the server, in a second terminal, run:

   ```
   ./squatterd pair
   ```

   It prints a one-time **pairing code** such as `ABCD-EFGH` (valid for ten minutes), the server's **fingerprint**, and a host and port hint.

3. In SquatClient open the squatters dialog (the tab-bar button), choose **Add a squatter**, and enter a name, the host, the port (10327 unless you changed it) and the pairing code. Press **Pair**.

4. Compare the fingerprint SquatClient shows with the one `squatterd pair` printed. If they are the same, press **Trust and pair**. If they differ, press **Reject**: something is between you and your server.

5. In the world manager set a world's **Connect via** to your squatter. See [Squatters and routing](help:squatter/routing).

## The fingerprint check

The squatter makes its own encryption certificate, so no outside authority vouches for it. SquatClient therefore asks you to confirm the fingerprint once, and from then on it only talks to a server with exactly that fingerprint. If the fingerprint ever changes, the connection is refused.

Only pair computers you trust: anyone who can pair can open connections to any game from the server. `./squatterd revoke <deviceId>` removes a paired computer.

## Leaving and coming back

### /suspend and /detach

Type `/suspend` (or `/detach`) to let go of your squatter sessions while leaving them running. SquatClient lets go of them, the window is minimised, and the sessions keep recording. To come back choose **Resume** in the Session menu (Cmd/Ctrl-Shift-R); everything you missed is replayed. Closing the app has the same effect for squatter sessions.

Direct connections cannot outlive the app, so `/suspend` leaves them connected and just minimises the window. If you have both kinds open, only the squatter sessions are detached.

### Ended sessions

When a game closes the connection, resets it or cannot be reached, the session is **ended**. The tab shows the reason, the time and the last text received, and the history is kept. Choose **Connect again** to open a fresh connection, or **Dismiss** to remove the tab. Nothing reconnects by itself.

## Security summary

- Connections to the squatter are encrypted, and the certificate is pinned when you pair.
- Your computer proves who it is with a key; the squatter remembers only the public half.
- Pairing codes work once and expire. Repeated wrong codes lock the sender out for five minutes.
- If the squatter's port is not reachable, see [Squatters and routing](help:squatter/routing#when-the-port-is-firewalled).

## What next

Read [Squatters and routing](help:squatter/routing) to use several squatters, or [Troubleshooting](help:troubleshooting#lost-squatter-connection) if a squatter does not respond.
