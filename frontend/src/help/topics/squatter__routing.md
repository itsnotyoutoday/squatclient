---
title: Squatters and routing
parent: squatter
order: 1
keywords: routing, connect via, direct, relay, multiple squatters, home-vps, tailscale, ssh tunnel, hop, proxy, chain
aliases: routing, connect via, via, direct, tunnel, tailscale
---

## The model

- A **squatter** is a saved remote relay: a `squatterd` you run on a server. You can save **many** squatters, for example `home-vps` and `work-box`.
- Each **world** chooses how it connects with its **Connect via** setting:
  - **Direct**: straight from this computer to the game. The connection ends when the app closes.
  - **A saved squatter**: the squatter holds the game connection. It survives closing the app, and when you come back everything you missed is replayed.
- Different worlds can use different squatters, and some can be direct, all at the same time.
- There is **one hop** for now: SquatClient, then the squatter, then the game. Chaining squatters, or a squatter that goes out through a proxy, is not available yet.

## Example

| World      | Connect via | What happens                                 |
| ---------- | ----------- | -------------------------------------------- |
| Star Trek  | home-vps    | held by `home-vps`; still connected tomorrow |
| Work MUSH  | work-box    | held by `work-box`                           |
| Quick test | Direct      | ends when you quit                           |

## Adding a squatter

1. On the server run `./squatterd --port 10327`.
2. On the server run `./squatterd pair` and note the one-time code and the fingerprint.
3. In SquatClient open the squatters dialog, choose **Add a squatter**, and enter the name, host, port and code.
4. Check that the fingerprint shown matches the one `squatterd pair` printed, then press **Trust and pair**.
5. In each world that should use it, set **Connect via** to the new squatter.

The longer story is in [Squatter](help:squatter).

### When the port is firewalled

If you cannot reach the server's port directly, use Tailscale (enter the server's Tailscale address as the host) or an ssh tunnel:

```
ssh -N -L 10327:127.0.0.1:10327 user@server
```

Then add the squatter in SquatClient as host `127.0.0.1`, port `10327`. On the server, start squatterd with `--bind 127.0.0.1 --insecure-loopback`: it then accepts only connections from the server itself, which is safe because the ssh tunnel already encrypts everything.

## Detaching and ended sessions

`/suspend` and `/detach` let go of the squatter sessions; they keep running. An ended session is just history: nothing reconnects by itself, and the squatter stores no game passwords. See [Squatter](help:squatter#suspend-and-detach).

## What next

If a squatter will not connect, see [Troubleshooting](help:troubleshooting#lost-squatter-connection).
