---
title: Layouts
order: 10
keywords: layouts, layout, panels, docks, gmcp, vitals, chat, compass, sidebar, tsx, jsx, lua, css, theme, evennia cockpit
aliases: layout, panels, dock, docks, sidebar
---

A **layout** arranges the window: where the game output and the input line go, which docks and panels sit around them, and which live game data they show. A game that sends vitals, a room and an inventory over GMCP can get bars, a compass built from the room's exits, a chat window and buttons, appearing only once the game has sent the data.

## Choosing one

- **View > Layouts...** opens the layout manager: pick the default, preview, copy a built-in as a starting point, open the folder.
- A layout can be set **per world** (the world's settings) or **per connection** (Session > Connection settings).
- Built in: **Classic** (the default), **Sidebar**, **Vitals bar** and an **Evennia cockpit** demo with resizable docks, a compass, an HP chart, auto-heal and Lua-made *Who* and *Help* windows.

If a layout fails to load, the classic layout is shown with a message saying why. A layout can never stop you typing or connecting.

## A layout is one file

In the layouts folder (shown in the manager), in the style of a single-file component: markup on top, code blocks below.

```
<App>
  <Row>
    <Mush />
    <Dock side="right" width={240} resizable>
      <Vitals />
      <RoomInfo />
      <Chat height={150} />
    </Dock>
  </Row>
  <InputBar />
</App>

<script>
  const hp = useGmcp('Char.Vitals.hp');   // JavaScript or TypeScript, runs in the window
</script>

<lua>
-- Lua, runs in the engine: works with no window open
squat.on("gmcp", function(e) end)
</lua>

<style>
  .lay-gauge { height: 18px; }           /* CSS */
</style>
```

Exactly one `<Mush />` (the output) and one `<InputBar />` are required. Components: `App`, `Row`, `Column`, `Box`, `Dock`; `Gauge`, `Text`, `List`, `Table`, `Chat`, `RoomInfo`, `Exits`; `When gmcp="Package"` (shows its children once the data exists); `Button send="look"`.

## Data

- **GMCP** packages are kept per session with the right merging (`useGmcp('Char.Vitals.hp')`). `/gmcp` shows what a game really sends.
- **Variables** set by Lua or TinyFugue scripts feed gauges too, so a game without GMCP can have panels (`squat.var.set`).
- JavaScript and Lua share variables both ways. Lua can open its own floating windows and docked panels: `squat.ui.window{...}` and `squat.ui.panel{...}` ([Lua scripting](help:lua)).

## Safety

Layouts are compiled in the app and never loaded from the network. A layout you did not write asks for your consent before it runs, and again if its contents change. Anything that must keep working with the window closed belongs in Lua or TinyFugue; the layout only draws and offers controls.

See also [CMCP consoles and sound](help:cmcp), [Graphics and consoles](help:graphics) and [Settings](help:settings).
