# Roadmap and queue

Last updated 2026-11-13. Owner-approved items, in rough order. "Running" items are in progress by agents.

## Running now
- **Editor workspace (`/edit`)**, phases 1-2: full-window editor view, world tabs, object tabs, attribute list, permission handling,
  safe saving with conflict check, go-to-definition, search across attributes. Spec: `docs/EDIT-WORKSPACE.md`.
- **Command-window editor mode on CodeMirror + `/upload`**: MUSH syntax highlighting, bracket warnings, Expand/Collapse,
  native file picker, upload dialog with progress.
- **Help rewrite**: self-contained user guide, "TinyFugue Script Compatibility" page, guards against file/jargon references,
  glossary, troubleshooting, what's new, real-WebKit rendering check.

## Queued (next)
1. **Scripts settings (the `.tfrc` equivalent)**: Settings > Scripts with
   - startup script (default `startup.tf` in the app data folder, template created on first launch, Browse / turn off),
   - script folders (search path for `/load` and `/require`, like TinyFugue's library path),
   - per-world script loaded on connect (the world's `macrosFile` field exists but nothing loads it yet),
   - Reload now, Reveal in Finder, Open in default editor, Edit here (code editor dialog), status/errors with line numbers.
   Load order: startup script, Lua plugins, world script at connect, CONNECT hooks.
2. **Default world**: first launch seeds `startrekkin.net:1701` and offers it on the start screen (auto-connect setting).
3. **Scrollback on disk**: larger in-memory ring (100,000 lines) and the full history saved to disk with search; the window pages older lines in; setting for the amount kept.
4. **Help follow-up**: rewrite the pages other agents were editing (using, keys, commands, settings, editing) once they land.
5. **Build in place**: when no agent is editing, use a plain build in the project folder; until then `scripts/build-from-head.sh`
   installs `build/bin/squatclient.app` from committed code.
6. **Push to GitHub**: both repos are private and local-only so far (`itsnotyoutoday/squatclient`, `itsnotyoutoday/squatClientDaemon`).
7. **`/suspend` from inside a TF macro** (needs a hook in the script engine); Wails menu items/F1 accelerator for Help.

## Later
- Editor workspace phases 3-4: object details (flags, locks, owner, parent), create/delete attributes, snippets library with
  placeholders (`{{target}}`), portable code packages for moving objects between games without dbref editing.
- Output search upgrades (regex, filter view, copy last block), error highlighting (`#-1 ...`).
- Squatter-side automation (triggers/timers while detached), optional autoreconnect (opt-in), detached notifications.
- Rich CobraMUSH UI (game-hosted React stations opened in a sandboxed pane), per the design spec.
- Real-game checks of the attribute reader/saver against CobraMUSH (brace handling on save, refusal messages, multi-line values).
- TinyFugue compatibility gaps: command-list conditions (`/if cmd`), backquote substitution, `/repeat -P`, file streams, status fields.

## Known unverified items
- GUI behaviour is only tested in simulated pages and a few real-WebKit probes; no automated test drives the real window.
- Estimated colours in the default dark theme (black, blue, magenta, white, bright red, bright yellow): replace with measured values.
- One engine test failed once under load and could not be reproduced in 14 further runs.

## Game modules

Client features that only fit one family of games are modules, gated by the session's game type
(`SessionInfo.gameType` / `gameFamily`, detected by the engine or set per world / with `/gametype`).
`frontend/src/lib/modules.ts` is the registry. The Object Editor is the module for the MU* family
(PennMUSH, CobraMUSH, TinyMUX, TinyMUSH, RhostMUSH) and is not offered for any other game. Other game
families can get their own modules later. To do: a native-menu item that follows the module (the
View > Object Editor entry is still always enabled and just reports when it does not apply), and
per-flavour differences inside the MU* module (function names, `@list flags` formats) keyed on `gameType`.

## Squatter-side automation

Scripts placed on the squatter run while no client is attached; no shell, file or network access on
the squatterd; opt-in by `squatterd --allow-automation` and a per-device permission. Design:
[SQUATTER-AUTOMATION.md](SQUATTER-AUTOMATION.md). Phases: notify-only triggers, then placed TF/Lua
scripts, then the client UI.

## Squatter hub

A hub for a select set of users, with SSH-key login, per-user ident, source address and an
optional origin header: [SQUATTER-HUB.md](SQUATTER-HUB.md).
