-- "soft": a restrained design after a modern tactical station: graphite glass, desaturated salmon and cream, dim teal,
-- thin strokes, small-caps headings over double rules, almost no glow. Own artwork.
return function(E)
  local L, gfx = E.L, E.gfx
  local function frame()
    local sc, S, T, text = E.sc(), E.S(), E.T, E.text
    local P = S.pal.normal
    -- three screens of black glass at slightly different angles, thin cream edges
    local screens = {{20, 108, 205, 712, -1.2, "p"}, {236, 100, 880, 728, 0, "q"}, {1122, 110, 460, 716, 1.2, "t"}}
    for i, sc3 in ipairs(screens) do
      sc:rect{id = "glass" .. i, x = sc3[1], y = sc3[2], w = sc3[3], h = sc3[4], r = 14, fill = {type = "linear", angle = 160, stops = {{0, "#14181c"}, {1, "#0b0e11"}}},
        stroke = "#2a3138", strokeWidth = 2, skewY = sc3[5], z = -5}
    end
    -- small-caps headings over thin double rules, in salmon
    local heads = {{"NAVIGATION", 36, 126}, {"TACTICAL", 252, 112}, {"CONTACTS", 1138, 124}}
    for i, h in ipairs(heads) do
      text(nil, "hd" .. i, h[2], h[3], h[1], 30, P.p, "left", {weight = "700"})
      T("p", sc:rect{id = "hr" .. i .. "a", x = h[2], y = h[3] + 18, w = 190, h = 2, fill = P.p, opacity = 0.9})
      T("p", sc:rect{id = "hr" .. i .. "b", x = h[2], y = h[3] + 24, w = 150, h = 1.5, fill = P.p, opacity = 0.6})
    end
    -- thin top and bottom strips instead of bars
    T("p", sc:rect{id = "topstrip", x = 236, y = 70, w = 1346, h = 3, fill = P.p, opacity = 0.8})
    T("k", sc:rect{id = "botstrip", x = 236, y = 840, w = 1346, h = 3, fill = P.k, opacity = 0.7})
    text(nil, "t1", 236, 50, "U.S.S. ENDEAVOUR   NCC-1701-F", 28, P.s, "left")
    text(nil, "t2", 1580, 50, "SD {lc_sd|%.1f}   {lc_mode|upper}", 26, P.t, "right")
    text(nil, "b1", 236, 866, "CONDITION: {lc_alert == \"red\" ? \"ALERT\" : \"NORMAL\"}   HULL {lc_hull|%d}%   CORE {lc_core|%d}%", 24, P.k, "left")
    E.port{role = "q", r = 8, width = 2, glow = 0}
  end
  local function nav()
    local sc, S = E.sc(), E.S()
    E.navbtns({{"SENSORS", "sens", "s"}, {"ENGINEER", "eng", "k"}, {"TACTICAL", "tac", "x"}, {"SHIP", "ship", "t"}}, {x = 30, y = 188, w = 180, h = 50, dy = 62, r = 6, size = 26, align = "left", padX = 14})
    sc:rect{id = "marker", x = 22, y = 190, w = 3, h = 46, fill = S.pal.normal.p}
    E.logbtn{x = 30, y = 448, w = 180, h = 48, r = 6, role = "p", size = 24, align = "left", shrink = "LOG  -  SHRINK", expand = "LOG  -  EXPAND"}
  end
  E.register{
    name = "soft", font = "Rajdhani", weight = "700", sharp = false, bloom = 0.08,
    fonts = {{"Rajdhani", "fonts/Rajdhani-Medium.ttf", "500"}, {"Rajdhani", "fonts/Rajdhani-Bold.ttf", "700"}},
    pal = {
      normal = {p = "#d98a63", s = "#e6d6c4", t = "#8e99a3", q = "#5e8e96", x = "#e0b48e", r = "#c26b5a", k = "#9cc2c6", bg = "#090b0d"},
      red    = {p = "#d9a441", s = "#e6d6c4", t = "#8e99a3", q = "#b58a3c", x = "#e0b48e", r = "#d9a441", k = "#d8c08a", bg = "#0e0b07"},
    },
    alertEdge = "#d9a441", frame = frame, nav = nav,
    mark = function(i) E.sc():get("marker"):animate{y = 190 + (i - 1) * 62, dur = 0.5, ease = "inOutCubic"} end,
  }
end
