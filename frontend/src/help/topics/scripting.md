---
title: The scripting language
order: 8
keywords: tf, tinyfugue, scripting, macros, triggers, language, def, script, tf language
aliases: scripting, tf, tinyfugue, language, script, macro, macros
---

> **SquatClient's scripting language is an original implementation, inspired by and designed to be closely compatible with TinyFugue ("tf").** TinyFugue was written by **Ken Keys** (<https://tinyfugue.sourceforge.net>). Thank you, Ken, and thank you to the TinyFugue community for decades of documentation, scripts and answers. See [About and credits](help:about#tinyfugue).

Most TinyFugue scripts run here as written. SquatClient contains no TinyFugue code, so a few things behave differently, and a few things that only make sense in a terminal are not available. Everything that differs is listed in [TinyFugue Script Compatibility](help:compat).

## The language in one page

Lines that start with `/` are commands; everything else is text for the game. A script is a plain text file (usually ending in `.tf`) of commands that you load with `/load`.

```
/set greeting=Hello
/echo %greeting, world
/def -t'* tells you: *' -ahCgreen tell = /echo Got a tell from %P1
```

- A **macro** is a named list of commands made with `/def`. With `-t` it becomes a **trigger** that runs when matching text arrives from the game. With `-h` it becomes a **hook** that runs on an event such as connecting.
- **Variables** are set with `/set` and read with `%name` or `%{name}`.
- **Expressions** go inside `$[...]` and `/if (...)`.

## Where scripts live

Put commands in a file named `startup.tf` in the SquatClient configuration folder and it is loaded at start (use `/reload` to load it again). Other files can be loaded with `/load filename`. The folder is `SquatClient` inside your system's per-user configuration folder, for example `~/Library/Application Support/SquatClient` on macOS.

## Defaults for every game

A setting you want on every connection belongs in `startup.tf`, in a `CONNECT` hook, exactly as in TinyFugue:

```
/def -F -hCONNECT = /localecho off
```

The hook runs when a connection opens, and also when SquatClient attaches to a game connection that a squatter (TinyFugue or gtf) already holds. In that second case anything the hook tries to send to the game is discarded, so a login macro cannot log in twice. Add `-w<world>` to limit a hook to one world. When several hooks match one event at the same priority, TinyFugue runs only one of them, chosen at random, unless they are fall-through macros (`-F`), so use `-F` for hooks that should all run.

Local echo (whether what you type appears in the output) can also be set without a script: Settings, "Show what I type", and a "Local echo" choice in each world's settings. `/localecho on` or `/localecho off` changes the open session only and wins over the settings until it ends. Through a squatter, `/localecho off` hides your own echo and the squatter's keyboard (`[tf]`), and still shows what other devices type.

## The reference

The pages below this one are the reference for the language, one chapter each. Use `/help name` to jump straight to a command or function, for example `/help def`, `/help strlen` or `/help expressions`. Every example has an **Insert into input** button so you can try it.

## What next

- [Commands](help:commands) lists everything that starts with `/`.
- [Lua scripting](help:lua) is the other language, for larger plugins.
- [TinyFugue Script Compatibility](help:compat) is for people who already know TinyFugue.
