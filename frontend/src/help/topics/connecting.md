---
title: Connecting and worlds
order: 2
keywords: world, tls, ssl, encoding, utf-8, latin1, login, password, keychain, host, port, auto-connect, groups
aliases: worlds, world, tls, login, passwords, encoding
---

A **world** is a saved connection to a game. Open the world manager with Ctrl-O (Cmd-O on macOS), the menu (Session, Worlds) or the button in the tab bar. Select a world and press **Connect**, or double-click it. Worlds are stored in your SquatClient configuration folder. Passwords are not: they go to your operating system's keychain.

## World fields

| Field                         | Meaning                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                          | what the tab shows                                                                                                                                                  |
| Group                         | optional folder name used to group the list                                                                                                                         |
| Host and Port                 | where the game listens                                                                                                                                              |
| Connect via                   | **Direct** (from this computer; ends when the app closes) or a saved squatter that holds the connection for you; see [Squatters and routing](help:squatter/routing) |
| Encoding                      | how text from the game is decoded: UTF-8 (default) or Latin-1                                                                                                       |
| Use TLS                       | encrypt the connection                                                                                                                                              |
| Skip certificate verification | accept any certificate; only for games with a self-signed certificate                                                                                               |
| Connect automatically         | connect when the app starts                                                                                                                                         |
| Login template                | text sent after connecting; `{name}` and `{password}` are filled in for you                                                                                         |
| Character name                | replaces `{name}`                                                                                                                                                   |
| Password                      | replaces `{password}`; stored in the OS keychain                                                                                                                    |
| Notes                         | free text for yourself                                                                                                                                              |

## Encryption (TLS)

Tick **Use TLS** when the game offers an encrypted port. Certificates are checked strictly by default. Some games use a self-signed certificate; for those, tick **Skip certificate verification**. That removes the protection against someone impersonating the game, so only use it for games you trust.

## Text encoding

UTF-8 is the default. It handles accented letters, emoji and box-drawing characters. Some older games send Latin-1; if accents look garbled, switch that world to Latin-1. You can set the default for new connections in [Settings](help:settings).

## Login templates

If a world has a login template, SquatClient sends it for you after connecting. A typical MUSH template is:

```
connect {name} {password}
```

## Passwords and the keychain

Game passwords are saved in the operating system keychain (macOS Keychain, Windows Credential Manager, or the Secret Service on Linux), never in the worlds file. The file only records that a password exists. If the keychain cannot be reached, connecting to a world that needs a password fails with an error instead of sending an empty password.

A squatter never stores your game passwords either: your client sends the login every time. Lines that look like logins or password changes are masked on screen and never saved in history; see [Passwords](help:using#passwords).

## Several connections

Each connection is a tab. Press Alt-1 to Alt-9 to switch, or Ctrl-Tab and Ctrl-Shift-Tab to cycle. A badge on a tab counts unread lines in background connections, and the status bar shows how many are active. Closing a tab disconnects it. A connection that has ended stays in its tab until you dismiss it, showing the reason and the last text received.

## Worlds from scripts

Scripts can also define and connect worlds; see `/addworld`, `/connect`, `/world` and `/fg` in [Commands](help:commands).

## What next

To keep a connection running while the app is closed, read [Squatter](help:squatter). If a connection fails, see [Troubleshooting](help:troubleshooting#cannot-connect).
