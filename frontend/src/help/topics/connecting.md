---
title: Connecting and worlds
order: 2
keywords: world, tls, ssl, encoding, utf-8, latin1, login, password, keychain, host, port, auto-connect, groups
aliases: worlds, world, tls, login, passwords, encoding
---

A **world** is a saved connection. Open the world manager with Ctrl-O, the menu (Session, Worlds) or the tab-bar button. Worlds are stored in a file in the SquatClient configuration folder; passwords never are.

## World fields

| Field                         | Meaning                                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                          | what the tab shows                                                                                                                                                    |
| Group                         | optional folder name used to group the list                                                                                                                           |
| Host and Port                 | where the game listens                                                                                                                                                |
| Connect via                   | **Direct** (from this computer, ends when the app closes) or any saved squatter that holds the connection for you; see [Squatters and routing](help:squatter/routing) |
| Encoding                      | how bytes from the game are decoded: UTF-8 (default) or Latin-1                                                                                                       |
| Use TLS                       | encrypt the connection                                                                                                                                                |
| Skip certificate verification | accept any certificate; only for games with self-signed certificates                                                                                                  |
| Connect automatically         | connect when the app starts                                                                                                                                           |
| Login template                | text sent after connecting; `{name}` and `{password}` are substituted                                                                                                 |
| Character name                | replaces `{name}`                                                                                                                                                     |
| Password                      | replaces `{password}`; stored in the OS keychain                                                                                                                      |
| Notes                         | free text                                                                                                                                                             |

## TLS

Tick **Use TLS** when the game offers a TLS port. Certificates are verified strictly by default. Some games use a self-signed certificate; for those, tick **Skip certificate verification**, understanding that it removes protection against someone impersonating the game.

## Encodings

UTF-8 is the default and handles accented letters, emoji and box-drawing characters. Some older games send Latin-1; if you see garbled accents, switch that world to Latin-1. You can set the default for new connections in [Settings](help:settings).

## Login templates

If a world has a login template the client sends it for you after connecting. A typical MUSH template is:

```
connect {name} {password}
```

## Passwords and the keychain

Game passwords are saved in the operating system keychain (macOS Keychain, Windows Credential Manager, or the Secret Service on Linux), never in the worlds file; the file only records that a password exists. If the keychain cannot be reached, connecting to a world that needs a password fails with an error rather than sending an empty password. A squatter never stores your game passwords either: your client sends the login.

## Several connections

Each connection is a tab. Press Alt-1 to Alt-9 to switch, or Ctrl-Tab and Ctrl-Shift-Tab to cycle. A badge on a tab shows unread lines in background connections, and the status bar shows how many are active. Closing a tab disconnects it; an ended tab stays until you dismiss it, with the reason and the last text received.

## Scripting your worlds

The scripting language can also define and connect worlds; see `/addworld`, `/connect`, `/world` and `/fg` in [Commands](help:commands).
