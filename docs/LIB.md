# The SquatClient standard library (lib/squat)

Before this branch the desktop app could load real TinyFugue's `lib/tf/stdlib.tf` (`SQUATCLIENT_TFLIB`). That file is
written for a terminal: a status line drawn with escape codes, key bindings for line editing, visual mode, a pager,
screen widths. A webview client has none of it, and the engine (gtfparser) already implements most of the library's
commands natively. SquatClient now ships its own library, deliberately smaller:

* `internal/stdlib/squat/` is embedded in the binary and written to `<scripts>/lib/squat/` at every start (so edit
  `startup.tf`, not the library). It is loaded as the engine's `StdLib` and is on the `/load` search path.
  `SQUATCLIENT_TFLIB=<dir>` still replaces it with another library (then `/gfx` needs `/load gfx.tf`).
* Lua plugins live in `<scripts>/plugins/squat-gfx/`.
* `@CONFIGDIR@` in the scripts becomes the configuration folder.

## Kept (script, adapted from tf's stdlib.tf)

| What | Why |
|---|---|
| World types: `WORLD`/`LOGIN` hooks for tiny, prompt, lp, lpp, diku, aber, telnet; `~default_login_hook` | scripts that `/addworld -Ttiny` expect them. The daemon does not raise `LOGIN` today (the app logs in from the world record), so they are inert until it does |
| `/addtiny /addlp /addlpp /adddiku /addtelnet /purgeworld /telnet /retry /retry_off` | world helpers |
| `/loaddef /savedef /loadhilite /savehilite /loadgag ... /loadhist`, `MACROFILE ...` | file shortcuts, with the files under the config folder instead of `~` |
| `/sys /man /cd /pwd /kecho /mecho /qecho` | `/man` opens help |
| `/hilite_page /hilite_whisper /nohilite_page /nohilite_whisper` | hilite helpers |

Already native in the engine, so not in the library: `/list* /purge* /untrig /unhook /undeft /nogag /nohilite /partial
/trig* /echo /require /loaded /wrap /nowrap /wrapspace /first /rest /nth ...` (see the engine's `docs/stdlib-split.md`).

## Dropped (terminal-only)

`tfstatus.tf` (status line drawn with escapes: the window has a status bar that renders the engine's `status_fields`),
`kbbind.tf`, `kb-*.tf`, `kbfunc.tf`, `kbregion.tf` (terminal line editing: the input line is the browser's),
`spc-page.tf` and `/more` paging (a scrolling window never pauses: `more=0`), `/grab`, `/signal`, mail and `TERM`
handling, the `detect_worldtype` guessing hook (the Worlds dialog chooses the type), `proxy_*` (no terminal proxy),
`color.tf`/`changes.tf`/`complete.tf` and the optional toys.

## Replaced (GUI mappings)

| Command | Does |
|---|---|
| `/worlds`, `/quickconnect`, `/settings`, `/layouts`, `/history`, `/about`, `/squatters` | open the app's own window (the `dialog` event) |
| `/listworlds`, `/world`, `/addworld` typed alone | the Worlds dialog (engine/client), with arguments the text commands |
| `/help`, `/man` | the help browser |
| `/visual`, `/more` | explain that the window is always split / never pages, and record the setting |
| `/gfx`, `/canvas` | the graphics language (docs/GFX.md) |
| `/gfxdemo` | a short TF script driving `/gfx`; `/lcars` is the Lua plugin |

## Engine behaviours noticed

* `/send -- text` sends the `--` too in this engine version, so the library's login hooks use plain `/send text`.

## Tests

`internal/stdlib/stdlib_test.go` loads the library into the real TF engine (no errors printed; macros defined; tiny and
lp logins; file shortcuts; `/gfx`, `/canvas` and `/worlds` reach the client; `watch`/`sync`/`autosync`; `/gfxdemo`
end to end including a click running a TF command). `lua_test.go` runs the Lua module and the LCARS plugin on the
real Lua runtime with a manual clock.
