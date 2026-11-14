---
title: Commands
order: 7
keywords: commands, slash, /help, /lua, /load, /connect, /quit, list of commands, builtin
aliases: commands, command, builtin, builtins, slash
---

Anything you type that starts with `/` is a command. Everything else is sent to the game.

## Handled by the app

| Command     | Meaning                                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/help`     | open this help; `/help topic` opens a topic and `/help words` searches                                                                                                                                                        |
| `/upload`   | choose a text file and send it line by line; `/upload ~/file.mush` names the file yourself; see [Uploading a file](help:using#uploading-a-file)                                                                               |
| `/edit`     | open the Object Editor; `/edit #12` or `/edit #12/ATTRIBUTE` opens that object or attribute, and `/edit me`, `/edit here` or a name works too; see [Editing objects and attributes](help:editing)                             |
| `/gametype` | show or set what kind of game this is (`/gametype cobramush`, `/gametype other`, `/gametype auto`); it decides whether the Object Editor is offered; see [Editing objects and attributes](help:editing#which-games-it-is-for) |

`/help` is handled by the window itself, so it works even when no world is connected. The browser accepts TinyFugue-style names: `/help def`, `/help /def`, `/help expressions`, `/help triggers`.

## Handled by SquatClient

| Command               | Meaning                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/lua code`           | run a line of Lua; see [Lua scripting](help:lua)                                                                                                                                                  |
| `/load file`          | load a `.tf` script, or a `.lua` plugin when the name ends in `.lua`                                                                                                                              |
| `/reload`             | reload Lua plugins and the startup file                                                                                                                                                           |
| `/suspend`, `/detach` | let go of squatter sessions and minimise the window; see [Squatter](help:squatter)                                                                                                                |
| `/secret text`        | send text without recording it anywhere (never echoed, stored or logged by a squatter); see [Passwords](help:using#passwords)                                                                     |
| `/tf command`         | run one command in the **remote TinyFugue** behind this session (a TinyFugue squatter; admin device, `squat_exec` on) and show its output; see [TinyFugue as a squatter](help:squatter/tinyfugue) |
| `/local command`      | run one command in **this client's own** script engine, even if a Lua alias claims the name                                                                                                       |
| `/stop`               | interrupt a runaway script (the TinyFugue engine's Ctrl-C)                                                                                                                                        |
| `/colortest`          | print every colour mode (16 colours, the full xterm-256 grid, truecolor gradients, text styles, UTF-8) to compare with a terminal; see [Colours](help:using#colours)                              |

## TinyFugue-style commands

The scripting language provides the rest. Open any of them with `/help name`.

| Area                | Commands                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Output              | `/echo` `/send` `/beep` `/notify` `/gag` `/hilite`                                                                                                                                                 |
| Variables           | `/set` `/setenv` `/export` `/unset` `/let` `/listvar` `/shift`                                                                                                                                     |
| Evaluation          | `/eval` `/test` `/return` `/break` `/builtin`                                                                                                                                                      |
| Control flow        | `/if` `/elseif` `/else` `/endif` `/while` `/do` `/done` `/for`                                                                                                                                     |
| Macros and triggers | `/def` `/undef` `/undefn` `/untrig` `/undeft` `/unhook` `/nogag` `/nohilite` `/partial` `/list` `/purge` `/trigger` `/hook`                                                                        |
| Keys                | `/bind` `/unbind` `/dokey`                                                                                                                                                                         |
| Files               | `/load` `/save` `/require` `/quote`                                                                                                                                                                |
| Timers              | `/repeat` `/ps` `/kill`                                                                                                                                                                            |
| Worlds              | `/addworld` `/connect` `/dc` `/fg` `/world` `/unworld` `/renameworld` `/listworlds` `/listsockets` `/saveworld`                                                                                    |
| View                | `/limit` `/unlimit` `/relimit` `/recall` `/recordline` `/log` `/input` `/localecho` `/status_add` `/status_edit` `/status_rm` `/status_clear` `/histsize` `/wrap` `/nowrap` `/wrapspace` `/visual` |
| Information         | `/version` `/features` `/restrict` `/quit` (`/exit` ends a `/load`, as in TinyFugue)                                                                                                               |

Start at [the scripting language](help:scripting), especially [Commands](help:scripting/commands), and see [TinyFugue Script Compatibility](help:compat) for which commands behave differently from TinyFugue.

`/listworlds`, `/world` and `/addworld` typed alone open the Worlds window; give `/listworlds` an argument (`/listworlds *`, `/listworlds -s`) or use it inside a script, a pipe or `$(...)` and it prints the list as text. `/set wrap off`, `/wrap 80`, `/wrapspace 2` and `/nowrap` change how the output window wraps. `/limit pattern` filters the window and its scrollback; `/unlimit` brings the lines back. Keys that a script binds with `/bind` or `/def -b` run from the input line (see [Keys](help:keys)).

The scripting language is the shared **gtfparser** engine, the same one the `gtf` terminal client uses. A command that TinyFugue has but SquatClient cannot offer says `not supported by this client`.

Typing a command that does not exist prints `no such command. Type /help for help.`

## What next

Read [the scripting language](help:scripting) to define your own commands with `/def`.
