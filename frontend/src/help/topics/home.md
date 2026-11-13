---
title: Home
order: 0
keywords: overview, welcome, index, start, contents, help
aliases: help, overview, index, contents, welcome
---

Welcome to **SquatClient**, a graphical MU* client with a TinyFugue-style scripting language and Lua. This help browser is built into the app: it works offline and everything in it is searchable.

## Where to start

- New here? Read [Getting started](help:getting-started).
- Want to connect to a game? See [Connecting and worlds](help:connecting).
- Want your sessions to survive closing the app? See [Squatter](help:squatter).
- Looking for a key? See [Keyboard shortcuts](help:keys).
- Want to write triggers and macros? Start with [the scripting language](help:scripting), then [Lua scripting](help:lua).

## Using this help

| To do this             | Do this                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Open help              | type `/help`, press F1 (Cmd-? on macOS), choose Help in the menu, or click the **?** button                                 |
| Open a topic           | `/help def`, `/help keys`, `/help squatter` (a leading `/` is fine: `/help /def`)                                           |
| Search                 | type in the search box, or `/help some words`                                                                               |
| Move around            | click the topic tree, follow links, or press Alt-Left and Alt-Right for back and forward                                    |
| Jump to the search box | press `/`                                                                                                                   |
| Close                  | press Escape                                                                                                                |
| Try an example         | every code block has **Copy** and **Insert into input** buttons; Insert puts the text on your input line without sending it |

## Topics

- [Getting started](help:getting-started): first launch, quick connect, your first world.
- [Connecting and worlds](help:connecting): TLS, encodings, logins, passwords.
- [Squatter](help:squatter): persistent sessions with `squatterd`.
- [Using the client](help:using): output, scrollback, input editing, tabs, themes, colours.
- [Keyboard shortcuts](help:keys)
- [Settings reference](help:settings)
- [Commands](help:commands): everything you can type that starts with `/`.
- [The scripting language](help:scripting): macros, triggers, expressions, hooks.
- [Lua scripting](help:lua): the `squat.*` API.
- [Compatibility notes](help:compat): how this relates to TinyFugue.
- [About and credits](help:about)

Please note that SquatClient's scripting language is an original implementation inspired by [TinyFugue](help:about#tinyfugue), written by Ken Keys.
