---
title: Commands
order: 7
keywords: commands, slash, /help, /lua, /load, /connect, /quit, list of commands, builtin
aliases: commands, command, builtin, builtins, slash
---

Anything you type that starts with `/` is a command. Everything else is sent to the game.

## Handled by the app

| Command | Meaning                                                                |
| ------- | ---------------------------------------------------------------------- |
| `/help` | open this help; `/help topic` opens a topic and `/help words` searches |

`/help` is handled by the window itself, before anything is sent to the engine, so it works even when no world is connected. The browser accepts TinyFugue-style names: `/help def`, `/help /def`, `/help expressions`, `/help triggers`.

## Handled by the engine

| Command               | Meaning                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `/lua code`           | run a line of Lua; see [Lua scripting](help:lua)                     |
| `/load file`          | load a `.tf` script, or a `.lua` plugin when the name ends in `.lua` |
| `/reload`             | reload Lua plugins and the startup file                              |
| `/suspend`, `/detach` | detach squatter-held sessions; see [Squatter](help:squatter)         |
| `/secret text`        | send text without recording it anywhere (never echoed, stored or logged by a squatter); see [Passwords](help:using#passwords) |
| `/colortest`          | print every colour mode (16 colours, the full xterm-256 grid, truecolor gradients, text styles, UTF-8) to compare with a terminal; see [Colours](help:using#colours) |

## TinyFugue-style commands

The scripting language provides the rest. Open any of them with `/help name`.

| Area                | Commands                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Output              | `/echo` `/send` `/beep` `/notify` `/gag` `/hilite`                                                                          |
| Variables           | `/set` `/setenv` `/export` `/unset` `/let` `/listvar` `/shift`                                                              |
| Evaluation          | `/eval` `/test` `/return` `/break` `/builtin`                                                                               |
| Control flow        | `/if` `/elseif` `/else` `/endif` `/while` `/do` `/done` `/for`                                                              |
| Macros and triggers | `/def` `/undef` `/undefn` `/list` `/purge` `/enable` `/disable` `/trigger` `/trigpc` `/hook`                                |
| Keys                | `/bind` `/unbind` `/dokey`                                                                                                  |
| Files               | `/load` `/save` `/require` `/quote`                                                                                         |
| Timers              | `/repeat` `/ps` `/kill`                                                                                                     |
| Worlds              | `/addworld` `/connect` `/dc` `/fg` `/world` `/unworld` `/listworlds` `/listsockets` `/saveworld`                            |
| View                | `/limit` `/unlimit` `/relimit` `/recall` `/log` `/input` `/localecho` `/status_add` `/status_edit` `/status_rm` `/histsize` |
| Information         | `/version` `/features` `/restrict` `/exit` `/quit`                                                                          |

Start at [the scripting language](help:scripting), especially [Commands](help:scripting/commands), and see [Compatibility notes](help:compat) for which commands behave differently from TinyFugue.
