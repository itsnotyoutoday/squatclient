---
title: Scripting graphics (Lua and TinyFugue)
order: 13
keywords: gfx, canvas, webgl, lua, tinyfugue, tf, shader, tween, anim, bind, emitter, radar, planet, starfield, button, joystick, lcars, scene, particles
aliases: gfx scripting, webgl, scene, scenes, canvas scripting
---

SquatClient draws a **retained-mode WebGL2 scene** from your scripts: rounded rectangles, circles, arcs, text, gradients, glow, a lit planet, a starfield, a radar, a graph, particle emitters, your own fragment shaders, buttons and a drag stick. The rule that makes it fast: **a script builds the scene once and updates *data*; everything that moves runs in the renderer** (tweens, data bindings, shaders). Avoid per-frame script callbacks.

The same scene is reachable from both scripting languages: Lua (`require "gfx"`, much faster for loops and tables) and the TinyFugue `/gfx` command. They share scenes, objects and variables. Without WebGL2 the layer shows a message and draws nothing.

## Try the demos

- `/lcars` the full LCARS console written in Lua (`/lcars tac`, `/lcars alert red`, `/lcars themes`, `/lcars calm on`).
- `/gfxdemo` a short TinyFugue script.

## The same scene in both languages

TinyFugue:

```
/gfx open demo w=800 h=450 bg=#05070d
/gfx rrect bar 40 40 300 48 r=24 fill="lin(90;#ff9900,#cc6600)" glow=0.4
/gfx circle orb 620 200 50 fill="rad(0.4,0.35,0.7;#ffffff,#66aaff,#102040)" glow=0.6
/gfx anim orb y=170..230 dur=1.6 ease=inOutSine loop=inf yoyo
/gfx rect meter 40 200 10 24 r=12 fill=#99ccff
/gfx watch gfx_level
/gfx bind meter w max(10, gfx_level * 3) smooth=0.4
/gfx button go 40 260 220 56 RAISE pill=true fill=#9999ff color=#000000 size=28
/gfx on go click /set gfx_level=$[mod(gfx_level + 25, 125)]%; /gfx sync
```

Lua:

```lua
local gfx = require("gfx")
gfx.install()                      -- once per plugin: click events come back through an alias
local sc = gfx.scene("demo", {w = 800, h = 450, bg = "#05070d"})
sc:rect{id = "bar", x = 40, y = 40, w = 300, h = 48, r = 24, glow = 0.4,
        fill = {type = "linear", angle = 90, stops = {{0, "#ff9900"}, {1, "#cc6600"}}}}
local orb = sc:circle{id = "orb", x = 620, y = 200, r = 50, glow = 0.6, fill = "#66aaff"}
orb:animate{y = {from = 170, to = 230}, dur = 1.6, ease = "inOutSine", loop = "inf", yoyo = true}
sc:rect{id = "meter", x = 40, y = 200, w = 10, h = 24, r = 12, fill = "#99ccff"}
    :bind("w", "max(10, gfx_level * 3)", 0.4)
gfx.var("gfx_level", 30)
local go = sc:button{id = "go", x = 40, y = 260, w = 220, h = 56, pill = true, text = "RAISE", fill = "#9999ff", color = "#000", size = 28}
go:on("click", function() gfx.var("gfx_level", 55) end)
```

## The pieces

- **Objects**: `rect rrect circle ellipse arc elbow line polyline polygon path text image group layer button planet starfield emitter shader radar graph`. Re-creating an id replaces the object.
- **Properties** common to all: `x y rotation scaleX scaleY opacity z blend glow shadow.*`. Colours are `#rgb`, `#rrggbb`, names or `lin(...)` / `rad(...)` gradients.
- **Tweens and timelines**: `/gfx anim` with `dur ease delay loop yoyo`; `/gfx timeline` and `/gfx at` sequence them.
- **Data bindings**: `/gfx bind ID PROP EXPR` re-evaluates when a variable it reads changes. Expressions can read TinyFugue variables, `gmcp:Char.Vitals.hp` and `msdp:NAME`, with `sin cos min max clamp mix smoothstep fmt rand time` and more. `time()` makes a binding run each frame (a radar sweep with no script).
- **Events**: `/gfx on ID click|enter|leave|drag|settle COMMAND`; hover and press looks are `/gfx state` tweened by the renderer. A drag stick writes its offset to variables at display rate.
- **Shaders**: `/gfx shader NAME src=GLSL uniform=...` for your own fragment shaders; built-ins `plasma warpcore scanlines`.
- **Scenes** dock around the text (full, top, bottom, left, right, float); the text pane is never covered, and each session has its own scene. The close button of a full-window scene closes it.
- **/canvas** is the pixel canvas family of the terminal client gtf, so its scripts draw here too.

`/gfx help` lists every command, `/gfx dump FILE` saves a scene as a loadable stream. The full reference (properties of every object, the scene protocol, performance notes, screenshots) is the graphics chapter of the project documentation.

## A pattern for game consoles

Draw in Lua, read the user's reaction, answer the game: the LCARS helm joystick's `settle` handler computes a heading and puts `/echo JoyStick to 130 power 85` on the input line. Bindings on `gmcp:` variables keep the display live with no script running. For consoles the *game* draws, see [CMCP consoles](help:cmcp).

See also [Lua scripting](help:lua), [The scripting language](help:scripting), [Layouts](help:layouts) and [Graphics and consoles](help:graphics).
