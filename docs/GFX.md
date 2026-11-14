# Graphics: /gfx, /canvas and the scene protocol

SquatClient draws a retained-mode scene graph with WebGL2. Scripts create objects once, keep their handles and
update properties; animation, data bindings, shaders and particles then run in the renderer at display rate.

```
Lua plugin (require "gfx")        TinyFugue script (/gfx, /canvas)        gtf scripts (/canvas ...)
        \                                |                                   /
         '------ squat.tf("/gfx ...") ---'---------------------------------'
                                         |
                      internal/gfx  (Hub: parse, validate, mirror the scene)
                                         |   JSON scene operations ("gfx" event)
                      frontend/src/gfx  (Scene graph, tweens, bindings -> WebGL2 renderer)
                                         |   pointer events (GfxEvent) -> the TF command / Lua callback
```

## Design rule

**Scripts set the scene up and update it on events. Everything that moves runs in the renderer.** A script builds
objects, attaches tweens (`anim`), bindings (`bind`), shaders, emitters and style states, and then goes quiet; it
wakes for a click, a GMCP message or a timer that changes *data* (a once-a-second simulation step), not to redraw.
Avoid per-frame script callbacks: a Lua or TF timer cannot hold 60 fps and does not need to.

## Which language does what

| | Lua (`require "gfx"`) | TinyFugue (`/gfx`) |
|---|---|---|
| Role in this release | the full LCARS console (`/lcars`): contacts as tables, loops, formatted readouts, joystick | the short `/gfxdemo`, and the compatibility layer: gtf's `/canvas` scripts |
| Speed | about 18x (loops) and 13x (small calls) faster than the TF engine in SquatClient | enough for setup and events |
| Where | `<config>/plugins/squat-gfx/{gfx,lcars,main}.lua` | `<config>/lib/squat/gfx.tf`, `gfxdemo.tf` |

Both produce the same operations. The Lua module is a thin layer over the `/gfx` command: each call becomes one line
for `squat.tf`, which reaches the renderer through the TF engine, so a Lua plugin and a TF macro share scenes, objects
and variables (a macro may `/gfx set` an object a plugin made). Lua reaches TF functions and variables the same way as
for everything else: `squat.tf("/set x=1")`, `squat.tf("/gfx sync")`. TF reaches Lua through aliases (`/_gfxev ...`
is how clicks come back; see "Events").

The same small scene, side by side:

```tf
/gfx open demo w=800 h=450 bg=#05070d
/gfx rrect bar 40 40 300 48 r=24 fill="lin(90;#ff9900,#cc6600)" glow=0.4
/gfx circle orb 620 200 50 fill="rad(0.4,0.35,0.7;#ffffff,#66aaff,#102040)" glow=0.6
/gfx anim orb y=170..230 dur=1.6 ease=inOutSine loop=inf yoyo
/gfx rect meter 40 200 10 24 r=12 fill=#99ccff
/gfx watch gfx_level
/gfx bind meter w max(10, gfx_level * 3) smooth=0.4
/gfx button go 40 260 220 56 RAISE pill=true fill=#9999ff color=#000000 size=28
/gfx state go hover fill=#ccccff scaleX=1.05 dur=0.1
/gfx on go click /set gfx_level=$[mod(gfx_level + 25, 125)]%; /gfx sync
```

```lua
local gfx = require("gfx")
gfx.install()                      -- once per plugin: click events come back through an alias
local sc = gfx.scene("demo", {w = 800, h = 450, bg = "#05070d"})
sc:rect{id = "bar", x = 40, y = 40, w = 300, h = 48, r = 24, glow = 0.4,
        fill = {type = "linear", angle = 90, stops = {{0, "#ff9900"}, {1, "#cc6600"}}}}
local orb = sc:circle{id = "orb", x = 620, y = 200, r = 50, glow = 0.6,
        fill = {type = "radial", cx = 0.4, cy = 0.35, r = 0.7, stops = {{0, "#fff"}, {0.5, "#66aaff"}, {1, "#102040"}}}}
orb:animate{y = {from = 170, to = 230}, dur = 1.6, ease = "inOutSine", loop = "inf", yoyo = true}
sc:rect{id = "meter", x = 40, y = 200, w = 10, h = 24, r = 12, fill = "#99ccff"}
    :bind("w", "max(10, gfx_level * 3)", 0.4)
local level = 30
gfx.var("gfx_level", level)
local go = sc:button{id = "go", x = 40, y = 260, w = 220, h = 56, pill = true, fill = "#9999ff", text = "RAISE", color = "#000", size = 28}
go:state("hover", {fill = "#ccccff", scaleX = 1.05}, {dur = 0.1})
go:on("click", function() level = (level + 25) % 125; gfx.var("gfx_level", level) end)
```

The Lua module is documented at the top of `gfx.lua`; the LCARS console (`lcars.lua`, about 400 lines) is the
worked example: build once, a 1 Hz `squat.timer` that pushes the `lc_*` variables, button callbacks, alert recolouring
by tweening every themed object, and a helm joystick (below). TF and gtf scripts can drive the same console: it
publishes gtf's variables (`lc_ct`, `lc_b1`, `lc_pw_warp`, `lc_core`, `lc_alert`, ...), so `/gfx var lc_alert red` or a
`/set` followed by `/gfx sync` is seen by the bindings.

## Commands

All object commands are `/gfx TYPE ID [positional...] [prop=value ...]`; `/gfx new TYPE ID prop=value ...` takes
everything as properties. Colors are `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, names, `256:N`. Lists are `a,b,c`.
Gradients: `lin(ANGLE;c0,c1@0.5,c2)` (0 = up, 90 = left to right), `lin(x1,y1,x2,y2;...)`, `rad(cx,cy,r;...)`, all in
fractions of the object's box; up to three stops. A property value starting with `=` is a binding expression.

| Command | |
|---|---|
| `/gfx open [scene] [w= h= bg= dock=full\|top\|bottom\|left\|right\|float size= margin=T,R,B,L fit=contain\|cover\|stretch bloom=]` | create/show a scene (default `main`, 1280x720 logical units) |
| `/gfx close\|clear [scene]`, `/gfx reset`, `/gfx scene NAME`, `/gfx bloom S [R]`, `/gfx bg COLOR`, `/gfx fps [on\|off]` | scene control |
| `/gfx rect\|rrect\|circle\|ellipse\|arc\|elbow\|line\|polyline\|polygon\|path\|text\|image\|group\|layer\|button\|planet\|starfield\|emitter\|shader\|radar\|graph ID ...` | create an object (re-creating an id replaces it) |
| `/gfx set ID[,ID] prop=value ...`, `/gfx move ID X Y`, `/gfx show\|hide ID`, `/gfx z ID N`, `/gfx parent ID PARENT`, `/gfx del ID` | update |
| `/gfx anim ID prop=to prop=from..to [dur= ease= delay= loop=N\|inf yoyo name= after=]`, `/gfx stop ID` | tweens |
| `/gfx timeline NAME [loop=]`, `/gfx at NAME T anim\|set ...`, `/gfx play NAME` | timelines |
| `/gfx bind ID PROP EXPR [smooth=S]`, `/gfx unbind ID PROP` | data binding |
| `/gfx var NAME VALUE`, `/gfx vars a=1 b="x y"`, `/gfx watch\|unwatch NAME...`, `/gfx sync`, `/gfx autosync [off]` | variables (TF variables need `watch` + `sync`) |
| `/gfx on ID click\|down\|up\|enter\|leave\|move\|drag\|settle COMMAND`, `/gfx off ID [EVENT]`, `/gfx state ID hover\|down\|active\|NAME prop=v ... [dur= ease=]` | interaction |
| `/gfx shader NAME file=FILE\|src=GLSL [uniform=name:float\|vec2\|vec3\|vec4\|color,...]` | custom fragment shaders |
| `/gfx font NAME FILE\|URL`, `/gfx image NAME FILE\|URL` | assets (files are searched in `.`, `<config>/lib/squat`, `<config>`) |
| `/gfx list`, `info`, `dump FILE`, `load FILE`, `help` | inspection; a dump is a loadable stream |
| `/gfxdemo [off]` (TF), `/lcars [sens\|eng\|tac\|alert red\|off\|stop]`, `/lock N` (Lua) | demos |

### Properties

Common: `x y rotation scaleX scaleY pivotX pivotY anchorX anchorY opacity visible z blend(add|screen|multiply)
glow shadow.dx shadow.dy shadow.blur shadow.alpha shadow.color`. `rotation` is degrees; `glow` feeds the bloom pass.

| Type | Positional | Properties |
|---|---|---|
| `rect` | x y w h | `w h r` (number, or `tl,tr,br,bl`), `pill`, `fill stroke strokeWidth` |
| `button` | x y w h text | rect props plus `text color size weight font align padX`; hover/down via `state` |
| `circle` / `ellipse` | x y r / x y rx ry | centre at x,y; `fill stroke strokeWidth` |
| `arc` | x y r0 r1 a0 a1 | ring sector, degrees, 0 = up, clockwise |
| `elbow` | x y w h | `corner(tl\|tr\|bl\|br) ro ri bar side`: the LCARS elbow |
| `line` | x1 y1 x2 y2 | `strokeWidth stroke cap(round\|butt)` |
| `polyline` / `polygon` / `path` | x y x y ... / d= | `points`, SVG path `d` (M L H V C S Q T Z); fills are triangulated |
| `text` | x y text | `size weight font align(left\|center\|right) baseline(top\|middle\|alphabetic) letterSpacing maxWidth fill` |
| `image` | x y src | `w h tint` |
| `group` / `layer` | | `clip=x,y,w,h`; a `layer` with `blur`, `shadow`, `blend` or `isolate` renders offscreen |
| `planet` | x y r | lit sphere with atmosphere: `light seed spin spinSpeed ocean land ice cloud atmosphere atmo clouds night sea` |
| `starfield` | x y w h count | parallax depth field: `speed streak fov seed size look` |
| `emitter` | x y | `rate burst burstId lifeMin lifeMax speedMin speedMax angle spread gravityX gravityY drag sizeStart sizeEnd colorStart colorEnd space(world\|local) max` |
| `shader` | x y w h shader | `u.NAME=value`; built-ins `plasma warpcore scanlines`; `uTime uSize` are provided |
| `radar` | x y r | `sweep trail rings color bg contacts` (`id:bearing:range:type;...` or a list) |
| `graph` | x y w h | `values` or `source=VAR samples interval min max stroke fill` |
| `pixelcanvas` | (via `/canvas new`) | |

### Bindings

`/gfx bind ID PROP EXPR [smooth=S]` re-evaluates when a variable it reads changes. Expressions: numbers, strings,
`+ - * / % **`, comparisons, `&& || !`, `?:`, variables (`lc_core`, `gmcp:Char.Vitals.hp`, `msdp:HEALTH`), and
`abs sin cos tan atan2 sqrt pow min max floor ceil round trunc sign fract mod clamp mix step smoothstep int num str len
upper lower substr pad fmt color rgb rand time`. `time()` (seconds) makes a binding re-evaluate each frame, which is
how the radar sweep and the pulses run without a script. `text` strings with `{expr|filter}` are templates:
`"SD {lc_sd|%.1f} {lc_alert|upper}"` (filters: printf specs, `upper lower title trim int round k default:X pad:N`).
`smooth` eases numeric changes between samples. GMCP and MSDP data arrive as `gmcp:Package.field` / `msdp:NAME`
variables automatically. `a.b` targets a member of an object property (`u.uPower`).

### Events and dragging

`/gfx on ID click COMMAND` runs a TF command (the foreground session's engine) when the object is clicked; `$id $x $y
$ev $scene` in the command are replaced. A Lua `obj:on("click", fn)` attaches `/_gfxev scene id event x y` and
`gfx.install()` registers the alias that calls `fn(obj, {x=, y=})`; several plugins can each own objects, an alias
that does not know the object steps aside. Hover and press looks are `state`s, tweened by the renderer.

An object with `drag = {r=44, home=true, vx="js_x", vy="js_y", scale=100}` follows the pointer inside a circle of
radius `r` around its starting point (pointer capture, so it keeps following outside the object). The renderer writes
the offset (-scale..scale) to the variables `vx` and `vy` at display rate, so bound readouts update with no script.
Events `drag` (at most 10 per second) and `settle` (the pointer rested 300 ms, or was released; sent once) carry the
offset as `x y`. With `home` the knob springs back on release. The LCARS joystick uses it: its `settle` handler
computes a heading and drops `/echo JoyStick to 130 power 85` into the input line with `squat.tf("/input ...")`. That
loop (draw in Lua, read the user's reaction, answer the game) is the pattern for GMCP-driven consoles.

### /canvas (gtf compatible)

`/canvas new NAME W H [bg]`, `clear`, `del`, `list`, `px`, `line [t=]`, `rect`, `fill`, `rrect [corners=tl,tr,bl,br]`,
`circle [t=]`, `disc`, `ellipse`, `arc`, `poly`, `glow`, `grad [v]`, `stars [t=]`, `text`, each with `a=ALPHA`: the
grammar of the terminal client (its `docs/LAYOUTS.md`). A W x H cell canvas is W x 2H pixels. Canvases are objects of
the scene `canvas` (pixel mode: CPU-rasterised with anti-aliased discs, rings, ellipses, polygons and rounded corners,
shown with nearest-neighbour scaling; text sits on the cell grid). SquatClient addition: `/canvas show NAME [x y [scale]]`
and `hide` place a canvas in the window (new canvases start hidden). **Not implemented:** gtf's `/layout` and `/panel`
(and `{canvas}`, `{radar}`, `{bar}` panel templates), so gtf's `lcars.tf` does not yet run unchanged here: its `/canvas`
drawing does, its panel placement does not. The rasteriser and the grammar are unit tested (`gfx.canvas.test.ts`,
`gfx_test.go`).

## The scene protocol

Operations are JSON objects with `"op"` and (mostly) `"scene"`; the Go hub emits batches as the `gfx` event, and
`GfxSnapshot()` returns the whole state as the same operations. A remote client could stream these (not implemented).

| op | members |
|---|---|
| `scene` | `scene open w h bg dock size margin fit bloom{strength,radius} pixel passthrough stats` |
| `clear` / `delete` | `scene [id]` |
| `create` | `scene id type [parent] props{}` |
| `set` | `scene id props{}` |
| `tween` | `scene target tracks{prop:{from?,to}} dur ease delay loop(-1 = forever) yoyo [id] [after]` |
| `stop` | `scene id` (object, tween or timeline) |
| `timeline` / `play` | `scene name steps[{at, do:{op:set\|tween,...}}] loop dur` / `scene name` |
| `bind` / `unbind` | `scene id prop expr [smooth]` / `scene id prop` |
| `vars` | `vars{name:value}` (global) |
| `on` | `scene id events[]` (the command text stays in the host) |
| `state` | `scene id name props{} dur ease` |
| `shader` | `name glsl uniforms{name:type}` |
| `font` / `image` | `name src(data: or URL) [weight style]` |
| `draw` | `scene id cmd args[] color alpha t corners text bold ...` (pixel canvases) |

Frontend to host: `GfxEvent(scene, id, event, x, y)`.

## Rendering

Own small WebGL2 renderer, no dependency (so nothing to pin; the only new package is the dev-only
`puppeteer-core@24.10.0` for screenshots). Shapes are one instanced SDF pass (anti-aliased rect/rounded rect with
per-corner radii, circle, ellipse, arc, elbow, capsule lines, soft dots, atlas text), meshes for polygon fills,
custom fragment shaders for planet, radar, warp core, plasma and user shaders, instanced billboards for the
starfield, CPU particles drawn as dots, offscreen layers for blur/shadow/isolated opacity, scissor clips, 4x MSAA, and
a bloom chain (an emissive second attachment, dual-filter down/up sampling). Text is rasterised with Canvas2D into an
atlas (real web fonts). Without WebGL2 the layer shows a message and draws nothing.

Font: **Antonio** (variable, SIL OFL 1.1), bundled in `lib/squat/fonts` with its licence (`Antonio-OFL.txt`).

### Performance

Measured with headless Chrome 142 on macOS (Metal/ANGLE, Apple GPU), 1600x900, LCARS sensors console with radar,
planet, 3 ships with 6 emitters, starfield and bloom: 60 fps (display-limited), 0.3-0.6 ms of CPU per frame (scene
build + draw submission). In software rendering (SwiftShader, no GPU) the sensors console runs at about 20 fps and the all-primitives page
at 8 fps: that is the fill cost of bloom and MSAA on a CPU, not script time. Static scenes draw nothing (frames are skipped when nothing changes).
`scripts/gfx-shots.mjs` prints the numbers.

## Running the demo

* Real app: open any session, type `/lcars` (Lua) or `/gfxdemo` (TF); `x` closes the overlay.
* Any browser, no Wails: `cd frontend && npm run dev`, then open
  `http://localhost:5173/gfx-demo.html?stream=/gfx/lcars-sens.json` (also `lcars-eng`, `lcars-tac`, `lcars-red`;
  `?smoke=1` shows every primitive). The streams are recorded from the real Lua scripts by
  `GFX_RECORD=$PWD/frontend/public/gfx go test ./internal/stdlib -run Record`; buttons replay the operations recorded
  for them, and the stick shows what Lua would put in the input line.
* Screenshots: `node scripts/gfx-shots.mjs URL out.png [waitMs w h]`, `node scripts/gfx-drag.mjs out.png`.

## Wiring note

The daemon's TF engine has no hook for client commands yet, so the desktop app reaches the hub through `/notify`
(`@gfx`, `@canvas`, `@ui` titles handled in `internal/app/gfxbridge.go`). `internal/gfx/gfxext` registers the same
commands through `gtfparser.Extension` (`_gfx`, `_canvas`, with `squat_gfx_native=1`) for a host that can load one;
both routes end in `Hub.Exec`.
