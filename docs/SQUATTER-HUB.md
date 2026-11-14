# Squatter hub for a select set of users (design note)

Status: the squatterd side of named users, key login and administration is built (daemon repo, branch
`hub-auth`, see its docs/PROTOCOL.md sections 2a and 2b); the client side (the SquatterAdmin menu, the
Squatters dialog, the ssh-agent signer) and per-user session separation are not. Not an open service: a
hub for a small trusted group.

## Logging in: two kinds of key, both supported

The transport stays TLS + WebSocket (it works for browsers and phones, and the fingerprint pinning is
already there). A named user, e.g. `nereus`, proves who they are with a key pair; **the private key never
leaves the client**, and the signed data includes the server's TLS fingerprint, so a signature cannot be
replayed against another server. A user may have keys of either kind, and the old anonymous
paired-device login (`squatterd pair`) is unchanged.

1. **An ssh key** (the key pair the user already uses for ssh; ed25519 for now). **No pairing code is
   needed**: a public key is not a secret, so it is simply added: the user sends their `id_ed25519.pub`;
   the host runs `squatterd user authorize nereus < id_ed25519.pub` (the same habit as `ssh-copy-id`), or
   an admin adds it as the user's first key, or one of the user's own devices adds it for another.
   The client signs with the key from ssh-agent (`SSH_AUTH_SOCK`, the Windows OpenSSH agent or Pageant;
   keys in hardware work through the agent) or a key file chosen in the app.
2. **An app-generated device key**, for people who would rather not use their ssh key: the app makes a
   key and a one-time **pairing code** enrols it (`squatterd user pair nereus`, or from one of the user's
   own devices). Its public key can also be added directly, like an ssh key.

Keys live in a `users.json` file on the squatterd (per user: role `viewer`, `operator` or `admin`, and the
keys with fingerprint, who added them and when they were last used). The signature code is plain
standard-library Go on the daemon (no ssh library there); the client needs `golang.org/x/crypto/ssh` (BSD
licence, GPL-compatible, already in its dependency tree) for the agent and for reading key files.
Accepted key types: ed25519; RSA and ECDSA are refused with a clear message for now.

## Administration

- **On the host:** `squatterd user list|add|remove|authorize|pair|reset|audit|...`. `add` creates a user;
  `authorize` adds a public key (no code); `pair` prints a one-time code for an app-generated key; `list` shows role, key fingerprints, last seen and live sessions; `kill` ends
  a user's sessions and drops their connections but keeps the account; `remove` also revokes their keys.
  The command line is trusted because the caller can reach the data directory; the first admin key is
  set up this way.
- **From the client:** a device whose key has the `admin` role gets an Admin panel in the app that does
  the same over the existing authenticated TLS connection (new `admin.*` messages, refused for any other
  role). The credential is a key, not a bearer token: a key never leaves the machine and each request is
  bound to the connection. Use a separate admin key from the everyday key. Admin actions go into an
  audit log.
- **Manage is not read:** an admin manages users and sessions but does not attach to another user's
  session unless a separate, explicit support role allows it. Whoever has a shell on the host can still
  read the logs on disk.
- **What an admin can do:** create users and add the first key (or issue the first pairing code) of a *new* user (no sessions
  yet); list users with metadata only (role, key fingerprints, last seen, session count); `kill` a
  user's sessions and connections; disable or remove an account (revokes keys, ends sessions, and asks
  whether to keep or delete the stored logs); **reset** an existing user's access (voids old keys and
  sessions, then issues a new code).
- **No takeover through keys or codes:** adding a key, or creating a pairing code, for a user who already has keys can only be
  created or approved from one of that user's own devices, never by an admin alone. Otherwise an admin
  could redeem it with their own key and read the sessions. Every key addition is shown on the user's
  other devices and written to the audit log. Reset is the admin's way to give back access, and it
  destroys the old sessions, so it cannot be used to take one over.
- **Host shell:** the command line works on the data directory directly, so it can do every admin
  action and more (add a key to any user, read logs on disk): whoever has a shell on the host, or runs
  the squatterd's account, is the final authority, and no software rule can stop someone who can edit its
  files. To keep it honest, anything added from the shell is shown on that user's devices ("a key was
  added from the host") and written to the audit log. Treat the shell as break-glass for whoever runs
  the host, and the remote admin key as day-to-day user management under the limits above. With one
  squatterd per operating-system account, the shell user is simply the owner.
- A user should enrol at least two devices: if every device and key is lost, no one can recover the
  running sessions, only reset the account (which ends them). The app can warn when a user has one.
- Builds on the device roles (`viewer`, `operator`, `admin`) already started in the daemon tree.

## One squatterd per person, or one hub with named users

Open decision. Key login works with either.

- **One squatterd per operating-system account.** Isolation (files, processes, resource limits) comes
  from the OS, and a system identd then reports the right account to games with no code from us.
  Simplest and safest for a small group; every person needs an account on the host.
- **One squatterd with named users** (`nereus`, ...). No accounts needed, but the squatterd must itself
  isolate users: per-user data directories, session lists filtered by user, quotas, and per-user script
  runtimes (see SQUATTER-AUTOMATION.md). A bigger project.

SSH as a transport (`ssh user@host squatterd stdio`, as in the tf-squatter spec) remains an option for
people who prefer it, but it is not part of this design.

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

1. SSH-key login: key sources in the client, the `authorized_keys` file and `squatterd authorize`.
   Then the `user` subcommands and the Admin panel.
2. Per-user ident setting; documentation for running one squatterd per account behind a system identd.
3. Per-user source address binding (`bind`) and the PTR documentation.
4. Connection limits and the destination policy.
5. The origin header, for games that choose to support it.

## Open questions

- Default ident: account name, alias, or off.
- One squatterd per account, or one hub with named users (above).
- Which key types to accept at first (ed25519 only, or also ECDSA and RSA).
