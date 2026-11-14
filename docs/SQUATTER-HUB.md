# Squatter hub for a select set of users (design note)

Status: design only, nothing is built. Not an open service: a hub for a small trusted group.

## Decision: operating-system accounts, not a user system inside squatterd

Each person has their own account on the hub machine and runs their own `squatterd` under it (own
data directory, own port or unix socket). The squatterd stays single-owner. The operating system gives
the multi-user part: file isolation, per-user process and resource limits, and logins.

Not chosen: a user database, quotas and per-user script runtimes inside one squatterd. That only makes
sense later if people without accounts, or sessions shared between users, are needed.

## How a client reaches it: SSH

```
ssh alice@hub.example.com squatterd stdio
```

- sshd has already authenticated the account (keys, agent, whatever 2FA the host enforces); no new
  password, pairing code or open port. The server is verified through the user's `known_hosts`.
- `squatterd stdio` is a thin forwarder to that user's already-running squatterd (its unix socket). It
  must not host sessions itself, or they would die when the SSH link drops.
- Framing is NDJSON over stdin/stdout, as in the tf-squatter spec (`TF-SQUATTER.md`, SSH stdio
  transport); the device role is `admin` (the ssh user owns the account).
- In SquatClient this is a third route next to Direct and Squatter: "via SSH: user@host".
- `user@hub.example.com`: the hub's DNS name is simply where the SSH goes; a name per person or purpose
  is a CNAME.

## Identity as the game sees it

What a game logs for a connection comes from three places. Each is optional and improves on the last.

1. **Ident (RFC 1413, the `nveid@host` form).** The game asks the connecting machine's identd who owns
   the connection. When each user's squatterd runs under their own account, the system identd reports
   that account with no code from us. Setting, per user: `ident = off | account | <alias>`. The alias
   is restricted to letters, digits and `_ - + .`, at most 32 characters. Default: the account name
   (to be confirmed). Ident is advisory (anyone can fake it) and many games have it off.
   CobraMUSH, like PennMUSH, has `use_ident` and `ident_timeout` in its config.
2. **Source address and its reverse DNS.** A game shows the reverse-DNS name of the connecting address,
   which on a shared hub is the hub's, and its site bans are by host. A shared address means one user's
   misbehaviour bans everyone. Per-user source addresses (cheap with IPv6: one /64 on the hub) with a
   PTR record such as `alice.hub.example.com` fix that: squatterd binds its outgoing connections to the
   user's address (`bind = <address>` in the user's config). The admin owns the DNS side.
3. **Origin header (needs the game to cooperate).** A trusted hub tells the game who is really
   connecting (a PROXY-protocol style header, or a GMCP identity message). The game accepts it only from
   whitelisted hub addresses, so it cannot be forged. Optional, for games we control, e.g. CobraMUSH.

Considered and dropped: a free-text ident such as `squatterd+account`. Ident is advisory, odd strings
can upset games that expect a plain username, and it leaks more than the account name does.

If a game does no ident and shows only the host, nothing here changes what it shows.

## What the hub admin should know

- Root on the hub can read every user's logs and sessions. At-rest encryption with a key only a user's
  devices hold is a possible later feature, not planned.
- The hub opens connections to game servers for its users, so it can be abused (scans, floods). Use
  per-user connection limits and rate limits, and a destination allowlist or denylist.
- Games may limit or ban by address, or treat several logins from one address as multiplaying. Per-user
  addresses help; the rules of each game still apply to each user.
- Squatter-side automation (SQUATTER-AUTOMATION.md) is per user and per squatterd, so its ceiling
  (`--automation-level`) is set by whoever runs that squatterd.

## Phases

1. `squatterd stdio` (forwarder to the unix socket) and the "via SSH" route in the client.
2. Per-user ident setting; documentation for running one squatterd per account behind a system identd.
3. Per-user source address binding (`bind`) and the PTR documentation.
4. Connection limits and the destination policy.
5. The origin header, for games that choose to support it.

## Open questions

- Default ident: account name, alias, or off.
- Whether the SSH route should also support a plain TCP+TLS fallback for people without accounts.
