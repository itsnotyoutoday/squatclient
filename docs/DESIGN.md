# SquatClient: Design Spec (v0.3)

**SquatClient** = a graphical TinyFugue: a Go + Wails desktop MU* client with a faithful
TinyFugue (TF) scripting engine and Lua, built around one shared Go engine.
**squatterd** = optional relay daemon (persistent sessions) built from the same engine.

Status: draft v0.3, 2026-11-12. Supersedes v0.2 (Electron, JS/TS engine, goja).
Owner decisions are in Section 0. Anything marked **(verify)** must be checked against
the TF source or real behaviour before it is treated as fact; nothing here was run.

## 0. Decisions (settled with the owner)

| # | Decision |
|---|---|
| 1 | **v1 product = a graphical TinyFugue.** Duplicate what a decent client (TinyFugue, MUSHclient) does, with the bare-minimum Potato features, plus the relay-daemon idea. |
| 2 | **Stack: Go + Wails, React/TypeScript front end.** The engine is Go; the UI is a renderer + input. |
| 3 | **Scripting: two engines.** (a) A **TinyFugue-language interpreter** reimplemented in Go, cloning TF's behaviour from its source and docs; (b) **Lua** (gopher-lua). |
| 4 | **squatterd is optional.** The client works fully standalone ("direct"); with a squatter it gains persistent sessions. |
| 5 | Names: **SquatClient** (app), **squatterd** (daemon). Repos: `itsnotyoutoday/squatclient`, `itsnotyoutoday/squatClientDaemon`. Daemon default port **10327**. |
| 6 | **Full UTF-8, xterm-256 and 24-bit truecolor by default**, plus underline/italic/strike/dim/blink/reverse, OSC 8 links. UTF-8 is the default encoding. |
| 7 | The **rich CobraMUSH UI (game-hosted React stations) is v2.** v1 only keeps the door open (Section 9). |
| 8 | Game logins stay client-side; squatterd stores no game passwords, never auto-reconnects (v1), and an ended session is just ended. |
| 9 | No Potato import/compat. |

## 1. Product definition (v1)

What "graphical TinyFugue" means. Keep TF's strengths, drop its terminal limits:

- **Worlds**: `/addworld`, `/connect`, `/dc`, `/world`, multiple simultaneous connections, a foreground world (`/fg`), activity indicators for background worlds, `.tfrc`-style startup file, `/load` and `/require` for `.tf` files.
- **Macros and triggers**: `/def` with triggers (`-t`), hooks (`-h`), priorities, shots, fall-through, gag/hilite/attrs, key bindings (`-b`/`-k`), world scoping, conditions. TF's pattern types: glob, simple, regexp (`-m`).
- **Scripting language**: TF's own macro/expression language (`/if /while /let /set /eval /test`, `%{var}`, `%1`, `%*`, functions), faithful enough that real `.tf` files (including TF's own `stdlib.tf`) run.
- **Scrollback**: `/recall`, `/limit` (filtered view), `/log`, "more"-style pause when scrolled up (TF's `--More--` becomes a GUI "pause" with a clear indicator).
- **Input line(s)** with TF's emacs-style editing keys and history; `/input`, `/dokey`, `/bind`, `/localecho`.
- **Status bar** with TF-style fields (world, activity, more, clock, custom via `/status_add`).
- **Modern layer** (additions, never replacing TF behaviour): GUI worlds/macros editors, themes, true 24-bit colour, UTF-8, clickable links, search, OS notifications, accessibility.
- **Relay**: optional squatterd for persistent sessions (Section 7).

Non-goals v1: terminal (curses) front end, `/sh`-style shell integration beyond a gated option, mobile, the rich game UI.

## 2. Architecture

```
          ┌──────────────────────────────── Go process (the engine) ─────────────────────────────────┐
          │  telnet · ansi · conn   →  Session (per world)  →  scrollback/log                         │
 MU* game │  tf (parser, expander, expr, macros, hooks, vars, builtins)    lua (gopher-lua + API)     │
 <──────> │  event bus · input dispatcher · config                                                    │
          │  wire (SWP client) ── optional ──> squatterd (same engine, headless)                      │
          └───────────────▲──────────────────────────────────────────────────────────────────────────┘
                          │ Wails bindings + events (typed, generated TS)
                  ┌───────┴────────┐
                  │ React/TS UI    │   output pane · input · status bar · tabs · dialogs · themes
                  └────────────────┘
```

**One engine, two shells.** All logic lives in Go packages under `pkg/`:

| Package | Role |
|---|---|
| `pkg/telnet` | IAC state machine; NAWS, TTYPE/MTTS, EOR, CHARSET, MCCP2, GMCP; fuzzed |
| `pkg/ansi` | ANSI/xterm-256/truecolor -> spans (passes `testdata/ansi-vectors.json`) |
| `pkg/conn` | world connection (TCP/TLS, proxies later), decoding, line splitting, prompts |
| `pkg/scrollback` | ring + on-disk log, search, `/recall` |
| `pkg/tf` | the TF language (Section 3) |
| `pkg/lua` | Lua runtime + API (Section 4) |
| `pkg/engine` | sessions, input dispatch, event bus, config, plugin loading |
| `pkg/wire` | SWP client + server (Section 7) |
| `cmd/squatterd` | headless daemon using the same engine |
| (SquatClient repo) | Wails app: Go glue + React UI |

**Repo layout.** `squatClientDaemon` holds the shared Go packages (`pkg/...`) and `cmd/squatterd`; `squatclient` imports them (Go module path `github.com/itsnotyoutoday/squatClientDaemon`). *(Open: alternatively a third module `squatcore`; decide before code moves. See Section 11.)*

**Why this shape pays off:** the TF/Lua engine runs wherever the engine runs. In v1 it runs in the desktop app. Later, enabling it inside squatterd gives detached triggers, autoreconnect and notifications almost for free, because it is the same code.

**UI contract.** The UI never interprets game text; it receives structured events (`line`, `status`, `session`, `prompt`) and sends intents (`input`, `connect`, `bindkey`, `resize`). Same shapes as the wire protocol (`docs/PROTOCOL.md`: `Line`, `Span`, `SessionInfo`) so local and remote sessions look identical to the UI.

## 3. The TinyFugue engine (`pkg/tf`)

### 3.1 Method

Clone TF's *behaviour* by studying its source and documentation, then write an original Go implementation. Reference sources: the TF 5.0b8 tree (mirrored/maintained at `kruton/tinyfugue`, UTF-8 patches; `ingwarsw/tinyfugue` also active), especially `src/command.c macro.c expand.c expr.c variable.c pattern.c search.c output.c attr.c hook.c`, the `help/` topics (the closest thing to a spec), and `tf-lib/` (TF scripts shipped with TF).

**Oracle testing (the key to fidelity):** build the real `tf` locally from source and use it as a reference. For every feature, a differential test runs the same script through real `tf` (non-interactive) and through our engine and compares output and side effects. `tf-lib/*.tf` (esp. `stdlib.tf`, `tools.tf`, `textutil.tf`, `alias.tf`, `at.tf`, `spedwalk.tf`) must load and behave identically. This makes "faithful" measurable, not a feeling.

**Originality:** `pkg/tf` is an original implementation *inspired by* TF's design and documented behaviour. We do not copy TF source, ship `tf-lib` or help text, or aim for bug-for-bug compatibility: matching TF where it is sensible, and improving on it over time, is the goal (decision 10). The reference `tf` binary is used only as a black-box test oracle.

### 3.2 Scope from TF's own lists (from `cmdlist.h`, `funclist.h`, `hooklist.h`, `varlist.h`)

**61 built-in commands.** Targets: P1 = needed for a usable client; P2 = full parity; GUI = replaced by a GUI equivalent; Gated = shell/OS access behind `/restrict`.

| Group | Commands | Phase |
|---|---|---|
| Worlds/connections | `/addworld /connect /dc /fg /listsockets /listworlds /saveworld /unworld /world` (+`/localecho`) | P1 |
| Macros | `/def /undef /undefn /list /purge /save /load /require /trigger /trigpc /hook /edit` | P1 (`/hook /edit /trigpc` P2) |
| Variables/eval | `/set /setenv /export /unset /let /listvar /shift /eval /test /features /version` | P1 |
| Output/attrs | `/echo /gag /hilite /beep /recall /recordline /limit /unlimit /relimit /histsize /log` | P1 (`/recordline` P2) |
| Input/keys | `/bind /unbind /dokey /input /status_add /status_edit /status_rm` | P1 (status P2) |
| Timers/quote | `/repeat /quote /ps /kill /watchdog /watchname` | P2 |
| Streams/files | `/liststreams` and `tfopen tfread tfwrite tfclose tfflush` | P2 |
| Misc | `/help /exit /quit /restrict /lcd` | P1 (`/help` P2) |
| Shell/process | `/sh /suspend /core` | **Gated / N/A** |

Control flow (`/if /elseif /else /endif /while /do /done /for`-style constructs, `/break`) is part of the language; macros like `/echo` argument handling follow TF's parser rules.

**99 functions** (in the expression language): string (`strlen strcat strcmp strncmp strchr strrchr strstr strrep substr pad tolower toupper replace substitute grapheme_count/offset/substr ascii char`), regex (`regmatch`), math (`abs sin cos tan asin acos atan exp ln log10 pow sqrt rand trunc mod`), time (`time mktime ftime idle sidle cputime`), world/status (`world_info is_connected is_open fg_world nactive nlog nmail nread columns lines winlines status_fields status_width morepaused morescroll moresize isatty`), I/O (`tfopen tfread tfreadable tfwrite tfclose tfflush fwrite read prompt echo send filename`), attrs (`encode_attr decode_attr encode_ansi decode_ansi strip_attr strcmpattr`), keyboard (`kbhead kbtail kbpoint kbgoto kbdel kblen kbmatch kbwordleft kbwordright keycode kb_visual_move`), misc (`getopts eval test whatis option102 gmcp atcp addworld gethostname getpid systype fake_recv`). Plan: P1 the pure/common ones; P2 all; kb* map onto the GUI input widget model.

**~35 hooks** (`ACTIVITY ATCP BAMF BGTEXT BGTRIG CONFAIL CONFLICT CONNECT DISCONNECT GMCP ICONFAIL KILL LOAD LOADFAIL LOG LOGIN MAIL MORE NOMACRO OPTION102 PENDING PREACTIVITY PROCESS PROMPT PROXY REDEF RESIZE SEND SHADOW SHELL SIGHUP SIGTERM SIGUSR1 SIGUSR2 WORLD`): P1 = `CONNECT DISCONNECT CONFAIL LOGIN WORLD SEND PROMPT ACTIVITY BGTEXT BGTRIG LOAD REDEF RESIZE GMCP`; P2 = rest; signal/process/mail hooks N/A or mapped.

**~70 variables** (`varlist.h`): all the behavioural ones (`more`, `wrap`, `wraplog`, `gag`, `hilite`, `histsize`, `login`, `lpflag`, `maildelay` N/A, `mecho`, `sockmload`, `sub`, `kbnum`, `quote_*`, `TZ`, `LANG`, `ansi_log`, `async_name`, `auto_fg`, `atcp/gmcp`, ...). Terminal-only ones are mapped or accepted-and-ignored with a note. P1 = those that affect text processing and connections.

### 3.3 Language semantics to reproduce **(verify each against source/oracle)**

- Command vs. text input: lines beginning with `/` are commands; others go to the foreground world (with `/send` rules and `sub` handling).
- The `/def` option set: `-t<pattern>`, `-m<glob|simple|regexp>`, `-h<hook>`, `-p<priority>`, `-n<shots>`, `-F` fall-through, `-g` gag, `-a<attrs>` / `-P<part><attrs>` partial hilite, `-b`/`-k` bindings, `-w<world>`, `-E<condition>`, `-c<chance>`, `-s<shots?>`, `-i` invisible, `-1`..., plus body.
- Substitution: `%{name}`, `%1..%9`, `%*`, `%L %R %P` (match parts), `%%`, `%;`, `$[expr]`, `$(...)`, command substitution `` `cmd` `` and `{...}`; nesting and `/eval` re-expansion rules; `%{-n}`-style subs. 
- Expression language: operators/precedence, string vs. number coercion, `&` `|` `?:`, `=~` `!~` `=/` `!/` pattern ops, assignment ops, functions.
- Block/structure: `/if ... /elseif ... /else ... /endif`, `/while ... /do ... /done`, `/break`, `%;` vs `;` separators, `/let` scoping, `/export` to environment.
- Attributes: TF's attr strings (`Cred`, `B`, `u`, `r`, `f`, `d`, `h`, `n`, `g`, `x` ...) as parsed by `attr.c`, extended to 24-bit (`C#rrggbb`) and 256-colour in our engine **(verify exact TF 5.0b8 syntax)**.
- Hook/trigger dispatch: priority ordering, fall-through, shots, `-E` conditions, `/trigger` and `/trigpc`, `BGTRIG`/`BGTEXT`, and interaction with gag/hilite/line attributes.
- `/recall` (ranges, `-w`, patterns), `/limit` view filtering, `/log`.
- `/quote` forms (`/quote 'file`, `` `cmd ``, `!cmd`, `#`, `/quote -S`...) with shell/file forms behind `/restrict`.
- `/restrict` levels (none / shell / file / world) for scripts that should not touch the OS.

### 3.4 Engine design notes

- Lexer/parser/evaluator separated from I/O so it is deterministic and testable; macro bodies compiled lazily; expansion budget and recursion/step limits (a runaway macro must not freeze the client; the Fspace audit's unbounded-Lisp finding is the cautionary tale).
- All side effects go through an interface (`Host`: send to world, echo to window, set attr, read file, time/clock), so tests run with a fake host and the same code runs inside squatterd later.
- Single-threaded script execution per engine ("tf thread") with serialised events, to match TF's semantics; I/O is concurrent around it.
- Time-based features (`/repeat`, `at.tf`) use an injectable clock.

### 3.5 Conformance

1. Unit tests per function/command from `help/` examples.
2. **Differential tests** against a locally built real `tf` binary (CI step builds it from a pinned commit).
3. Loading and exercising `tf-lib/*.tf`.
4. Fuzzing the lexer/expander for panics and hangs.
5. A tracked **compatibility matrix** (`docs/TF-COMPAT.md`) listing every command/function/hook/variable as Done / Partial (with the difference) / GUI-replaced / N/A.

## 4. Lua (`pkg/lua`)

- **Engine:** `gopher-lua` (pure Go, Lua 5.1, no CGO). Per-script `context`/instruction budget; standard libs opened selectively (`base string table math`, a safe `os.time/date/clock` subset; **no** `io`/`os.execute`/`dofile` unless `/restrict` permits).
- **Why alongside TF:** TF for people with TF scripts; Lua for new, structured plugins (MUSHclient/Mudlet culture).
- **API (MUSHclient-flavoured, namespaced `squat`)**: `squat.send(text)`, `squat.echo(text|spans)`, `squat.world()`, `squat.on(event, fn)` (events: `line`, `connect`, `disconnect`, `prompt`, `gmcp`, `input`, `timer`), `squat.trigger{match, regex, gag, color, fn}`, `squat.timer{every, fn}`, `squat.alias{...}`, `squat.var.get/set`, `squat.log`, and **`squat.tf(code)`** to call into the TF engine (and TF's `/lua <code>` to call Lua), so the two interoperate.
- **Plugins:** `~/.squatclient/plugins/*.lua`, loaded at start, hot-reload with `/reload`.
- Not goals v1: coroutine-driven async I/O, networking from Lua.

## 5. UI (React + TypeScript in Wails)

- **Layout:** output pane (virtualised, multi-100k lines), input area (1..n lines, TF editing keys), status bar (TF fields), world tabs/switcher (TF's foreground world + activity markers), side drawers (worlds, macros, scrollback search, settings).
- **Output rendering:** spans -> styled runs; 0-15 theme-mapped, 16-255 exact xterm palette, `#rrggbb` truecolor; bold/dim/italic/underline/strike/blink/reverse; links (http/https only opened externally); selection/copy; timestamps; `/recall` and search; "pause when scrolled up" (TF `more`) with indicator and `/dokey` page keys.
- **Input:** emacs defaults like TF (`^A ^E ^B ^F ^W ^K ^U ^Y`, word motions, history `^P ^N`), `/bind`-able, multi-line paste, optional spellcheck, password masking when the server sets remote ECHO.
- **Themes:** dark/light/high-contrast + JSON themes; ANSI-16 mapping; "bold as bright" and "minimum contrast" options.
- **Accessibility:** keyboard-first, ARIA-live region for new lines (screen-reader mode), reduced motion.
- **Wails specifics:** typed Go->TS bindings, events for streaming lines (batched per frame), native menus/dialogs/notifications/Dock bounce through Wails.
- **Consistency risk (acknowledged):** Wails uses the system webview (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux). v1 is a text UI, so we target a conservative web baseline and test in Chromium *and* WebKit (Playwright). The React/TS front end is portable: if webview differences bite (especially WebGL for v2), the same front end can ship in Electron or CEF with the engine as a local sidecar, without touching the engine.

## 6. Connections and text

- Telnet and protocols per `docs/PROTOCOL.md` section 6 (NAWS, TTYPE/MTTS incl. truecolor 256 + UTF-8 + screen-reader bits, EOR/GA prompts, CHARSET, MCCP2, GMCP, ECHO tracking), TLS with per-world verify policy (strict / trust-on-first-use / insecure), SOCKS proxy later.
- Decoding: streaming UTF-8 default; `latin1` and other per-world encodings; invalid bytes -> U+FFFD.
- Colour parsing per `testdata/ansi-vectors.json` (shared with the daemon).
- Logging: `/log` (plain, ANSI, HTML), per-world auto-log, ndjson for replay.

## 7. squatterd (optional relay)

Unchanged in purpose: a persistent-session daemon (`./squatterd --port 10327`) holding game connections, recording with sequence numbers, serving authenticated clients over WebSocket (SWP v1: `docs/PROTOCOL.md`), TLS + per-device ed25519 pairing, replay with no gaps/duplicates, `ended` sessions keep history and a recorded reason, no autoreconnect, no stored game credentials.

Changes in v0.3:
- It is now **built from the same Go engine** (`pkg/*`), headless.
- **Client side:** a squatter is a "transport" for a session (`RemoteSession` implementing the same interface as a direct session). The squatter selector (host, port, pairing key, pinned TLS fingerprint) lives in settings and the title bar.
- **Scripts in v1 run in the client** (against live lines only; backlog replay never re-fires `send`/notify actions, only display effects like hilite/gag apply). **Later:** run the same TF/Lua engine inside squatterd for detached triggers, optional autoreconnect and notifications. This is cheap because the engine is shared; it is explicitly out of v1.
- The daemon's ANSI parser is the same `pkg/ansi`; no duplicate implementation anywhere (the planned TypeScript parser is dropped).

## 8. Security

- Scripts: step/time budgets for TF and Lua; `/restrict` governs shell/file/world access; default **restricted**.
- Squatter: TLS, pinned fingerprint, device keys, rate-limited pairing, per-device revocation, no plaintext off-loopback.
- UI: Wails app loads only bundled assets, strict CSP, no remote content, external links limited to http/https.
- Game credentials in the OS keychain (client side); nothing on the squatter.

## 9. v2: the CobraMUSH rich UI (not v1)

The game serves its own React stations/viewer; the client opens a URL + token when the game sends `Cobra.UI.Open` (GMCP) and closes on `Cobra.UI.Close`. **How it is shown is not decided** (embedded pane, separate window, system browser, or natively drawn from structured data). v1 keeps every option open by: (a) relaying GMCP to scripts and the UI, (b) a small "open game UI" extension point, (c) keeping the front end portable (Section 5), and (d) the rule that game UIs are standalone web apps that also work in a normal browser. Revisit the webview consistency question (Wails vs Electron/CEF) when v2 is designed.

## 10. Phases

**P0 Foundations (days)**: Go workspace; `pkg/telnet`, `pkg/ansi` (+vectors), `pkg/conn`, `pkg/scrollback`; fake MUSH server; Wails app skeleton; build real `tf` locally as oracle. *Accept:* fuzz clean; ANSI vectors pass; skeleton connects and displays coloured text with UTF-8/256/truecolor.

**P1 "usable TF" (about 1-2 weeks)**: engine/session/input; worlds and `.tfrc`; TF language core (expand/expr/macros/triggers/hooks/vars, P1 commands, functions, hooks); output pane, input line, status bar, tabs; `/recall /limit /log /gag /hilite`; config; basic Lua; themes. *Accept:* connect to CobraMUSH, run a realistic set of triggers/macros written in TF, load `stdlib.tf` and TF's own examples, no crash under fuzz.

**P2 parity (weeks, open-ended)**: remaining commands/functions/hooks/variables per the matrix; keybinding defaults; `/quote`, streams/files with `/restrict`; `tf-lib` scripts all run; differential-test coverage targets; GUI editors.

**P3 relay**: SWP client in the app, squatter selector/pairing UI, ended-session summaries ("while you were away"), then optionally run the engine inside squatterd.

**P4 / v2**: rich game UI handoff, detached automation, polish, installers/signing/auto-update.

`squatterd` + SWP (the daemon repo) can proceed in parallel with P0/P1 since it only needs `pkg/telnet`, `pkg/ansi`, `pkg/conn`, `pkg/scrollback`.

## 11. Resolved decisions (added in v0.3.1)

10. **Licence: MIT** for both repos. `pkg/tf` is original, clean-room work inspired by TF; no TF code or bundled TF files; compatibility is "as close as is useful", not a hard requirement, and we are free to diverge and improve.
11. **Engine location:** `pkg/*` lives in `squatClientDaemon` (module `github.com/itsnotyoutoday/squatClientDaemon`); the Wails app in `squatclient` imports it. Local dev uses `~/mush/squat/go.work`.
12. **Directory structure is frozen** in `docs/STRUCTURE.md` (identical in both repos; changes need an ADR).
13. **Automation** runs at the client site in v1; daemon-site execution is a designed future step (`docs/AUTOMATION.md`).
14. **Colour/text requirements are acceptance criteria** (STRUCTURE.md Section 8).
15. All three platforms build in CI; macOS is the primary dev/test platform for v1.

## 12. Risks

- **TF fidelity** is the biggest effort sink; mitigated by oracle tests and a tracked matrix, accepting "Partial" rows.
- **Wails webview inconsistency** (Linux especially); mitigated by a conservative baseline, dual-engine tests, and the portable front end.
- **Licence choice** gates how closely we can follow TF's source.
- **Terminal-isms in TF** (`/sh`, `/suspend`, status geometry, `kb*` functions) need GUI equivalents and are the likeliest "Partial" rows.
- **Script safety:** untrusted `.tf`/Lua from the internet; the default `/restrict` and budgets matter.
- **gopher-lua is Lua 5.1 only** (no integers, goto, bitops); acceptable, noted.
