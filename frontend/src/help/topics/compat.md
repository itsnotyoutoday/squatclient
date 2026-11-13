---
title: TinyFugue Script Compatibility
order: 10
keywords: compatibility, tinyfugue, differences, tf, matrix, not available, gui
aliases: compat, compatibility, differences, tf-compat, tinyfugue compatibility
---

SquatClient's scripting language is modelled on **TinyFugue** ("tf") and designed so that most existing TinyFugue scripts run as written. This page is the short version: what works the same, what is different and why, and what is not available. The pages below it list every command, function, hook and variable.

SquatClient is a new, independent implementation. It contains no TinyFugue code or help text. It follows TinyFugue's documented behaviour and was compared side by side with a real TinyFugue 5.2. Thank you to Ken Keys and the TinyFugue community; see [About and credits](help:about#tinyfugue).

## Summary

|                           | What it covers                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Works the same**        | the command syntax and nearly all commands, macros and triggers with all their options, substitution, expressions, most functions, the hooks, the editing keys and history |
| **Different, on purpose** | safer expressions, deterministic trigger order, scripts never send text by accident, Go-style regular expressions, more colours                                            |
| **Not available**         | features that only make sense in a terminal, a few rarely used commands and functions, shell access                                                                        |

## What works the same

- The command syntax and most commands: `/def`, `/set`, `/let`, `/if`, `/while`, `/for`, `/eval`, `/test`, `/repeat`, `/quote`, `/load`, `/require` and more.
- Macro options `-t -m -h -p -n -F -g -a -P -b -w -E -c`, and glob, simple and regexp patterns.
- Substitution: `%{name}`, `%1` to `%9`, `%*`, `%L`, `%R`, `%P0` to `%P9`, `$[expr]`, `$(command)`.
- The expression language, its operators and most functions, and the hook names.
- The Emacs-style editing keys and the input history.

## What is different, and why

- Inside expressions, `%x` and `%1` are **variable references** and are never read again as text. That stops text from a game from sneaking commands into your scripts.
- `=~` and `!~` compare strings exactly; `=/` and `!/` are glob matches. There is no `%` operator: use `mod()`.
- Triggers fire in a **predictable order**: by priority, then by definition order, and only one macro per priority unless you give `-F`. TinyFugue picks at random among equals.
- Every wildcard of a glob trigger is available as `%P1`, `%P2` and so on.
- A script file that contains a line that is not a command is an **error**. Scripts never send text to a game by accident.
- Backquote command substitution is not provided, because it meant running a shell.
- Colour attributes also accept 256-colour numbers, the `rgb` cube, `grayN` and `#rrggbb` truecolour.
- Every script run has a step limit, a time limit and nesting limits, so a runaway macro cannot freeze the client.
- Regular expressions use the RE2 style: fast and safe, but without look-around or back-references.
- Text is handled in whole characters, so `strlen("é")` is 1.

The complete list, with TinyFugue's behaviour next to SquatClient's, is in [Differences from TinyFugue](help:compat/differences-from-tinyfugue).

## What is not available

SquatClient is a graphical client. Features that exist in TinyFugue only because it ran in a terminal are left out: line wrapping variables (`wrap`, `wrapsize` and friends), the terminal `--More--` prompt (SquatClient pauses the output when you scroll up instead), terminal geometry and signals. Scripts that use them still load: the variables and commands are accepted and ignored. Shell commands such as `/sh` are not available.

A few things are not there yet: `/edit`, `/recordline`, `/watchdog`, and the file stream functions (`tfopen` and friends). They print a clear message when used. See [What is not available yet](help:compat/what-is-not-available-yet).

## How to read the tables

Each entry is labelled **Matches** (tried against a real TinyFugue and identical), **Works** (built from the manual), **Partly**, **Not available yet**, **Handled by the app** or **Not applicable**. See [Reading the matrix](help:compat/reading-the-matrix).

## What next

Start with [the scripting language](help:scripting), or look up a single command in the tables below.
