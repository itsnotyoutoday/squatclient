---
title: Compatibility notes
order: 10
keywords: compatibility, tinyfugue, differences, tf, matrix, out of scope, gui, not implemented
aliases: compat, compatibility, differences, tf-compat
---

A short version of what matches TinyFugue, what is intentionally different, and what is out of scope. The full, authoritative matrix follows in the pages below this one.

## What matches

- The command syntax and most commands: `/def`, `/set`, `/let`, `/if`, `/while`, `/for`, `/eval`, `/test`, `/repeat`, `/quote`, `/load`, `/require` and more.
- Macro options `-t -m -h -p -n -F -g -a -P -b -w -E -c`, and glob, simple and regexp patterns.
- Substitution: `%{name}`, `%1`..`%9`, `%*`, `%L`, `%R`, `%P0..%P9`, `$[expr]`, `$(command)`.
- The expression language, its operators and most functions, and the hook names.
- The Emacs-style editing keys and history.

## What is intentionally different

- Inside expressions, `%x` and `%1` are **variable references**, never re-parsed as text. That prevents text from the game from injecting commands.
- `=~` and `!~` compare strings exactly; `=/` and `!/` are glob matches. There is no `%` operator: use `mod()`.
- Triggers fire **deterministically**: by priority, then definition order, and only one macro per priority unless `-F` is given. TinyFugue picks randomly among equals.
- Every glob wildcard of a trigger is available as `%P1`, `%P2`...
- A script file that contains a line that is not a command is an **error**; scripts never send text by accident.
- Backquote command substitution is not provided, because it implied a shell.
- Colour attributes also accept 256-colour indices, the `rgb` cube, `grayN` and `#rrggbb` truecolour.
- Every script run has a step budget, a time limit and nesting limits so a runaway macro cannot freeze the client.
- Regular expressions use Go (RE2) syntax.

## What is out of scope

SquatClient is a graphical client. Features that exist in TinyFugue only because it ran in a terminal are **not implemented and not planned**: line wrapping variables (`wrap`, `wrapsize`...), the terminal `--More--` prompt (replaced by pause-when-scrolled-up), screen modes (`/visual`, `/redraw`), terminal signals, terminal geometry, and the keyboard-buffer functions. Scripts that use them still load: the commands and variables are accepted and ignored. Shell commands (`/sh`) are not available.

## Status

The compatibility matrix was written from the public TinyFugue manual and has not yet been verified against a reference `tf` binary, so read "Done" as "implemented to the documented intent". Some features are planned: `/edit`, `/recordline`, `/watchdog`, the stream functions (`tfopen` and friends) and `%{-N}` ranges.
