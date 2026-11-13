---
title: Getting started
order: 1
keywords: first launch, quick connect, startrekkin, tutorial, begin, new user
aliases: start, quickstart, quick connect, first
---

## First launch

When SquatClient starts with no connection open you see an empty window with two buttons:

- **Worlds** opens the world manager, your saved connections.
- **Quick connect** connects to a host and port without saving anything.

The window has a tab bar on top (one tab per connection), the output pane in the middle, a single input line below it and a status bar at the bottom.

## Quick connect

1. Click **Quick connect** (or press Cmd-N / Ctrl-N).
2. Enter the **Host** and **Port**, for example `startrekkin.net` and `1701`.
3. Tick **Use TLS** only if the game offers an encrypted port.
4. Press **Connect**.

A new tab opens and the game's greeting appears. Type into the input line at the bottom and press Enter to send.

## Your first world

Saved worlds remember the host, port, TLS settings, encoding and an optional login. The default world is **startrekkin.net:1701**, a good place to try the client.

1. Open the world manager with Ctrl-O (or the tab-bar button).
2. Select a world, or add a new one.
3. Fill in the details (see [Connecting and worlds](help:connecting)).
4. Double-click a world to connect.

## Things to try next

- Scroll up with PageUp. Output pauses while you read and a **--More--** marker shows in the status bar. Press End or use the jump button to return to live output. See [Using the client](help:using#scrollback-and-pausing).
- Search the output with Cmd-F or Ctrl-Shift-F.
- Type `/help keys` to see the editing keys; they follow Emacs and TinyFugue.
- Try a first trigger. This highlights any line with "dragon" in it:

```
/def -t'*dragon*' -ahC#ff4040 dragon
```

More in [the scripting language](help:scripting).

## Keeping sessions alive

By default a world connects **Direct** and ends when you quit. To keep connections running while the app is closed, set up a squatter and choose it in a world's **Connect via** setting; see [Squatters and routing](help:squatter/routing).
