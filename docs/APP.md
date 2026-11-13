# APP: Go side of SquatClient

```
main.go / app.go / menu.go   Wails bootstrap, bound App methods (thin), native menu, window state
internal/app                 Service: EngineAPI -> pkg/engine, engine events -> UI events (batched); squatters.go = pairing, device key, suspend/resume
internal/config              worlds/settings/squatters/window JSON files, atomic writes, versioned
internal/secrets             go-keyring (MIT) keychain store + in-memory fake; no plaintext fallback
```

## Data and paths
* Config dir: `os.UserConfigDir()/SquatClient` (macOS `~/Library/Application Support/SquatClient`), files `worlds.json settings.json squatters.json window.json` (mode 0600, `version: 1`). Override with `SQUATCLIENT_CONFIG_DIR`.
* Scripts: `startup.tf`, `plugins/*.lua`, `logs/` live in the same directory (STRUCTURE.md: never write elsewhere); override with `SQUATCLIENT_SCRIPTS_DIR` (e.g. `~/.squatclient`).
* Game passwords: OS keychain, service `com.itsnotyoutoday.squatclient`, key `world:<id>`. `login.hasPassword` in worlds.json is only a flag. If the keychain fails, connecting to a world that needs a password fails with an error (never an empty password).
* Device key (ed25519 seed, base64): OS keychain, same service, key `device-key`; created on first pairing; never written to a file. If the keychain is unavailable pairing fails (no plaintext fallback).
* Squatters: `squatters.json` holds id, name, host, port, pinned TLS fingerprint and the `paired` flag only (never the pairing code or the key).
* Scrollback is memory-only (`settings.scrollbackLines` lines per session, applied at app start).

## Squatters (optional remote relay)

`squatterd` (from the squatClientDaemon repo) holds game connections so they survive the app closing; reattaching replays what you missed. The app works fully without it.

1. On the machine that should hold sessions: `make build` in squatClientDaemon, then `./squatterd serve` (default port 10327, TLS with a self-signed certificate; `--bind 127.0.0.1` for local-only, `--data-dir`).
2. `./squatterd pair` prints a single-use 10-minute pairing code and the server's TLS fingerprint.
3. In the app: cloud button -> Squatters -> Name, Host, Port, Pair code -> **Pair**. The app connects, reads the certificate fingerprint WITHOUT sending the code, and shows it. Compare it with the one `squatterd pair` printed; only then click **Trust and pair**. The fingerprint is pinned: a changed certificate later is refused with a clear message (no silent re-trust).
4. In a world's settings choose that squatter in "Connect via". Connecting such a world makes the squatter open the game connection; the login (character + keychain password) is sent by the app, the squatter stores no passwords.
5. Close the app: sessions keep running. Start it: the squatter reconnects once, sessions reappear, what was missed is replayed (gag/hilite apply, triggers do not fire) and "While you were away" lists unread output and ended sessions with their reason.
6. `/suspend` (or Session -> Suspend) detaches from the squatter and minimises the window; **Resume** (status bar or Session menu) re-attaches. For direct connections `/suspend` only minimises.
7. Status: the status bar shows `Detached` / `Squatter unreachable`; sessions never reconnect by themselves, use Reconnect in the Squatters dialog. `squatterd revoke <deviceId>` removes this device on the server.

Known limitation: the squatter records an echo line for what the app sends, and masks it only while the game has turned echo off. A `connect name password` login line therefore appears in clear in the squatter's history (it needs a daemon `send` option to suppress echo). Use a squatter you control.

## Window (ADR 0002)
macOS: `TitleBarHiddenInset`, dark appearance, background `#14161a`; the front end shows a 28px draggable strip (`--wails-draggable: drag`) only under `html.mac-titlebar` (set when Wails + macOS are detected). Other platforms keep the native frame. Min size 700x420; size/position are saved on close and restored. Native menu: App (About/Hide/Quit), Session (New Connection Cmd-N, Worlds Cmd-O, Settings Cmd-, , Suspend Cmd-Shift-D, Resume Cmd-Shift-R, Close Session Cmd-W), Edit, View, Window, Help.

## Build / run
```
make build     # npm install if needed, npm run build, wails build -> build/bin/squatclient.app
make dev       # wails dev
make test      # go test -race ./... + vitest
make lint      # gofmt, go vet, staticcheck, tsc, eslint
open build/bin/squatclient.app
```
`go.mod` has `replace github.com/itsnotyoutoday/squatClientDaemon => ../squatClientDaemon` (Wails runs `go mod tidy`, which ignores go.work); drop it once the engine is tagged. Regenerate the icon with `make icon`.
