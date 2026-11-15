-- Bridge: a wraparound wall of angled black-glass screens, dense small readouts, a rotating wireframe schematic of an invented
-- starship in the middle, thin red strip lighting and a warm floor glow. The real text port is one panel of the wall.
-- Own line geometry. Type: Rajdhani (SIL OFL).
return function(E)
  local L, gfx = E.L, E.gfx
  local CY, RED, AMB = "#4fd6e8", "#ff3b2f", "#e8a23a"
  local function glass(sc, id, x, y, w, h, skew)
    sc:rect{id = id, x = x, y = y, w = w, h = h, r = 12, skewY = skew, z = -6, stroke = "#313a42", strokeWidth = 2,
      fill = {type = "linear", angle = 160, stops = {{0, "#10161b"}, {1, "#04060a"}}}}
    sc:rect{id = id .. "s", x = x, y = y, w = w, h = h, r = 12, skewY = skew, z = 40, opacity = 0.5,   -- glass sheen
      fill = {type = "linear", angle = 115, stops = {{0, "#ffffff22"}, {0.35, "#ffffff00"}, {1, "#ffffff08"}}}}
  end
  local function small(parent, id, x, y, str, size, fill, align)
    return E.text(parent, id, x, y, str, size or 16, fill or "#9fd0d8", align or "left", {weight = "500"})
  end
  local function frame()
    local sc, S, T, text = E.sc(), E.S(), E.T, E.text
    local P = S.pal.normal
    sc:rect{id = "floor", x = 0, y = 850, w = 1600, h = 50, z = -8, fill = {type = "linear", angle = 180, stops = {{0, "#e8a23a00"}, {1, "#e8a23a66"}}}}
    glass(sc, "gA", 20, 100, 210, 740, -3)
    glass(sc, "gB", 240, 100, 800, 524, 0)
    glass(sc, "gC", 1110, 100, 470, 740, 3)
    -- thin red strip lighting along the panel edges (pulses on alert)
    for i, r in ipairs{{236, 92, 808}, {1106, 92, 478}, {16, 92, 218}} do
      T("p", sc:rect{id = "strip" .. i, x = r[1], y = r[2], w = r[3], h = 3, fill = P.p, glow = 0.35, skewY = i == 2 and 3 or (i == 3 and -3 or 0)})
    end
    T("x", sc:rect{id = "rail1", x = 240, y = 630, w = 800, h = 4, fill = P.x, opacity = 0.9})
    T("s", sc:rect{id = "rail2", x = 240, y = 836, w = 1340, h = 3, fill = P.s, opacity = 0.7})
    text(nil, "bh1", 250, 72, "ENDEAVOUR  -  OPERATIONS WALL   {lc_mode|upper}", 30, P.s, "left")
    text(nil, "bh2", 1570, 72, "SD {lc_sd|%.1f}", 26, P.x, "right")
    text(nil, "bf1", 250, 862, "CONDITION {lc_alert == \"red\" ? \"RED\" : \"GREEN\"}   HULL {lc_hull|%d}%   SHIELDS {lc_pw_shields|%d}%   CORE {lc_core|%d}%", 22, P.k, "left")
    E.port{role = "x", r = 8, width = 2, glow = 0}
    -- left panel: tiny bars, blinking indicator grid, glyph dial
    local a = sc:group{id = "bA", x = 20, y = 100}
    small(a, "a0", 14, 22, "POWER GRID", 18, P.x)
    local names = {"WARP", "IMPULSE", "SHIELDS", "WEAPONS", "SENSORS", "LIFE"}
    for i, n in ipairs(names) do
      small(a, "an" .. i, 14, 62 + (i - 1) * 40, n, 15, P.k)
      sc:rect{parent = a, id = "at" .. i, x = 14, y = 72 + (i - 1) * 40, w = 180, h = 8, r = 2, fill = "#1a232a"}
      T("p", sc:rect{parent = a, id = "af" .. i, x = 14, y = 72 + (i - 1) * 40, w = 10, h = 8, r = 2, fill = P.p}):bind("w", "max(6, lc_pw_" .. ({"warp", "impulse", "shields", "weapons", "sensors", "life"})[i] .. " * 1.8)", 0.9)
    end
    for r = 0, 6 do for c = 0, 5 do
      local o = sc:rect{parent = a, id = string.format("lg%d_%d", r, c), x = 14 + c * 32, y = 330 + r * 26, w = 24, h = 14, r = 2, fill = ((r + c) % 3 == 0) and RED or CY, opacity = 0.9}
      if (r * 5 + c * 3) % 4 ~= 0 then o:animate{opacity = {from = 0.9, to = 0.12}, dur = 0.6 + ((r + c) % 5) * 0.4, ease = "steps(2)", loop = "inf", yoyo = true, delay = (r * c) % 4 * 0.3} end
    end end
    local d = sc:arc{parent = a, id = "gd", x = 105, y = 600, r0 = 60, r1 = 66, a0 = 20, a1 = 300, fill = CY}
    d:animate{rotation = {from = 0, to = 360}, dur = 14, ease = "linear", loop = "inf"}
    local d2 = sc:arc{parent = a, id = "gd2", x = 105, y = 600, r0 = 40, r1 = 44, a0 = 200, a1 = 500, fill = AMB}
    d2:animate{rotation = {from = 360, to = 0}, dur = 9, ease = "linear", loop = "inf"}
    small(a, "a9", 105, 690, "DEFLECTOR PHASE", 14, P.k, "center")
    -- right panel: line graphs, rolling data columns
    local c = sc:group{id = "bC", x = 1110, y = 100}
    small(c, "c0", 16, 22, "TELEMETRY", 18, P.x)
    local srcs = {{"lc_trend", "WARP FIELD", 0, 100}, {"lc_core", "CORE TEMP", 30, 100}, {"lc_hull", "HULL INTEGRITY", 0, 100}}
    for i, g in ipairs(srcs) do
      sc:graph{parent = c, id = "gr" .. i, x = 16, y = 50 + (i - 1) * 118, w = 300, h = 80, source = g[1], samples = 50, interval = 1, min = g[3], max = g[4], stroke = (i == 2) and RED or CY,
        strokeWidth = 2, fill = {type = "linear", angle = 180, stops = {{0, "#4fd6e844"}, {1, "#4fd6e800"}}}}
      small(c, "gl" .. i, 16, 138 + (i - 1) * 118 + 6, g[2], 13, P.k)
    end
    local col = sc:group{parent = c, id = "cols", x = 330, y = 50, clip = {0, 0, 130, 340}}
    local rows = {}
    for i = 1, 40 do rows[#rows + 1] = string.format("%04X %03d  %s", (i * 2749) % 65535, (i * 37) % 999, (i % 3 == 0) and "OK" or "..") end
    local t = small(col, "colt", 0, 0, table.concat(rows, "\n"), 14, "#7fb8c0")
    t:set{baseline = "top"}
    t:animate{y = {from = 0, to = -560}, dur = 40, ease = "linear", loop = "inf"}
    for i = 1, 6 do
      small(c, "ct" .. i, 16, 440 + (i - 1) * 26, "{lc_n" .. i .. "|pad:-13} {lc_t" .. i .. "}  {lc_b" .. i .. "|%03d}  {lc_r" .. i .. "|%3d}", 17, P.k)
    end
    small(c, "c9", 16, 616, "CONTACT TABLE", 13, P.x)
    for r = 0, 3 do for k = 0, 11 do
      local o = sc:rect{parent = c, id = string.format("cg%d_%d", r, k), x = 16 + k * 20, y = 650 + r * 16, w = 14, h = 9, fill = ((r * 3 + k) % 5 == 0) and AMB or CY, opacity = 0.8}
      if (r + k) % 3 == 0 then o:animate{opacity = {from = 0.8, to = 0.1}, dur = 0.5 + (k % 4) * 0.3, ease = "steps(1)", loop = "inf", yoyo = true, delay = r * 0.2} end
    end end
    -- centre: the wireframe schematic (an invented ship, drawn from lines), turning slowly
    local b = sc:group{id = "bB", x = 240, y = 100}
    small(b, "b0", 16, 22, "TACTICAL SCHEMATIC", 18, P.x)
    local ship = sc:group{parent = b, id = "ship", x = 330, y = 200}
    local function wire(id, pts, closed) sc:polyline{parent = ship, id = id, points = pts, closed = closed, stroke = CY, strokeWidth = 2, opacity = 0.9} end
    for i, rx in ipairs{150, 112, 76, 40} do sc:ellipse{parent = ship, id = "sau" .. i, x = 0, y = -30, rx = rx, ry = rx * 0.42, stroke = CY, strokeWidth = i == 1 and 2.5 or 1.5, fill = "none"} end
    for k = 0, 7 do local a = math.rad(k * 45) sc:line{parent = ship, id = "sp" .. k, x1 = 40 * math.cos(a), y1 = -30 + 17 * math.sin(a), x2 = 150 * math.cos(a), y2 = -30 + 63 * math.sin(a), stroke = CY, strokeWidth = 1, opacity = 0.5} end
    sc:ellipse{parent = ship, id = "hullo", x = 110, y = 90, rx = 112, ry = 28, stroke = CY, strokeWidth = 2, fill = "none"}
    sc:ellipse{parent = ship, id = "hulli", x = 120, y = 90, rx = 70, ry = 14, stroke = CY, strokeWidth = 1, fill = "none", opacity = 0.7}
    wire("neck1", {40, -8, 80, 66}, false)
    wire("neck2", {-6, -2, 20, 70}, false)
    sc:rect{parent = ship, id = "nac1", x = 150, y = 20, w = 230, h = 26, r = 13, stroke = CY, strokeWidth = 2, fill = "none"}
    sc:rect{parent = ship, id = "nac2", x = 150, y = 160, w = 230, h = 26, r = 13, stroke = CY, strokeWidth = 2, fill = "none"}
    wire("py1", {190, 70, 210, 46}, false)
    wire("py2", {190, 110, 210, 160}, false)
    for _, lab in ipairs{{"DEFLECTOR", -190, -90}, {"SENSOR ARRAY", -150, 10}, {"WARP CORE", 70, 140}, {"IMPULSE", 300, 100}} do
      small(ship, "lb" .. lab[1], lab[2], lab[3], lab[1], 13, AMB)
    end
    ship:animate{scaleX = {from = 0.86, to = 1.0}, dur = 8, ease = "inOutSine", loop = "inf", yoyo = true}
    sc:rect{parent = b, id = "scan", x = 0, y = 60, w = 800, h = 3, fill = "#4fd6e866"}:animate{y = {from = 60, to = 430}, dur = 6, ease = "linear", loop = "inf"}
  end
  local function nav()
    E.navbtns({{"SENS", "sens", "x"}, {"ENG", "eng", "s"}, {"TAC", "tac", "p"}, {"SHIP", "ship", "k"}}, {x = 560, y = 104, w = 92, h = 28, dx = 100, r = 3, size = 17, color = "#0a0d10"})
    E.logbtn{x = 960, y = 104, w = 80, h = 28, r = 3, role = "x", size = 15, color = "#0a0d10", shrink = "LOG -", expand = "LOG +"}
  end
  -- overlays on the schematic, one set per console (coordinates relative to the centre panel)
  local function overlay(name, parent)
    local sc, S, T = E.sc(), E.S(), E.T
    sc:get("c_" .. name):set{x = 240, y = 100}
    local P = S.pal.normal
    if name == "sens" then
      local r = sc:circle{parent = parent, id = "reticle", x = 330, y = 170, r = 128, stroke = AMB, strokeWidth = 2, fill = "none", glow = 0.3}
      r:animate{scaleX = {from = 0.9, to = 1.08}, scaleY = {from = 0.9, to = 1.08}, dur = 2.2, ease = "inOutSine", loop = "inf", yoyo = true}
      for i = 1, 6 do
        local d = sc:circle{parent = parent, id = "bl" .. i, x = 400, y = 250, r = 6, fill = (i == 2 or i == 6) and RED or CY, glow = 0.4}
        d:bind("x", "400 + 300 * sin(lc_b" .. i .. " * 0.0174533)", 0.9)
        d:bind("y", "250 - 170 * cos(lc_b" .. i .. " * 0.0174533)", 0.9)
      end
    elseif name == "eng" then
      local paths = {{-40, 60, 330, 50}, {-20, 20, 280, 10}, {30, 110, 260, 150}}
      for i, p in ipairs(paths) do
        sc:line{parent = parent, id = "cd" .. i, x1 = 400 + p[1], y1 = 250 + p[2], x2 = 400 + p[3], y2 = 250 + p[4], stroke = AMB, strokeWidth = 2, opacity = 0.6}
        local dot = sc:circle{parent = parent, id = "fl" .. i, x = 400 + p[1], y = 250 + p[2], r = 5, fill = "#ffe9a0", glow = 0.8}
        dot:animate{x = {from = 400 + p[1], to = 400 + p[3]}, y = {from = 250 + p[2], to = 250 + p[4]}, dur = 1.6 + i * 0.5, ease = "linear", loop = "inf"}
      end
      local c = sc:circle{parent = parent, id = "corep", x = 470, y = 380, r = 20, fill = "#4fd6e8", opacity = 0.5, glow = 0.6}
      c:bind("scaleX", "0.6 + lc_core / 100", 0.8)
      c:bind("scaleY", "0.6 + lc_core / 100", 0.8)
      c:animate{opacity = {from = 0.3, to = 0.8}, dur = 1.4, ease = "inOutSine", loop = "inf", yoyo = true}
    elseif name == "tac" then
      for i, r in ipairs{200, 222, 244} do
        local a = sc:arc{parent = parent, id = "shd" .. i, x = 440, y = 270, r0 = r - 30, r1 = r - 25, a0 = 200, a1 = 340, fill = CY, glow = 0.5}
        a:bind("opacity", "clamp((lc_pw_shields - " .. ((i - 1) * 25) .. ") / 25, 0.1, 1)", 0.8)
      end
      local f = sc:button{parent = parent, id = "fire", x = 640, y = 440, w = 130, h = 34, r = 4, fill = RED, text = "FIRE", color = "#0a0d10", size = 20, font = S.font, weight = "700"}
      f:state("hover", {fill = "#ff7a6a"}, {dur = 0.1})
      f:on("click", function()
        for i = 1, 3 do sc:get("shd" .. i):animate{opacity = {from = 1, to = 0.2}, dur = 0.45, ease = "outQuad"} end
      end)
    elseif name == "ship" then
      local zones = {{"sh_dm_port", 595, 233, "PORT NACELLE"}, {"sh_dm_stbd", 595, 373, "STBD NACELLE"}, {"sh_dm_hull", 440, 290, "HULL"}}
      for i, z in ipairs(zones) do
        local c = sc:circle{parent = parent, id = "dz" .. i, x = z[2], y = z[3], r = 26, fill = RED, opacity = 0.2, glow = 0.6}
        c:bind("opacity", "0.12 + (1 - " .. z[1] .. " / " .. (i == 3 and 875 or 100) .. ") * 1.4", 0.8)
        c:animate{scaleX = {from = 0.7, to = 1.15}, scaleY = {from = 0.7, to = 1.15}, dur = 1.1 + i * 0.3, ease = "inOutSine", loop = "inf", yoyo = true}
        E.text(parent, "dzl" .. i, z[2] + 34, z[3], z[4] .. "  {" .. z[1] .. "|%.0f}", 15, AMB, "left", {weight = "500"})
      end
    end
  end
  -- the wall's own layout policy: while the text grows the panels shrink (uniformly) toward the top, the schematic with its overlays
  local function layout(ex, instant, mv)
    local sc = E.sc()
    local k = ex and 0.3 or 1
    mv(sc:get("bB"), {scaleX = k, scaleY = k}, instant)
    for _, n in ipairs{"sens", "eng", "tac", "ship"} do mv(sc:get("c_" .. n), {scaleX = k, scaleY = k}, instant) end
    local kc = ex and 0.4 or 1
    mv(sc:get("bC"), {scaleX = kc, scaleY = kc}, instant)
    mv(sc:get("bA"), {scaleX = ex and 0.55 or 1, scaleY = ex and 0.55 or 1}, instant)
  end
  E.register{
    name = "bridge", conY = 100, font = "Rajdhani", weight = "700", sharp = true, bloom = 0.5, frame = frame, nav = nav, layout = layout, tscale = 1,
    fonts = {{"Rajdhani", "fonts/Rajdhani-Medium.ttf", "500"}, {"Rajdhani", "fonts/Rajdhani-Bold.ttf", "700"}},
    consoles = {sens = function(p) overlay("sens", p) end, eng = function(p) overlay("eng", p) end, tac = function(p) overlay("tac", p) end, ship = function(p) overlay("ship", p) end},
    pal = {
      normal = {p = "#ff3b2f", s = "#efe6d2", t = "#4a2a14", q = "#2a3a44", x = "#e8923a", r = "#ff7a2a", k = "#7fd0dc", bg = "#040506"},
      red    = {p = "#ff1a1a", s = "#ffb8a0", t = "#5a1010", q = "#3a1a1a", x = "#ff6a2a", r = "#ff3a1a", k = "#ff9a8a", bg = "#0a0304"},
    },
    alertEdge = "#ff2a1f",
  }
end
