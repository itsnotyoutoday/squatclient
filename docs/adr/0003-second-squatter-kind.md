# ADR 0003: A second squatter kind (TinyFugue)

Status: accepted (2026-11-13)

Context: TinyFugue (TF) users already keep long-lived connections in TF on a server. Instead of replacing TF with `squatterd`, TF gets a bridge (`tf-squatterd`, daemon repo, spec `docs/TF-SQUATTER.md`) that speaks SWP v1 plus extensions (control, world edit, exec, GMCP/MSDP).

Decision:
1. A saved squatter has a **kind**: `squatterd` (default, also for records without the field) or `tf-squatterd`. It is chosen when pairing and stored in `squatters.json`.
2. The kind decides the WebSocket path (`/swp` or `/tfsp`) and the default port (10327 / 10328). The server announces its kind in `challenge`/`welcome`; the client passes the expected kind to the wire layer, which refuses a mismatch **before** `hello`, so nothing, not even the pairing code or device key, reaches the wrong kind of server.
3. TF stays authoritative for triggers. A TF session runs the client pipeline live only if automation is `client` and this device holds it; otherwise the pipeline runs display-only, so nothing fires twice.
4. TF sessions are not logged into by the client (TF has its own world record and autologin). World records are edited in TF through `world.*`; passwords are write-only.
5. Control state (who types, who runs triggers) is per session; the UI shows it on the tab and in the status bar and disables the input while TF holds the keyboard.

Consequences: the engine/app/UI gain a `kind`, control and TF-world API (`docs/UI-CONTRACT.md`); a plain `squatterd` is unaffected.
