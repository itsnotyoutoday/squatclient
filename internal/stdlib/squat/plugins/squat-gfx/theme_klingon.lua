-- Klingon: black, blood red and dull gold; hard jagged plates, blade motifs, an angular tactical plot instead of a radar dish.
-- Own abstract artwork. Type is Teko (SIL OFL): heavy, angular, condensed.
return function(E)
  local L, gfx = E.L, E.gfx
  -- a zig-zag edge: teeth along x0..x1 at y, pointing up (dir=-1) or down (dir=1)
  local function zig(x0, x1, y, depth, teeth, dir)
    local pts, step = {}, (x1 - x0) / teeth
    for i = 0, teeth do
      pts[#pts + 1] = x0 + i * step
      pts[#pts + 1] = y + ((i % 2 == 1) and depth * dir or 0)
    end
    return pts
  end
  local function frame()
    local sc, S, T, text = E.sc(), E.S(), E.T, E.text
    local P = S.pal.normal
    -- top plate with a jagged lower edge, bottom plate with a jagged upper edge
    local top = zig(236, 1580, 84, 26, 36, 1)
    local poly = {20, 14}
    for i = 1, #top do poly[#poly + 1] = top[i] end
    for _, v in ipairs{1580, 14} do poly[#poly + 1] = v end
    T("t", sc:polygon{id = "topplate", points = poly, fill = P.t, stroke = P.p, strokeWidth = 2})
    local bot = zig(236, 1580, 830, 26, 36, -1)
    local bp = {}
    for i = 1, #bot do bp[#bp + 1] = bot[i] end
    for _, v in ipairs{1580, 886, 236, 886} do bp[#bp + 1] = v end
    T("t", sc:polygon{id = "botplate", points = bp, fill = P.t, stroke = P.p, strokeWidth = 2})
    -- a blade motif: three tapering spikes in dull gold at the top left
    T("x", sc:polygon{id = "blade1", points = {20, 14, 230, 14, 150, 104, 20, 300}, fill = P.x})
    T("p", sc:polygon{id = "blade2", points = {20, 300, 150, 104, 190, 330, 20, 620}, fill = P.p})
    T("s", sc:polygon{id = "blade3", points = {20, 620, 190, 330, 200, 700, 20, 886}, fill = P.s, opacity = 0.9})
    text(nil, "k1", 262, 46, "IKV  BATTLEWORTHY   //   {lc_mode|upper}", 42, P.x, "left", {glow = 0})
    text(nil, "k2", 1570, 46, "{lc_sd|%.1f}", 38, P.x, "right")
    text(nil, "k3", 262, 862, "HULL {lc_hull|%d}   CORE {lc_core|%d}   LOCK {lc_lock}   {lc_alert == \"red\" ? \"BATTLE STATIONS\" : \"READY\"}", 32, P.x, "left")
    -- battle damage: scratches that flicker in stepped jumps
    for i = 1, 4 do
      local d = sc:line{id = "scratch" .. i, x1 = 300 + i * 260, y1 = 120 + (i % 2) * 40, x2 = 340 + i * 260, y2 = 170 + (i % 2) * 40, strokeWidth = 2, stroke = P.r, opacity = 0.0}
      d:animate{opacity = {from = 0, to = 0.8}, dur = 0.9 + i * 0.4, ease = "steps(2)", loop = "inf", yoyo = true, delay = i * 0.7}
    end
    E.port{role = "x", r = 0, width = 3, glow = 0.1}
  end
  local function nav()
    local sc, S = E.sc(), E.S()
    E.navbtns({{"SCAN", "sens", "x"}, {"POWER", "eng", "r"}, {"WEAPONS", "tac", "p"}, {"DAMAGE", "ship", "s"}, {"OPS", "op", "k"}}, {x = 30, y = 340, w = 160, h = 58, dy = 72, r = 0, size = 34, align = "left", padX = 16, color = "#080203"})
    for i = 1, 5 do sc:get("nav" .. i):set{skewX = 10} end
    E.logbtn{x = 30, y = 722, w = 160, h = 54, r = 0, role = "x", size = 28, align = "left", shrink = "LOG  <", expand = "LOG  >"}
  end
  -- the radar becomes an angular tactical plot: hexagonal rings, a turning blade, contacts as diamonds
  local function plot(rdg)
    local sc, S, T = E.sc(), E.S(), E.T
    local P = S.pal.normal
    local function hex(id, r, role, w)
      local pts = {}
      for k = 0, 5 do
        local a = math.rad(60 * k + 30)
        pts[#pts + 1] = r * math.cos(a)
        pts[#pts + 1] = r * math.sin(a)
      end
      T(role, sc:polygon{parent = rdg, id = id, points = pts, stroke = P[role], strokeWidth = w, fill = "none"}, false, "stroke")
    end
    sc:polygon{parent = rdg, id = "plotbg", points = {0, -208, 180, -104, 180, 104, 0, 208, -180, 104, -180, -104}, fill = "#120305"}
    hex("hx1", 208, "p", 4); hex("hx2", 156, "t", 2); hex("hx3", 104, "t", 2); hex("hx4", 52, "t", 2)
    T("t", sc:line{parent = rdg, id = "ax1", x1 = -180, y1 = 0, x2 = 180, y2 = 0, stroke = P.t, strokeWidth = 1.5}, false, "stroke")
    T("t", sc:line{parent = rdg, id = "ax2", x1 = 0, y1 = -208, x2 = 0, y2 = 208, stroke = P.t, strokeWidth = 1.5}, false, "stroke")
    local blade = sc:group{parent = rdg, id = "blade"}
    blade:bind("rotation", "mod(time() * 70, 360)")
    sc:polygon{parent = blade, points = {0, 0, -12, -190, 12, -190}, fill = "#c1121f55"}
    T("p", sc:line{parent = blade, x1 = 0, y1 = 0, x2 = 0, y2 = -200, stroke = P.p, strokeWidth = 3}, false, "stroke")
    local colors = {F = "#d4b86a", H = "#ff3b3b", N = "#c8c8c8", U = "#ffffff"}
    local types = {"F", "H", "N", "U", "F", "H"}
    for i = 1, 6 do
      local d = sc:polygon{parent = rdg, id = "dot" .. i, points = {0, -10, 10, 0, 0, 10, -10, 0}, fill = colors[types[i]], glow = 0.5}
      d:bind("x", "180 * lc_r" .. i .. " / 100 * 0.92 * sin(lc_b" .. i .. " * 0.0174533)", 0.9)
      d:bind("y", "-180 * lc_r" .. i .. " / 100 * 0.92 * cos(lc_b" .. i .. " * 0.0174533)", 0.9)
    end
    -- a disruptor lock: a turning bracket
    local k = sc:arc{parent = rdg, id = "lockarc", x = 0, y = 0, r0 = 218, r1 = 226, a0 = 0, a1 = 70, fill = P.x}
    k:animate{rotation = {from = 0, to = 360}, dur = 6, ease = "linear", loop = "inf"}
  end
  -- heavy red alert: the whole border pulses hard (calm softens it, see lcars.lua)
  E.register{
    name = "klingon", ctscale = 0.78, font = "Teko", weight = "600", sharp = true, bloom = 0.5, radar = plot,
    fonts = {{"Teko", "fonts/Teko-VF.ttf", "300 700"}},
    pal = {
      normal = {p = "#c1121f", s = "#8a8d93", t = "#240709", q = "#3a0a0f", x = "#c9a84c", r = "#e63946", k = "#d4b86a", bg = "#050102"},
      red    = {p = "#ff2a2a", s = "#b0b4ba", t = "#4a0a0c", q = "#5a0d10", x = "#ffd24a", r = "#ff5a5a", k = "#ffe08a", bg = "#120204"},
    },
    alertEdge = "#ff2020", frame = frame, nav = nav,
  }
end
