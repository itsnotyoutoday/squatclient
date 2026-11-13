---
title: Getting started
order: 1
keywords: first launch, quick connect, startrekkin, tutorial, begin, new user
aliases: start, quickstart, quick connect, first
---

This page takes you from a fresh install to your first connection.

## First launch

When SquatClient starts with no connection open you see an empty window with two buttons:

- **Worlds** opens the world manager, where your saved connections live.
- **Quick connect** connects to a host and port without saving anything.

Once you connect, the window has a tab bar on top (one tab per connection), the output pane in the middle, one input line below it and a status bar at the bottom.

## Quick connect

1. Click **Quick connect** (or press Cmd-N on macOS, Ctrl-N elsewhere).
2. Enter the **Host** and **Port**. A good game to try is `startrekkin.net` on port `1701`.
3. Tick **Use TLS** only if the game offers an encrypted port.
4. Press **Connect**.

A new tab opens and the game's greeting appears. Type into the input line and press Enter to send what you typed to the game.

## Save a world

A **world** is a saved connection. It remembers the host, port, encryption, text encoding and an optional login so you can reconnect with a double-click.

1. Open the world manager with Ctrl-O (Cmd-O on macOS) or the button in the tab bar.
2. Add a world and fill in the details; see [Connecting and worlds](help:connecting).
3. Double-click the world to connect.

## Your first commands

Anything you type is sent to the game, except lines that start with `/`. Those are **commands** to SquatClient itself.

| Type          | What happens                                                                              |
| ------------- | ----------------------------------------------------------------------------------------- |
| `/help`       | opens this help                                                                           |
| `/help keys`  | opens a topic; any word works                                                             |
| `/echo Hello` | prints a note on your screen (nothing is sent to the game)                                |
| `/colortest`  | prints a colour chart; see [Troubleshooting](help:troubleshooting#colours-look-different) |

The full list is in [Commands](help:commands).

## Things to try next

- Scroll up with PageUp. Output pauses while you read and **--More--** shows in the status bar. Press End to return to live output. See [Using the client](help:using#scrollback-and-pausing).
- Search the output with Cmd-F (Ctrl-Shift-F elsewhere).
- Press Up to bring back lines you sent earlier, or Ctrl-R to search all of them.
- Try your first trigger. This highlights every line with "dragon" in it:

```
/def -t'*dragon*' -ahC#ff4040 dragon
```

## Where to find help

- Press F1 or type `/help` at any time.
- Type `/help` followed by a command name to read about it, for example `/help def`.
- If something misbehaves, see [Troubleshooting](help:troubleshooting).

## Keeping connections alive

By default a world connects **Direct** and the connection ends when you quit the app. To keep connections running while the app is closed, set up a squatter and choose it in a world's **Connect via** setting; see [Squatter](help:squatter).

## What next

Read [Connecting and worlds](help:connecting) to set up your games, then [Using the client](help:using) to learn the input line.
