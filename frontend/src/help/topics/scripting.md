---
title: The scripting language
order: 8
keywords: tf, tinyfugue, scripting, macros, triggers, language, def, script, tf language
aliases: scripting, tf, tinyfugue, language, script, macro, macros
---

> **SquatClient's scripting language is an original implementation, inspired by and designed to be closely compatible with TinyFugue ("tf").** TinyFugue was written by **Ken Keys** (<https://tinyfugue.sourceforge.net>). Thank you, Ken, and thank you to the TinyFugue community for decades of documentation, scripts and answers. See [About and credits](help:about#tinyfugue).

SquatClient contains no TinyFugue source code and bundles none of its help text; it follows TinyFugue's documented behaviour and improves on it in a few places. If you know TinyFugue you will feel at home; the differences are listed in [Compatibility notes](help:compat).

## The language in one page

Lines that start with `/` are commands; everything else is text for the game. A script is a plain `.tf` file of commands that you `/load`.

```
/set greeting=Hello
/echo %greeting, world
/def -t'* tells you: *' -ahCgreen tell = /echo Got a tell from %P1
```

- A **macro** is a named command list made with `/def`. With `-t` it becomes a **trigger** that fires on matching game text; with `-h` it is a **hook** that fires on an event.
- **Variables** are set with `/set` and read with `%name` or `%{name}`.
- **Expressions** go in `$[...]` and `/if (...)`.

## Reference topics

The rest of this section is the reference for the language, one page per chapter. Use `/help name` to jump straight to a command or function, for example `/help def`, `/help strlen` or `/help expressions`.

Use the **Insert into input** button on any example to try it.

## Related

- [Lua scripting](help:lua), for structured plugins.
- [Compatibility notes](help:compat).
- [Commands](help:commands), the list of everything starting with `/`.
