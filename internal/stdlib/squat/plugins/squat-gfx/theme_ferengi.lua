-- Ferengi: warm gold, bronze and deep maroon; ornate rounded frames with filigree curves, coins and a ledger drawn as abstract
-- shapes, animated latinum bars with profit and loss, a scrolling price ticker, sparkles. Own artwork and own sayings.
-- Type is Cinzel (SIL OFL).
return function(E)
  local L, gfx = E.L, E.gfx
  local SAYINGS = "A DEAL TODAY BEATS A PROMISE TOMORROW   *   EVERY CREDIT COUNTED IS A CREDIT KEPT   *   PROFIT IS JUST POLITE ARITHMETIC   *   NEVER HAGGLE ON AN EMPTY STOMACH   *   INTEREST IS PATIENCE WITH A PRICE TAG   *   "
  local function coin(sc, S, T, id, x, y, r, delay, parent)
    local P = S.pal.normal
    local g = sc:group{id = id, x = x, y = y, parent = parent}
    T("p", sc:ellipse{parent = g, rx = r, ry = r, fill = P.p, stroke = P.x, strokeWidth = 3, glow = 0.3})
    T("x", sc:ellipse{parent = g, rx = r * 0.62, ry = r * 0.62, fill = "none", stroke = P.x, strokeWidth = 2})
    sc:path{parent = g, d = string.format("M %d 0 L 0 %d L %d 0 L 0 %d Z", -r * 0.3, -r * 0.3, r * 0.3, r * 0.3), stroke = P.x, strokeWidth = 2, fill = "none"}
    g:animate{scaleX = {from = 1, to = 0.1}, dur = 1.1, ease = "inOutSine", loop = "inf", yoyo = true, delay = delay}
    return g
  end
  local function frame()
    local sc, S, T, text = E.sc(), E.S(), E.T, E.text
    local P = S.pal.normal
    -- ornate double frame with filigree corners
    T("p", sc:rect{id = "fr1", x = 10, y = 8, w = 1580, h = 884, r = 40, stroke = P.p, strokeWidth = 4, fill = "none", glow = 0.15}, false, "stroke")
    T("t", sc:rect{id = "fr2", x = 24, y = 22, w = 1552, h = 856, r = 30, stroke = P.t, strokeWidth = 2, fill = "none"}, false, "stroke")
    local corners = {
      {"M 40 150 C 40 60, 90 40, 170 40 C 120 70, 110 110, 130 150", 1, 1},
      {"M 1560 150 C 1560 60, 1510 40, 1430 40 C 1480 70, 1490 110, 1470 150", 1, 1},
      {"M 40 750 C 40 840, 90 860, 170 860 C 120 830, 110 790, 130 750", 1, 1},
      {"M 1560 750 C 1560 840, 1510 860, 1430 860 C 1480 830, 1490 790, 1470 750", 1, 1},
    }
    for i, c in ipairs(corners) do T("x", sc:path{id = "fil" .. i, d = c[1], stroke = P.x, strokeWidth = 3, fill = "none"}, false, "stroke") end
    text(nil, "f1", 800, 52, "THE GRAND LEDGER  -  {lc_mode|upper}", 38, P.x, "center", {glow = 0.1})
    text(nil, "f2", 250, 86, "SD {lc_sd|%.1f}", 22, P.k, "left")
    -- left column: a shop-counter panel with the latinum balance and spinning coins
    T("q", sc:rect{id = "counter", x = 40, y = 120, w = 180, h = 420, r = 20, fill = P.q, stroke = P.p, strokeWidth = 3})
    text(nil, "c1", 130, 150, "COUNTER", 24, P.x, "center")
    text(nil, "c2", 130, 190, "LATINUM", 18, P.k, "center")
    text(nil, "c3", 130, 226, "{fg_8 * 1000|%d}", 30, P.x, "center")
    text(nil, "c4", 130, 262, "{fg_profit >= 0 ? \"PROFIT\" : \"LOSS\"} {fg_profit|%+d}", 20, P.k, "center")
    coin(sc, S, T, "coin1", 80, 340, 28, 0)
    coin(sc, S, T, "coin2", 130, 400, 28, 0.35)
    coin(sc, S, T, "coin3", 180, 340, 28, 0.7)
    sc:emitter{id = "sparkle", x = 130, y = 470, rate = 8, lifeMin = 0.8, lifeMax = 1.6, speedMin = 10, speedMax = 40, angle = 0, spread = 360, sizeStart = 9, sizeEnd = 1, colorStart = "#ffe9a0", colorEnd = "#ffcf5a00", glow = 0.5, radius = 60}
    -- the ticker: prices scroll along the bottom, driven by the renderer
    local clip = sc:group{id = "tickclip", x = 250, y = 840, clip = {0, 0, 1000, 34}}
    local t = text(clip, "tick", 0, 17, SAYINGS .. SAYINGS, 26, P.x, "left")
    t:animate{x = {from = 0, to = -2600}, dur = 70, ease = "linear", loop = "inf"}
    text(nil, "f3", 1290, 856, "HULL {lc_hull|%d}%  CORE {lc_core|%d}%", 22, P.k, "left")
    E.port{role = "p", r = 14, width = 3, glow = 0.1}
  end
  local function nav()
    local sc, S = E.sc(), E.S()
    E.navbtns({{"SENSORS", "sens", "p"}, {"CASHIER", "eng", "x"}, {"ARMORY", "tac", "t"}, {"VAULT", "ship", "q"}}, {x = 40, y = 566, w = 180, h = 44, dy = 50, r = 22, size = 20, align = "center", color = "#1a0508"})
    E.logbtn{x = 40, y = 770, w = 180, h = 44, r = 22, role = "x", size = 18, shrink = "SMALL LEDGER", expand = "BIG LEDGER"}
  end
  -- the cashier (engineering) is a chart of latinum: bars grow and shrink, green for profit and red for loss
  local function cashier(parent)
    local sc, S, T, text = E.sc(), E.S(), E.T, E.text
    local P = S.pal.normal
    text(parent, "ch0", 250, 150, "LATINUM, EIGHT QUARTERS", 30, P.x, "left")
    T("t", sc:rect{parent = parent, id = "chbase", x = 250, y = 596, w = 800, h = 3, fill = P.x})
    for i = 1, 8 do
      local x = 262 + (i - 1) * 98
      local b = sc:rect{parent = parent, id = "bar" .. i, x = x, y = 590, w = 70, h = 4, r = 6, fill = "#7fd36b", glow = 0.25}
      b:bind("h", "max(4, fg_" .. i .. " * 4.2)", 0.9)
      b:bind("y", "594 - max(4, fg_" .. i .. " * 4.2)", 0.9)
      if i > 1 then b:bind("fill", "fg_" .. i .. " >= fg_" .. (i - 1) .. " ? \"#7fd36b\" : \"#d9583b\"") end
      text(parent, "bl" .. i, x + 35, 616, "{fg_" .. i .. "|%d}", 24, P.k, "center")
    end
    text(parent, "ch9", 250, 188, "PROFIT {fg_profit|%+d}   POWER {lc_pw_warp|%d}%   SHIELDS {lc_pw_shields|%d}%", 24, P.k, "left")
    coin(sc, S, T, "coin4", 1180, 250, 40, 0, parent)
    coin(sc, S, T, "coin5", 1290, 250, 40, 0.5, parent)
    coin(sc, S, T, "coin6", 1400, 250, 40, 1.0, parent)
    text(parent, "ch10", 1290, 330, "COUNT TWICE, SPEND ONCE", 22, P.x, "center")
  end
  E.register{
    name = "ferengi", font = "Cinzel", weight = "600", sharp = false, bloom = 0.35, tscale = 0.84, consoles = {eng = cashier},
    fonts = {{"Cinzel", "fonts/Cinzel-VF.ttf", "400 900"}},
    pal = {
      normal = {p = "#d4a017", s = "#e8c872", t = "#8c5a2b", q = "#5a1424", x = "#f0d98c", r = "#b5651d", k = "#e6b655", bg = "#12060a"},
      red    = {p = "#e0561c", s = "#f0a060", t = "#7a2a18", q = "#6a1010", x = "#ffd9a0", r = "#e0561c", k = "#ffb070", bg = "#1a0605"},
    },
    alertEdge = "#e0561c", frame = frame, nav = nav,
  }
end
