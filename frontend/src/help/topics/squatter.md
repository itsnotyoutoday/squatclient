---
title: Squatter
order: 3
keywords: squatterd, daemon, persistent, session, relay, pair, pairing, fingerprint, trust, suspend, detach, ended, reconnect, screen
aliases: squatterd, daemon, persistent, pairing, suspend, detach, relay
---

## What is squatterd?

**squatterd** is a small optional program that holds your game connections for you, in the spirit of `screen` or TinyFugue on a shell account. You run it on a machine that stays on. When you close SquatClient the game connection stays up, squatterd keeps recording what the game says, and the next time you attach it replays everything you missed and carries on live.

You do not need a squatter to use SquatClient. Without one, connections are **direct** and end when you quit the app.

What squatterd does **not** do:

- It **never logs in for you** and **stores no game passwords**. Your client sends the login lines.
- It **never reconnects automatically**. If the game connection ends, the session is shown as ended with the reason, and it stays ended until you dismiss it.

## Running it

On the machine that will hold your sessions (the engine repository builds the binary with `make build`):

```
./squatterd --port 10327
```

The default port is 10327, the connection is TLS, and data lives in `~/.squatterd`. To see the other options use `./squatterd --help`; for example `--bind` limits the address it listens on and `--data-dir` moves its files.

## Pairing

Pairing lets this copy of SquatClient talk to your squatter. It happens once per device.

1. On the squatter machine run:

   ```
   ./squatterd pair
   ```

   It prints a one-time **pairing code** such as `ABCD-EFGH` (valid for ten minutes), the TLS **fingerprint**, and a host and port hint.

2. In SquatClient open the squatters dialog (the tab-bar button), choose **Add a squatter**, and enter a name, the host, the port (10327 unless you changed it) and the pairing code. Press **Pair**.
3. Compare the fingerprint SquatClient shows with the one `squatterd pair` printed. If they match, press **Trust and pair**. If they differ, press **Reject**: something is between you and your server.

## Trusting the fingerprint

The squatter makes its own TLS certificate, so there is no certificate authority to vouch for it. SquatClient therefore uses _trust on first use_: you confirm the fingerprint once, and from then on that exact fingerprint is pinned. If it ever changes, the connection is refused. Only pair devices you trust: anyone who can pair can open connections to any host from the squatter machine, and `./squatterd revoke <deviceId>` removes a device.

## Using a squatter

In the world manager set **Connect via** to your squatter. Sessions you open that way live on the squatter. You can save several squatters and route different worlds through different ones; see [Squatters and routing](help:squatter/routing).

### /suspend and /detach

Type `/suspend` (or `/detach`) to let go of squatter-held sessions while leaving them running: the client goes idle, the sessions keep recording, and you resume later by attaching again, when everything you missed is replayed. Direct sessions cannot outlive the app, so for them `/suspend` can only hide the window and the connections stay live. If both kinds are open only the squatter-held sessions are detached.

Note: this behaviour is specified in the project design; if your build prints `/suspend (not available)`, simply close the app, and the squatter-held sessions carry on regardless.

### Ended sessions

When a game closes the connection, resets it or cannot be reached, the session becomes **ended**. The tab shows the reason, the time and the last text received, and the full history is kept. Choose **Connect again** to open a fresh connection or **Dismiss** to remove it. Nothing reconnects by itself.

## Security summary

- Transport: TLS with a pinned self-signed certificate.
- Authentication: your client holds an ed25519 key; the squatter remembers its public key.
- Pairing codes are single use and expire; repeated wrong codes lock out the sender for five minutes.
- If you reach the squatter through an ssh tunnel, point the client at the loopback address as described in the squatterd README.
