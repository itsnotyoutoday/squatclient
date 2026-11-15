-- Romulan: near-black green, cold green and amber, long swept asymmetric curves like folded wings, a slow cloaking shimmer.
-- Own artwork (bezier sweeps and angular nameplates); type is Rajdhani (SIL OFL), thin and angular.
return function(E)
  local L, gfx = E.L, E.gfx
  local function wing(id, d, role, width, op)
    local sc, S, T = E.sc(), E.S(), E.T
    return T(role, sc:path{id = id, d = d, stroke = S.pal.normal[role], strokeWidth = width, fill = "none", opacity = op or 0.9, glow = 0.25}, false, "stroke")
  end
  local function frame()
    local sc, S, T, text = E.sc(), E.S(), E.T, E.text
    local P = S.pal.normal
    -- swept wings: long beziers sweeping from the left column across the top and bottom, asymmetric
    -- (kept to the margins: left edge, top and bottom rim, so they never run over a control or a text)
    wing("w1", "M 20 890 C 6 640, 6 360, 20 120 S 90 18, 240 14 S 900 8, 1150 12", "p", 3)
    wing("w2", "M 30 880 C 16 640, 16 380, 28 150 S 80 44, 200 30", "t", 2, 0.7)
    wing("w3", "M 1585 884 C 1300 890, 900 886, 40 888", "p", 2, 0.6)
    -- nameplate: an angular amber plate, top right
    T("x", sc:polygon{id = "plate", points = {1180, 14, 1570, 14, 1550, 62, 1160, 62}, fill = P.x, glow = 0.1})
    text(nil, "rt1", 1200, 40, "WARBIRD  VALDORE  //  {lc_mode|upper}", 28, "#0a0a05", "left")
    text(nil, "rt2", 260, 40, "SD {lc_sd|%.1f}", 26, P.k, "left")
    text(nil, "rb1", 250, 862, "CORE {lc_core|%d}   HULL {lc_hull|%d}   LOCK {lc_lock}   ALERT {lc_alert|upper}", 24, P.k, "left")
    -- a thin amber ticker rail along the bottom
    T("x", sc:rect{id = "rail", x = 760, y = 868, w = 800, h = 2, fill = P.x, opacity = 0.7})
    E.port{role = "p", r = 4, width = 2, glow = 0.3}
  end
  local function nav()
    local sc, S = E.sc(), E.S()
    E.navbtns({{"SENSORS", "sens", "p"}, {"POWER", "eng", "x"}, {"WEAPONS", "tac", "t"}, {"DAMAGE", "ship", "q"}, {"OPS", "op", "r"}}, {x = 36, y = 220, w = 160, h = 52, dy = 66, dx = 6, r = 3, size = 26, align = "left", padX = 14, color = "#021008"})
    for i = 1, 5 do sc:get("nav" .. i):set{skewX = -14} end
    sc:rect{id = "marker", x = 20, y = 224, w = 6, h = 44, fill = S.pal.normal.x, glow = 0.6}
    E.logbtn{x = 36, y = 586, w = 170, h = 50, r = 3, role = "x", size = 24, align = "left", shrink = "LOG  <  SMALL", expand = "LOG  >  EXPAND"}
    sc:get("logbtn"):set{skewX = -14}
  end
  local function decor(name, parent)
    local sc, S = E.sc(), E.S()
    if name == "sens" then
      -- the cloak: a slow shimmer over the viewscreen, and the sensor dish fades in and out
      sc:shader{parent = sc:get("vsg"), id = "cloak", w = 800, h = 420, shader = "shimmer", u = {uCol = "#7dffc0", uK = 0.9}, opacity = 0.0, blend = "add"}
      local c = sc:get("cloak")
      c:animate{opacity = {from = 0.0, to = 0.6}, dur = 5, ease = "inOutSine", loop = "inf", yoyo = true}
      local r = sc:get("rdg")
      if r then r:animate{opacity = {from = 1, to = 0.35}, dur = 7, ease = "inOutSine", loop = "inf", yoyo = true, delay = 2} end
    end
  end
  E.register{
    name = "romulan", font = "Rajdhani", weight = "700", sharp = true, bloom = 0.7, decor = decor,
    fonts = {{"Rajdhani", "fonts/Rajdhani-Medium.ttf", "500"}, {"Rajdhani", "fonts/Rajdhani-Bold.ttf", "700"}},
    pal = {
      normal = {p = "#4fe39a", s = "#9fd9b8", t = "#2f9f78", q = "#1f6a52", x = "#e8a63a", r = "#c47a2c", k = "#7fc7a5", bg = "#020805"},
      red    = {p = "#ff7a3a", s = "#ffb48a", t = "#c4542a", q = "#7a2a18", x = "#ffcf5a", r = "#ff5a2a", k = "#ffa070", bg = "#0e0502"},
    },
    alertEdge = "#ff7a3a", frame = frame, nav = nav,
    mark = function(i) E.sc():get("marker"):animate{y = 224 + (i - 1) * 66, x = 20 + (i - 1) * 6, dur = 0.45, ease = "inOutCubic"} end,
  }
end
