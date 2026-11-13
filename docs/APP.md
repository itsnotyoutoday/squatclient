# APP: Go side of SquatClient

```
main.go / app.go / menu.go   Wails bootstrap, bound App methods (thin), native menu, window state
internal/app                 Service: EngineAPI -> pkg/engine, engine events -> UI events (batched)
internal/config              worlds/settings/squatters/window JSON files, atomic writes, versioned
internal/secrets             go-keyring (MIT) keychain store + in-memory fake; no plaintext fallback
```

## Data and paths
* Config dir: `os.UserConfigDir()/SquatClient` (macOS `~/Library/Application Support/SquatClient`), files `worlds.json settings.json squatters.json window.json` (mode 0600, `version: 1`). Override with `SQUATCLIENT_CONFIG_DIR`.
* Scripts: `startup.tf`, `plugins/*.lua`, `logs/` live in the same directory (STRUCTURE.md: never write elsewhere); override with `SQUATCLIENT_SCRIPTS_DIR` (e.g. `~/.squatclient`).
* Game passwords: OS keychain, service `com.itsnotyoutoday.squatclient`, key `world:<id>`. `login.hasPassword` in worlds.json is only a flag. If the keychain fails, connecting to a world that needs a password fails with an error (never an empty password).
* Scrollback is memory-only (`settings.scrollbackLines` lines per session, applied at app start).

## Window (ADR 0002)
macOS: `TitleBarHiddenInset`, dark appearance, background `#14161a`; the front end shows a 28px draggable strip (`--wails-draggable: drag`) only under `html.mac-titlebar` (set when Wails + macOS are detected). Other platforms keep the native frame. Min size 700x420; size/position are saved on close and restored. Native menu: App (About/Hide/Quit), Session (New Connection Cmd-N, Worlds Cmd-O, Settings Cmd-, , Close Session Cmd-W), Edit, View, Window, Help.

## Build / run
```
make build     # npm install if needed, npm run build, wails build -> build/bin/squatclient.app
make dev       # wails dev
make test      # go test -race ./... + vitest
make lint      # gofmt, go vet, staticcheck, tsc, eslint
open build/bin/squatclient.app
```
`go.mod` has `replace github.com/itsnotyoutoday/squatClientDaemon => ../squatClientDaemon` (Wails runs `go mod tidy`, which ignores go.work); drop it once the engine is tagged. Regenerate the icon with `make icon`.
