-- Ferengi: a ship's bridge/ops console in warm gold, amber and bronze on a deep maroon-black: organic rounded forms, an ornate
-- double frame with sweeping filigree, a band of script-like glyphs and a ladder of glyph meters, all drawn as our own abstract
-- artwork (strokes generated from a seed, no show assets). The four consoles (sensors, engineering, tactical, ship status /
-- damage) are the shared ones, with the real ship data; the frame, names, glyph meters and status strip are this theme's.
-- Type is Cinzel (SIL OFL).
return function(E)
  local L, gfx = E.L, E.gfx

  -- a script-like glyph: a handful of curved strokes and hooks from a seed (own artwork), about s units tall
  local function glyph(sc, id, x, y, s, seed, stroke, opacity)
    local n = seed
    local function rnd() n = (n * 1103515245 + 12345) % 2147483648; return n / 2147483648 end
    local d = {}
    local nstroke = 2 + math.floor(rnd() * 2)
    for i = 1, nstroke do
      local x0, y0 = rnd() * s * 0.8, rnd() * s
      local x1, y1 = rnd() * s, rnd() * s
      local cx1, cy1 = (rnd() - 0.2) * s * 1.2, (rnd() - 0.2) * s * 1.2
      local cx2, cy2 = (rnd() - 0.2) * s * 1.2, (rnd() - 0.2) * s * 1.2
      d[#d + 1] = string.format("M %.1f %.1f C %.1f %.1f, %.1f %.1f, %.1f %.1f", x0, y0, cx1, cy1, cx2, cy2, x1, y1)
    end
    return sc:path{id = id, x = x, y = y, d = table.concat(d, " "), stroke = stroke, strokeWidth = 2, fill = "none", opacity = opacity or 0.9}
  end

  local function frame()
    local sc, S, T, text = E.sc(), E.S(), E.T, E.text
    local P = S.pal.normal
    -- ornate double frame: outer gold, inner bronze, filigree sweeps in the four corners (kept clear of every widget)
    T("p", sc:rect{id = "fr1", x = 10, y = 8, w = 1580, h = 884, r = 46, stroke = P.p, strokeWidth = 4, fill = "none", glow = 0.15}, false, "stroke")
    T("t", sc:rect{id = "fr2", x = 24, y = 22, w = 1552, h = 856, r = 34, stroke = P.t, strokeWidth = 2, fill = "none"}, false, "stroke")
    local corners = {
      {"M 44 140 C 44 70, 80 44, 150 44 C 110 70, 100 100, 114 140", 1},
      {"M 1556 140 C 1556 70, 1520 44, 1450 44 C 1490 70, 1500 100, 1486 140", 1},
      {"M 44 760 C 44 830, 80 856, 150 856 C 110 830, 100 800, 114 760", 1},
      {"M 1556 836 C 1556 850, 1530 856, 1496 856 C 1518 848, 1526 842, 1524 836", 1},
    }
    for i, c in ipairs(corners) do T("x", sc:path{id = "fil" .. i, d = c[1], stroke = P.x, strokeWidth = 3, fill = "none"}, false, "stroke") end
    -- an arc of bronze along the top, above the title
    T("t", sc:path{id = "orn1", d = "M 330 38 C 600 20, 1000 20, 1270 38", stroke = P.t, strokeWidth = 2, fill = "none"}, false, "stroke")
    -- the console's name changes with the console
    text(nil, "f1", 800, 60, "ENDEAVOUR OPS  -  {lc_mode == \"sens\" ? \"SENSORS\" : (lc_mode == \"eng\" ? \"ENGINEERING\" : (lc_mode == \"tac\" ? \"TACTICAL\" : (lc_mode == \"op\" ? \"OPERATIONS\" : \"SHIP STATUS / DAMAGE\")))}", 36, P.x, "center", {glow = 0.1})
    text(nil, "f2", 1410, 100, "SD {lc_sd|%.1f}", 20, P.k, "right")
    -- a band of glyphs (decoration) under the title
    for i = 1, 30 do glyph(sc, "gly" .. i, 250 + (i - 1) * 36, 86, 22, 7 + i * 31, i % 5 == 0 and P.x or P.t, 0.8) end
    -- status strip, with the hull and core tallies drawn as ten glyph strokes each
    text(nil, "f3", 250, 862, "HULL {lc_hull|%d}%   CORE {lc_core|%d}%   SHIELDS {lc_pw_shields|%d}%   LOCK {lc_lock}", 22, P.k, "left")
    -- the left column: glyph meters, one per ship system, bound to the power levels
    local sys = {"warp", "impulse", "shields", "weapons", "sensors", "life"}
    for i, name in ipairs(sys) do
      local y = 500 + (i - 1) * 36
      glyph(sc, "gly_m" .. i, 46, y - 12, 24, 900 + i * 17, P.x, 0.9)
      sc:rect{id = "mt" .. i, x = 82, y = y, w = 120, h = 6, r = 3, fill = "#2a0f16"}
      T("p", sc:rect{id = "mf" .. i, x = 82, y = y, w = 10, h = 6, r = 3, fill = P.p, glow = 0.2}):bind("w", "max(6, lc_pw_" .. name .. " * 1.2)", 0.9)
    end
    sc:emitter{id = "orn_sparkle", x = 130, y = 740, rate = 3, lifeMin = 0.8, lifeMax = 1.6, speedMin = 8, speedMax = 24, angle = 270, spread = 40, sizeStart = 7, sizeEnd = 1, colorStart = "#ffe9a0", colorEnd = "#ffcf5a00", glow = 0.4, radius = 22}
    E.port{role = "p", r = 14, width = 3, glow = 0.1}
  end
  local function nav()
    E.navbtns({{"SENSORS", "sens", "p"}, {"ENGINEERING", "eng", "s"}, {"TACTICAL", "tac", "r"}, {"DAMAGE CONTROL", "ship", "x"}, {"OPERATIONS", "op", "k"}},
      {x = 40, y = 170, w = 180, h = 42, dy = 48, r = 21, size = 17, align = "center", color = "#1a0508"})
    E.logbtn{x = 40, y = 420, w = 180, h = 44, r = 22, role = "x", size = 18, color = "#1a0508"}
  end
  -- an ornate frame for the viewscreen and a rounder, smaller sensor dish (inside the main frame)
  local function vsframe(vsg)
    local sc, S, T = E.sc(), E.S(), E.T
    local P = S.pal.normal
    T("p", sc:rect{parent = vsg, id = "vsframe", x = 0, y = 0, w = 800, h = 420, r = 36, stroke = P.p, strokeWidth = 5, fill = "none", glow = 0.3}, false, "stroke")
  end
  local function radar(rdg)
    local sc, S, T = E.sc(), E.S(), E.T
    local P = S.pal.normal
    T("p", sc:arc{parent = rdg, id = "rdring", x = 0, y = 0, r0 = 184, r1 = 192, a0 = 0, a1 = 360, fill = P.p, glow = 0.35})
    sc:radar{parent = rdg, id = "radar", x = 0, y = 0, r = 178, trail = 110, rings = 4, color = P.x, bg = "#120608", glow = 0.7}
    local rd = sc:get("radar")
    rd:bind("sweep", "mod(time() * 80, 360)")
    rd:bind("contacts", "lc_ct")
  end
  E.register{
    name = "ferengi", ctscale = 0.78, font = "Cinzel", weight = "600", sharp = false, bloom = 0.35, tscale = 0.84,
    fonts = {{"Cinzel", "fonts/Cinzel-VF.ttf", "400 900"}},
    pal = {
      normal = {p = "#d4a017", s = "#e8c872", t = "#8c5a2b", q = "#7a2236", x = "#f0d98c", r = "#b5651d", k = "#e6b655", bg = "#12060a"},
      red    = {p = "#e0561c", s = "#f0a060", t = "#7a2a18", q = "#6a1010", x = "#ffd9a0", r = "#e0561c", k = "#ffb070", bg = "#1a0605"},
    },
    alertEdge = "#e0561c", frame = frame, nav = nav, vsframe = vsframe, radar = radar,
  }
end
