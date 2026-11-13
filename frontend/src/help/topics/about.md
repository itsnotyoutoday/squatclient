---
title: About and credits
order: 20
keywords: about, credits, licence, license, gpl, tinyfugue, ken keys, thanks, dependencies, wails, react, gopher-lua, repositories, github
aliases: about, credits, license, licence, thanks, acknowledgements
---

**SquatClient** is a graphical client for MU* games on the desktop, with a TinyFugue-style scripting language, Lua, and optional persistent sessions through a squatter (`squatterd`).

## TinyFugue

SquatClient's scripting language, and much of the overall design of the client, were inspired by **TinyFugue** ("tf"), written by **Ken Keys** (<https://tinyfugue.sourceforge.net>). TinyFugue showed how a good MU* client works: worlds, macros, triggers, hooks, a status line and an Emacs-style input line. SquatClient's language is an original implementation designed to be closely compatible with it, and contains no TinyFugue code. Thank you to Ken Keys and to the TinyFugue community. How the two compare is described in [TinyFugue Script Compatibility](help:compat).

## Licence

SquatClient is free software, licensed under the **GNU General Public License, version 3 or (at your option) any later version** (GPL-3.0-or-later). You may use, study, share and modify it under those terms. The full licence text is in the source repository linked below.

## Open-source software used

| Project             | Used for                             |
| ------------------- | ------------------------------------ |
| Wails               | the desktop application framework    |
| React               | the user interface                   |
| TypeScript and Vite | building the interface               |
| Zustand             | interface state                      |
| TanStack Virtual    | the virtualised output pane          |
| marked              | rendering this help                  |
| DOMPurify           | sanitising rendered help             |
| gopher-lua          | the Lua interpreter                  |
| coder/websocket     | the connection to a squatter         |
| zalando/go-keyring  | storing passwords in the OS keychain |

Thanks to the authors and maintainers of all of them.

## Source code

- Desktop app: <https://github.com/itsnotyoutoday/squatclient>
- Engine and squatterd: <https://github.com/itsnotyoutoday/squatClientDaemon>

Bug reports and contributions are welcome in those repositories.

## What next

Back to the [Home](help:home) page.
