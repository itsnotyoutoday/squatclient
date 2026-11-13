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

## The reference

The pages below this one are the reference for the language, one chapter each. Use `/help name` to jump straight to a command or function, for example `/help def`, `/help strlen` or `/help expressions`. Every example has an **Insert into input** button so you can try it.

## What next

- [Commands](help:commands) lists everything that starts with `/`.
- [Lua scripting](help:lua) is the other language, for larger plugins.
- [TinyFugue Script Compatibility](help:compat) is for people who already know TinyFugue.
