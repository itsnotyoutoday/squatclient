---
title: Graphics and consoles
order: 12
keywords: gfx, canvas, webgl, lcars, graphics, joystick, console, shader, lua, gfxdemo
aliases: gfx, canvas, lcars, graphics
---

SquatClient can draw a scriptable graphics layer over the window: shapes, text, gradients, glow, animation, a
planet, a starfield, a radar, buttons and a drag stick. Scripts create objects once and update them on events;
animation and data bindings run in the renderer.

## Try it

Open any session, then type:

- `/lcars` the full LCARS console written in Lua (sensors, engineering, tactical, ship systems, red alert, a helm
  joystick that puts `/echo JoyStick to 130 power 85` into the input line). `/lcars eng`, `/lcars alert red`,
  `/lcars stop`.
- `/gfxdemo` a short TinyFugue script drawing a few animated shapes, one data-bound bar and a button.

The close button at the top right of a full-window scene closes it.

## Commands

`/gfx` creates and updates objects (`/gfx rect id x y w h fill=#ff9900`), `/gfx anim` animates them, `/gfx bind`
ties a property to a variable (TF variables, `gmcp:Package.field`, `msdp:NAME`), `/gfx on id click command` runs a
command. `/canvas` is the pixel canvas family of the terminal client. From Lua: `local gfx = require("gfx")`.

The full language reference ships with the project documentation (graphics chapter). Without WebGL2 the layer shows a message and draws nothing.
