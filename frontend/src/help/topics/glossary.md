---
title: Glossary
order: 14
keywords: glossary, terms, definitions, squatter, world, session, trigger, hook, macro, dbref, attribute, softcode, mush, mud
aliases: glossary, terms, definitions, dictionary
---

Short explanations of words used in this help and in MU* games.

## Client terms

**World**: a saved connection to a game: its name, host, port and login. See [Connecting and worlds](help:connecting).

**Session**: one live (or ended) connection. Each session has a tab.

**Squatter**: a small program (`squatterd`) on a server that keeps your sessions running while SquatClient is closed. See [Squatter](help:squatter).

**Direct**: a world setting meaning the connection goes straight from your computer to the game and ends when the app closes.

**Pairing**: the one-time step that lets SquatClient talk to a squatter, confirmed with a fingerprint.

**Fingerprint**: a short code that identifies a squatter's encryption certificate. You compare it once while pairing.

**Scrollback**: the lines you can scroll back to.

## Scripting terms

**Macro**: a named list of commands made with `/def`. You run it by typing `/name`.

**Trigger**: a macro that runs automatically when a line from the game matches a pattern. See [Macros: /def](help:scripting/macros-def).

**Hook**: a macro that runs when an event happens, such as connecting or disconnecting.

**Pattern**: the text a trigger looks for. A **glob** pattern uses `*` for any text and `?` for one character. A **regexp** is a regular expression.

**Variable**: a named value you set with `/set` and read with `%name`.

**Attribute** (in scripts): the colour and style of text, such as bold or red. See [Attributes](help:scripting/attributes).

**Plugin**: a Lua file that adds behaviour; see [Lua scripting](help:lua).

## Game terms

**MU\***: MUDs, MUSHes, MUXes, MOOs and similar text games.

**MUSH**: a kind of MU* where players build objects and write programs in the game itself.

**Softcode**: the programs players write inside a MUSH, as opposed to the server's own code (hardcode).

**dbref**: the number that identifies every object in a MUSH, written with a hash sign, such as `#123`.

**Attribute** (in a MUSH): a named piece of text stored on an object, for example a description or a command. Not the same as a text attribute above.

## What next

Back to the [Home](help:home) page.
