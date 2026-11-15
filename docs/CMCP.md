# CMCP in SquatClient

SquatClient speaks CMCP (the Cobra console protocol, `~/mush/squat/cmcp/spec`): a game that offers it gets consoles drawn from its own
data instead of text parsing. The text pane and the real input bar are never touched or covered.

```
game --GMCP--> pkg/telnet (EvGMCP) --> engine session --> cmcp/go session.Client (shared core: state machine, data, packs, audio decisions)
                                                    |--> pack.Bind: evaluated widget tree (CmcpTree)  --> "cmcp" event --> front end draws it
                                                    |--> sound notes --> Service.audio (audio.Resolve) --> "cmcp-audio" --> Web Audio
widget click --> CmcpEvent(session, path, event, value) --> Node.Perform --> Cobra.Cmd (+ echoed "cmcp> <typed command>" line)
```

Protocol logic lives in the shared Go core. This repository adds only: byte transport and throttling (`squatClientDaemon/pkg/engine/cmcp*.go`),
pack fetching with cache and consent (`cmcp_packs.go`), design tokens of the seven themes (`internal/app/cmcp_themes.go`), sound
resolution inputs and the audio file handler (`internal/app/sound*.go`), and the drawing (`frontend/src/cmcp/`).

## Window contract (Wails)

Events: `cmcp` (model of a session: state, ship, console, stack, subscriptions, `tree` = the bound screen or null), `cmcp-notes`
(replies, events, scan reports, pack prompts), `cmcp-audio` (one resolved sound).
Methods: `CmcpState`, `CmcpEvent`, `CmcpCommand`, `CmcpAcquire`/`CmcpRelease` (reference-counted extra subscriptions), `CmcpSetUI`, `CmcpSprite`.
Types: `frontend/src/api/types.ts`, `frontend/src/cmcp/types.ts`. The mock engine (`MockEngine.pushCmcp`) takes fixtures produced by the real
Go engine: `CMCP_FIXTURES=frontend/public/cmcp go test ./pkg/engine -run DumpFixtures` in the daemon repository.

## Settings

`cmcp` (advertise CMCP), `consoleTheme` (tng soft klingon romulan tos ferengi ops), `useShipTheme` (follow the console/ship/screen suggestion for theme
and sound era), `soundEra`, `soundFolder` (your own sounds, read-only, never uploaded; `<folder>/era-maps/<era>.json` is preferred to the built-in map,
`era-maps/normalise.json` gains are applied at playback), `soundVolume`, `soundMuted`, `soundCategoryVolumes`.

## Checking by eye

`node frontend/scripts/cmcp-shots.mjs http://localhost:5173/ /tmp/shots` (real headless Chrome, `npm run dev` running) draws every built-in screen from the
fixtures; `node frontend/scripts/cmcp-audio-smoke.mjs` builds the Web Audio graph for a recipe, a streamed looped bed and the bell.
Live: `SQUAT_LIVE_CMCP=1 SQUAT_LIVE_CMCP_MAN=1 go test ./pkg/engine -run CmcpLiveEvennia` against the throwaway Evennia PoC on 127.0.0.1:4101.

## Build note

`go.mod` of squatClient and squatClientDaemon require `github.com/itsnotyoutoday/cmcp` with `replace ... => ../cmcp/go`. CI must check the cmcp
repository out next to them (it is not on GitHub yet).
