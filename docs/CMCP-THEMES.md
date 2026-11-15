# CMCP screens in the look of the SquatClient themes

The `/lcars` Lua themes (`internal/stdlib/squat/plugins/squat-gfx`, screenshots in `docs/gfx-shots/themes/`) were the proof of concept. The production
renderer is the generic widget renderer (`frontend/src/cmcp`), driven by the screen tree and protocol data, and reproduces each theme's look through
**skins**: plain data (JSON-expressible) that the theme-pack format of the spec will later carry. The Lua themes stay untouched and are used only when
a game does not speak CMCP.

## Skin parameter model (built-in data tables now, loaded theme packs later)

All geometry is in the Lua themes' scene space (1600 x 900 units, `fit: contain`).

```
Skin {
  name, font {family, weight, files[], tscale, ctscale}, sharp, bloom
  pal { normal{p s t q x r k bg}, red{...} }          // palette roles; `red` is the red-alert set (eased recolour)
  frame  Shape[]      // static decoration under everything: rect{r}, elbow{corner ro ri bar side}, polygon, polyline, path(d), circle, arc, line, text(template)
  nav    { items[{label, role}], x y w h dx dy r size align skewX color, stroke?, marker?, fill? }   // decoration-only console column
  log    { x y w h r role size align label{shrink,expand}, skewX }                             // the LOG toggle
  port   { rect[x y w h], expanded[x y w h], frame{role r width glow} }                          // where the real game text shows, and the LOG-expanded size
  status Text[]       // template texts: {sd} {mode} {hull} {core} {lock} {alert} (from Space.Ship.Status / the screen)
  content { rect }    // where the screen's panels go
  widgets { bar{h r track fill glow}, button{h r color font}, panel{kind title role}, table{...}, radar{kind rings ...}, viewscreen{frame r width role} }
  arrange { <screen id> { slots: { "<widget>#<n>": rect, "buttons#<n>": rect } , order } }      // per-screen arrangement (scene units)
}
```
Widget skins are named styles (`radar.kind: dish | hex | wing`, `panel.kind: plain | box | chamfer | double`), so a theme pack names a style and its parameters;
the renderer implements the styles once. Palette roles are the Lua roles; mapping to protocol tokens: accent = p, accent2 = k, text = s, dim = t, ok/warn/alert from x/r/p of the red set.

## Rendering approach
- Frames: vector shapes emitted as gfx scene objects (rect, elbow, polygon, polyline, path, arc, text with `{var}` templates driven by scene variables the renderer sets from the protocol:
  `lc_sd` stardate, `lc_mode` console name, `lc_hull`, `lc_core`, `lc_lock`, `lc_alert`).
- Alert: the whole palette swaps `normal` -> `red` with the eased recolour (objects carry a role; the renderer tweens fill/stroke when `Space.Ship.Status.alert` changes), calm mode slows it, reduced motion ends it.
- Radar: the gfx `radar` object (sweep bound to `time()`) for `dish`, polygons for `hex` (klingon), contacts from `Space.Contacts` as the radar's `contacts` string.
- Viewscreen: the gfx starfield/plasma/planet objects under the pack's contact art; frame from `widgets.viewscreen`.
- Text port: the skin's `port.rect` is the scene's `portNode`; the tree's own `textport` node only marks that a port must exist. LOG toggle animates `port.rect` <-> `port.expanded` with the other panels fading (summary strip) exactly as `lcars.lua` does.
- Nav column: decoration only (the console is chosen by the game); buttons are drawn but disabled except as local screen switches between the screens the console offers.
- Calm/reduced motion: `calm` is the scene setting already honoured by the runtime; animations the skin adds (shimmer, blinking lamps, needle swing) are skipped under reduced motion.

## Stages
1. tng skin end to end (frame, nav, port, LOG, palette/alert, fonts, widget skins, sens/power/tactical/damage/ops arrangements); compare `tng-*.png`.
2. romulan, klingon, tos, ferengi (frame/nav/widget style differences on the same arrangements).
3. soft (three glass panels) and ops (wall layout).
4. role screens in each theme (same skin, layout engine inside `content`).
5. load skins from the spec's theme-pack format when it lands (the seven built-ins become embedded packs).
Everything is verified in headless Chrome only.
