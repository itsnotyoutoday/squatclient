# The SquatClient standard library (lib/squat)

Before this branch the desktop app could load real TinyFugue's `lib/tf/stdlib.tf` (`SQUATCLIENT_TFLIB`). That file is
written for a terminal: a status line drawn with escape codes, key bindings for line editing, visual mode, a pager,
screen widths. A webview client has none of it, and the engine (gtfparser) already implements most of the library's
commands natively. SquatClient now ships its own library, deliberately smaller:

* `internal/stdlib/squat/` is embedded in the binary and written to `<scripts>/lib/squat/` on the first start and again only after an update (a stamp file, `lib/.installed`, records
  which build is installed). To change a script, put your own copy in your scripts folder or a library folder: those are searched first. It is loaded as the engine's `StdLib` and is on the `/load` search path.
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

## Fonts (lib/squat/fonts)

All fonts are SIL Open Font License 1.1; each licence text sits beside its font. Antonio (TNG), Rajdhani (soft, Romulan, bridge),
Teko (Klingon), Orbitron (TOS) and Cinzel (Ferengi) are from the Google Fonts repository (github.com/google/fonts, `ofl/`).

## The classic TinyFugue library (lib/tf)

The installed app also carries the unmodified standard TinyFugue library (`internal/stdlib/tflib/`, notice in
`TF-NOTICE.md`; the same files gtf ships): `tintin.tf`, `at.tf`, `kb-*.tf`, `spedwalk.tf`, `tf-help` and the rest. It is
written to `<config>/lib/tf` on the first start and after an update (managed, like `lib/squat`). `/load` and `/require` search, for a relative
name: the scripts folder, your extra library folders, then `lib/squat`, then `lib/tf`, so `/load tintin.tf` and `/load examples/hello.tf` work without
a path; an absolute path (or `~/...`) loads from anywhere. Only `lib/squat/stdlib.tf` runs at start; the classic
`stdlib.tf` stays available as `lib/tf/stdlib.tf` (`SQUATCLIENT_TFLIB` can still point the start-up library elsewhere).

## Where files go (Mac, Windows, Linux)

| Folder | Default | Setting |
|---|---|---|
| App-data (startup.tf, plugins/, logs/, settings; holds the managed libraries) | `~/Library/Application Support/SquatClient` (Mac), `%AppData%\SquatClient` (Windows), `~/.config/SquatClient` (Linux) | `SQUATCLIENT_CONFIG_DIR` |
| Managed libraries `lib/squat` and `lib/tf` | inside the app-data folder; written on first start and after an update (override a script from your scripts or library folders) | none |
| Scripts folder: the working directory, so a relative `/load`, `/require`, `/log`, `/save`, `/lcd` start here | the app-data folder | Settings > Scripts folder (`scriptsDir`); applies at the next start |
| Extra library folders | none | Settings > Extra library folders (`libDirs`) |

A relative `/load name` searches: the scripts folder, `lib/squat`, `lib/tf`, the extra library folders. So `/load tintin.tf`
or `/load examples/hello.tf` work without a path. A name starting with `/`, a drive letter (`C:\...`), `./` or `~/` is used
as given (`~` is the home folder on every system, including `~\` on Windows), so scripts can reach `~/Documents` or
`~/Downloads` explicitly. The app does not default into Documents: macOS asks permission for it and Windows often
redirects it to OneDrive. Settings stores only absolute paths (or `~/...`).
