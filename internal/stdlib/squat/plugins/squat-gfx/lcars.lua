-- lcars.lua: a TNG-style LCARS console for SquatClient, written in Lua over the /gfx scene language.
--
--   /lcars [sens|eng|tac]     open the console (sensors by default)       /lcars alert red|off
--   /lcars stop               close it                                    /lock N     lock sensors on contact N
--
-- Script work happens on events only: building the scene once, a 1 Hz simulation tick that pushes variables, and
-- button clicks. Everything that moves (radar sweep, starfield, planet spin, warp core, engine plumes, pulses,
-- the eased alert recolouring) runs in the renderer. The variables are gtf's lc_* set (lc_ct, lc_b1, lc_pw_warp,
-- lc_core, lc_alert ...), so a TinyFugue script can drive or read the same display.

local gfx = require("gfx")
local L = {}

local W, H = 1600, 900
local PAL = {
  normal = {p = "#ff9900", s = "#ffcc99", t = "#cc99cc", q = "#9999ff", x = "#ffcc66", r = "#cc6666", k = "#99ccff", bg = "#000000"},
  red    = {p = "#ff2a1f", s = "#ff8a7a", t = "#b3202a", q = "#8a1622", x = "#ff5a44", r = "#ff2a1f", k = "#ffb0a0", bg = "#140000"},
}
local SYSTEMS = {
  {"warp", "WARP", "x"}, {"impulse", "IMPULSE", "p"}, {"shields", "SHIELDS", "q"},
  {"weapons", "WEAPONS", "r"}, {"sensors", "SENSORS", "t"}, {"life", "LIFE SUPPORT", "s"},
}

local sc                 -- the scene
local themed = {}        -- objects recoloured on alert: {obj, role, hover}
local consoles = {}      -- name -> group object
local current = "sens"
local alert = "off"
local timerId
local sim

local function lighten(hex)
  local r, g, b = hex:match("#(%x%x)(%x%x)(%x%x)")
  local f = function(h) return math.min(255, tonumber(h, 16) + 45) end
  return string.format("#%02x%02x%02x", f(r), f(g), f(b))
end

local function pal() return PAL[alert == "red" and "red" or "normal"] end

local function T(role, o, interactive, prop)
  themed[#themed + 1] = {obj = o, role = role, interactive = interactive, prop = prop or "fill"}
  return o
end

local function text(parent, id, x, y, str, size, fill, align, extra)
  local t = {id = id, parent = parent, x = x, y = y, text = str, size = size or 28, fill = fill or "#99ccff", align = align or "left",
    baseline = "middle", weight = "700", font = "Antonio"}
  for k, v in pairs(extra or {}) do t[k] = v end
  return sc:text(t)
end

-- ------------------------------------------------------------------ simulation
local function newSim()
  return {
    sd = 47634.4, hull = 100, core = 62, trend = 50, lock = 0,
    ship = L.shipsim(),
    pw = {warp = 80, impulse = 40, shields = 70, weapons = 55, sensors = 90, life = 100},
    c = {
      {n = "ENDEAVOUR", t = "F", b = 22, r = 35, d = 2}, {n = "BIRD-OF-PREY", t = "H", b = 335, r = 62, d = -3},
      {n = "DS-7 STATION", t = "N", b = 100, r = 55, d = 0}, {n = "UNKNOWN", t = "U", b = 200, r = 85, d = 5},
      {n = "SHUTTLE 12", t = "F", b = 8, r = 18, d = -2}, {n = "ROMULAN", t = "H", b = 290, r = 90, d = 1},
    },
  }
end

local function push()
  local v = {lc_sd = sim.sd, lc_hull = sim.hull, lc_core = sim.core, lc_trend = sim.trend, lc_lock = sim.lock,
    lc_alert = alert, lc_mode = current}
  local ct = {}
  for i, c in ipairs(sim.c) do
    v["lc_n" .. i], v["lc_t" .. i], v["lc_b" .. i], v["lc_r" .. i] = c.n, c.t, c.b, c.r
    ct[#ct + 1] = string.format("%d:%d:%d:%s", i, c.b, c.r, c.t)
  end
  v.lc_ct = table.concat(ct, ";")
  for k, val in pairs(sim.pw) do v["lc_pw_" .. k] = val end
  for k, val in pairs(sim.ship) do v[k] = val end
  gfx.vars(v)
end

local function tick()
  sim.sd = sim.sd + 0.1
  for _, c in ipairs(sim.c) do c.b = (c.b + c.d + 360) % 360 end
  sim.core = math.max(40, math.min(95, sim.core + math.random(-3, 3)))
  sim.trend = math.random(20, 80)
  local sh = sim.ship
  sh.sh_charge = math.min(35000, sh.sh_charge + 2500)
  if sh.sh_charge >= 35000 then sh.sh_charge = 0 end
  sh.sh_deut = sh.sh_deut - 0.7
  sh.sh_dm_port = math.max(40, sh.sh_dm_port + (math.random() - 0.55) * 0.4)
  sh.sh_comp = 55 + math.random(0, 12)
  push()
end

-- ------------------------------------------------------------------ frame
local function frame()
  local P = PAL.normal
  T("p", sc:elbow{id = "el_top", x = 20, y = 20, w = 330, h = 176, ro = 92, ri = 28, bar = 48, side = 190, corner = "tl", fill = P.p, glow = 0.08})
  T("t", sc:elbow{id = "el_bot", x = 20, y = 724, w = 330, h = 156, ro = 80, ri = 26, bar = 44, side = 190, corner = "bl", fill = P.t, glow = 0.08})
  local top = {{354, 300, "p"}, {660, 170, "s"}, {836, 430, "t"}, {1272, 112, "q"}, {1390, 190, "x"}}
  for i, s in ipairs(top) do
    local o = sc:rect{id = "tb" .. i, x = s[1], y = 20, w = s[2], h = 48, fill = P[s[3]], r = i == 5 and {0, 24, 24, 0} or 0, glow = 0.06}
    T(s[3], o)
  end
  local bot = {{354, 300, "t"}, {660, 170, "p"}, {836, 430, "q"}, {1272, 112, "s"}, {1390, 190, "x"}}
  for i, s in ipairs(bot) do
    T(s[3], sc:rect{id = "bb" .. i, x = s[1], y = 832, w = s[2], h = 48, fill = P[s[3]], r = i == 5 and {0, 24, 24, 0} or 0, glow = 0.06})
  end
  text(nil, "h1", 368, 45, "U.S.S. ENDEAVOUR", 34, "#000000", "left", {glow = 0})
  text(nil, "h2", 674, 45, "NCC-1701-F", 34, "#000000")
  text(nil, "h3", 850, 45, "DEEP SPACE FRONTIER", 34, "#000000")
  text(nil, "h4", 1404, 45, "SD {lc_sd|%.1f}", 32, "#000000")
  text(nil, "b1", 368, 857, "{lc_mode|upper} CONSOLE", 32, "#000000")
  text(nil, "b2", 674, 857, "ALERT {lc_alert|upper}", 32, "#000000")
  text(nil, "b3", 850, 857, "CORE {lc_core|%d}%   HULL {lc_hull|%d}%   LOCK {lc_lock}", 30, "#000000")
  text(nil, "b4", 1404, 857, "SQUATCLIENT", 32, "#000000")
  sc:rect{id = "alert_edge", x = 6, y = 6, w = W - 12, h = H - 12, r = 22, stroke = "#ff2a1f", strokeWidth = 8, fill = "none", opacity = 0, glow = 0.9, z = 50}
end

local function nav()
  local items = {{"SENSORS", "sens", "p"}, {"ENGINEER", "eng", "x"}, {"TACTICAL", "tac", "t"}, {"SHIP", "ship", "q"}, {"COMMS", nil, "r"}}
  local P = PAL.normal
  for i, it in ipairs(items) do
    local y = 206 + (i - 1) * 68
    local b = sc:button{id = "nav" .. i, x = 20, y = y, w = 190, h = 60, r = {0, 30, 30, 0}, fill = P[it[3]], text = it[1], color = "#000000",
      size = 30, weight = "700", align = "right", padX = 20, font = "Antonio", glow = 0.04}
    b:state("hover", {fill = lighten(P[it[3]])}, {dur = 0.1})
    b:state("down", {scaleX = 0.96}, {dur = 0.06})
    T(it[3], b, true)
    if it[2] then b:on("click", function() L.show(it[2]) end) end
  end
  sc:rect{id = "marker", x = 216, y = 206, w = 12, h = 60, fill = "#ffffff", glow = 0.8}
  T("t", sc:rect{id = "navfill", x = 20, y = 552, w = 190, h = 172, fill = PAL.normal.t, r = 0})
end

-- ------------------------------------------------------------------ joystick
-- A helm stick in the lower right. The renderer drags the knob and writes its offset to js_x / js_y at display rate,
-- the readouts are bindings on those variables; the script only hears "settle" (the pointer stopped moving for a
-- moment, or was released) and answers by dropping a command into the input line, the way a game would take a
-- helm order.
local function joystick()
  local cx, cy = 1500, 750
  local g = sc:group{id = "joy", z = 20}
  T("p", sc:circle{parent = g, id = "joybase", x = cx, y = cy, r = 66, fill = "#0b0f14", stroke = PAL.normal.p, strokeWidth = 4, glow = 0.15}, false, "stroke")
  sc:circle{parent = g, x = cx, y = cy, r = 44, stroke = "#33404d", strokeWidth = 2, fill = "none"}
  sc:line{parent = g, x1 = cx - 64, y1 = cy, x2 = cx + 64, y2 = cy, stroke = "#33404d", strokeWidth = 2}
  sc:line{parent = g, x1 = cx, y1 = cy - 64, x2 = cx, y2 = cy + 64, stroke = "#33404d", strokeWidth = 2}
  text(g, "joyhdg", cx, 652, "HDG {mod(atan2(js_x, -js_y) * 57.2958 + 360, 360)|%03d}  PWR {min(100, sqrt(js_x * js_x + js_y * js_y))|%3d}", 22, PAL.normal.k, "center")
  text(g, "joyxy", cx, 682, "X {js_x|%+4d}  Y {js_y|%+4d}", 20, PAL.normal.x, "center")
  local knob = sc:circle{parent = g, id = "joyknob", x = cx, y = cy, r = 28, fill = {type = "radial", cx = 0.35, cy = 0.3, r = 0.8, stops = {{0, "#fff2cc"}, {0.5, "#ff9900"}, {1, "#7a3d00"}}},
    glow = 0.5, shadow = {dy = 5, blur = 8, alpha = 0.7}, drag = {r = 44, home = true, vx = "js_x", vy = "js_y", scale = 100}}
  knob:state("down", {glow = 1.0}, {dur = 0.08})
  knob:on("settle", function(_, e)
    local heading = (math.deg(math.atan2(e.x, -e.y)) + 360) % 360
    local power = math.min(100, math.sqrt(e.x * e.x + e.y * e.y))
    if power < 3 then return end   -- centred: nothing to report
    squat.tf(string.format("/input /echo JoyStick to %d power %d", heading + 0.5, power + 0.5))
  end)
  gfx.vars{js_x = 0, js_y = 0}
end

-- ------------------------------------------------------------------ sensors
local function ship(parent, id, i, color, y, hostile)
  local g = sc:group{id = id, parent = parent, y = y}
  g:bind("x", "420 + (lc_b" .. i .. " > 180 ? lc_b" .. i .. " - 360 : lc_b" .. i .. ") * 4.2", 0.9)
  sc:ellipse{parent = g, rx = 46, ry = 14, fill = color}
  sc:ellipse{parent = g, y = -6, rx = 28, ry = 8, fill = lighten(color)}
  if hostile then
    sc:polygon{parent = g, points = {-10, 0, -84, 26, -30, 4}, fill = color}
    sc:polygon{parent = g, points = {10, 0, 84, 26, 30, 4}, fill = color}
  else
    sc:line{parent = g, x1 = -38, y1 = 10, x2 = -38, y2 = 40, strokeWidth = 7, stroke = color}
    sc:line{parent = g, x1 = 38, y1 = 10, x2 = 38, y2 = 40, strokeWidth = 7, stroke = color}
    sc:circle{parent = g, x = 0, y = -7, r = 5, fill = "#7fd0ff", glow = 1}
  end
  for _, dx in ipairs{-38, 38} do
    sc:emitter{parent = g, x = dx, y = 42, rate = 55, lifeMin = 0.4, lifeMax = 0.9, speedMin = 30, speedMax = 70, angle = 180, spread = 14,
      sizeStart = 9, sizeEnd = 1, colorStart = hostile and "#66ff66" or "#66ccff", colorEnd = "#0000ff00", glow = 0.9, space = "world"}
  end
  return g
end

local function sensors(parent)
  local P = PAL.normal
  local vs = sc:group{id = "vs", parent = parent, x = 240, y = 130, clip = {0, 0, 800, 420}}
  sc:rect{parent = vs, id = "vsbg", w = 800, h = 420, fill = {type = "linear", angle = 180, stops = {{0, "#020611"}, {1, "#07142e"}}}}
  sc:shader{parent = vs, id = "neb", w = 800, h = 420, shader = "plasma", u = {uA = "#10153a", uB = "#2a1050", uScale = 3, uSpeed = 0.05}, opacity = 0.55}
  sc:starfield{parent = vs, id = "stars", w = 800, h = 420, count = 420, speed = 0.025, seed = 5, size = 2.4, glow = 0.4}
  sc:planet{parent = vs, id = "planet", x = 640, y = 330, r = 150, light = 150, seed = 4, spinSpeed = 0.06, glow = 0.15}
  ship(vs, "sh1", 1, "#7aa8ff", 230, false)
  ship(vs, "sh2", 2, "#c03030", 120, true)
  ship(vs, "sh5", 5, "#9ec4ff", 310, false)
  -- targeting reticle for the locked contact
  local ret = sc:circle{parent = vs, id = "reticle", x = 420, y = 230, r = 62, stroke = P.p, strokeWidth = 3, fill = "none", glow = 0.7, opacity = 0}
  ret:animate{scaleX = {from = 0.92, to = 1.1}, scaleY = {from = 0.92, to = 1.1}, dur = 0.8, ease = "inOutSine", loop = "inf", yoyo = true}
  T("p", sc:rect{parent = parent, id = "vsframe", x = 240, y = 130, w = 800, h = 420, r = 18, stroke = P.p, strokeWidth = 5, fill = "none", glow = 0.3}, false, "stroke")
  text(parent, "vslabel", 258, 152, "FORWARD VIEWSCREEN", 26, P.x)
  text(parent, "vshead", 1022, 152, "HEADING 000 MARK 000", 24, P.k, "right")
  -- radar dish
  T("p", sc:arc{parent = parent, id = "rdring", x = 1370, y = 330, r0 = 214, r1 = 224, a0 = 0, a1 = 360, fill = P.p, glow = 0.35})
  sc:radar{parent = parent, id = "radar", x = 1370, y = 330, r = 208, trail = 110, rings = 4, color = P.x, bg = "#03110a", glow = 0.7}
  local rd = sc:get("radar")
  rd:bind("sweep", "mod(time() * 80, 360)")
  rd:bind("contacts", "lc_ct")
  text(parent, "rdlabel", 1370, 572, "TACTICAL SENSOR ARRAY", 22, P.x, "center")
  -- contact list
  for i = 1, 6 do
    local y = 646 + (i - 1) * 28
    local row = text(parent, "ct" .. i, 1130, y, "{lc_n" .. i .. "|pad:-13} {lc_t" .. i .. "}  {lc_b" .. i .. "|%03d}  {lc_r" .. i .. "|%3d}", 24, P.k, "left",
      {hit = true, font = "Antonio"})
    row:state("hover", {fill = "#ffffff"}, {dur = 0.08})
    row:on("click", function() L.lock(i) end)
  end
  text(parent, "cthead", 1130, 612, "ID NAME           T  BRG  RNG", 22, P.x)
  -- hull / shield bars and the trend graph
  local function bar(id, y, label, var, color)
    text(parent, id .. "l", 240, y, label, 26, P.k)
    T(color, sc:rect{parent = parent, id = id .. "t", x = 360, y = y - 12, w = 330, h = 24, r = 12, fill = "#101820"})
    T(color, sc:rect{parent = parent, id = id .. "f", x = 360, y = y - 12, w = 10, h = 24, r = 12, fill = PAL.normal[color], glow = 0.35}):bind("w", "max(10, " .. var .. " * 3.3)", 0.9)
    text(parent, id .. "v", 710, y, "{" .. var .. "|%3d}%", 26, P.s)
  end
  bar("hull", 592, "HULL", "lc_hull", "x")
  bar("shd", 632, "SHIELDS", "lc_pw_shields", "q")
  text(parent, "gl", 240, 678, "WARP FIELD STABILITY", 24, P.x)
  sc:graph{parent = parent, id = "trend", x = 240, y = 692, w = 520, h = 118, source = "lc_trend", samples = 60, interval = 1, min = 0, max = 100,
    stroke = P.k, strokeWidth = 3, fill = {type = "linear", angle = 180, stops = {{0, "#99ccff55"}, {1, "#99ccff00"}}}, glow = 0.3}
end

-- ------------------------------------------------------------------ engineering
local function engineering(parent)
  local P = PAL.normal
  sc:shader{parent = parent, id = "core", x = 720, y = 120, w = 260, h = 420, shader = "warpcore",
    u = {uA = "#2a6bff", uB = "#bfe0ff", uSpeed = 1, uPower = 0.7}, glow = 0.8}
  sc:get("core"):bind("u.uPower", "lc_core / 100", 0.9)
  T("p", sc:rect{parent = parent, id = "coreframe", x = 706, y = 110, w = 288, h = 440, r = 30, stroke = P.p, strokeWidth = 4, fill = "none", glow = 0.3}, false, "stroke")
  text(parent, "coretitle", 850, 580, "WARP CORE ASSEMBLY", 28, P.x, "center")
  text(parent, "coretemp", 850, 620, "CORE TEMPERATURE {lc_core|%d}%", 28, P.s, "center")
  for i, s in ipairs(SYSTEMS) do
    local y = 150 + (i - 1) * 66
    local var = "lc_pw_" .. s[1]
    text(parent, "pl" .. i, 250, y, s[2], 28, P.k)
    local track = sc:rect{parent = parent, id = "ptr" .. i, x = 250, y = y + 18, w = 380, h = 26, r = 13, fill = "#0e151d", hit = true}
    local fill = sc:rect{parent = parent, id = "pf" .. i, x = 250, y = y + 18, w = 10, h = 26, r = 13, fill = P[s[3]], glow = 0.4}
    T(s[3], fill)
    fill:bind("w", "max(10, " .. var .. " * 3.8)", 0.8)
    text(parent, "pv" .. i, 690, y + 31, "{" .. var .. "|%3d}", 28, P.s, "right")
    track:on("click", function(_, e)   -- click on a bar sets its level
      local lvl = math.max(0, math.min(100, math.floor((e.x - 240 - 250) / 3.8 + 0.5)))
      sim.pw[s[1]] = lvl
      push()
    end)
    track:state("hover", {fill = "#1a2733"}, {dur = 0.1})
  end
  text(parent, "pwhint", 250, 570, "CLICK A BAR TO REDISTRIBUTE POWER", 22, P.x)
  -- live core graph and gauge
  text(parent, "gt", 1040, 150, "CORE THERMAL TREND", 26, P.x)
  sc:graph{parent = parent, id = "coregraph", x = 1040, y = 170, w = 500, h = 150, source = "lc_core", samples = 60, interval = 1, min = 30, max = 100,
    stroke = "#ff6644", strokeWidth = 3, fill = {type = "linear", angle = 180, stops = {{0, "#ff664466"}, {1, "#ff664400"}}}, glow = 0.35}
  T("p", sc:arc{parent = parent, id = "gauge_bg", x = 1290, y = 540, r0 = 118, r1 = 134, a0 = 225, a1 = 495, fill = "#1a1208"})
  local g = T("p", sc:arc{parent = parent, id = "gauge", x = 1290, y = 540, r0 = 118, r1 = 134, a0 = 225, a1 = 300, fill = P.p, glow = 0.6})
  g:bind("a1", "225 + 270 * clamp(lc_core, 0, 100) / 100", 0.9)
  text(parent, "gaugev", 1290, 540, "{lc_core|%d}", 72, "#ffffff", "center", {glow = 0.3})
  text(parent, "gaugel", 1290, 600, "% OUTPUT", 24, P.x, "center")
end

-- ------------------------------------------------------------------ tactical
local function tactical(parent)
  local P = PAL.normal
  local cx, cy = 560, 360
  local sections = {{"FORE", 315, 45, "lc_pw_shields"}, {"STARBOARD", 45, 135, "lc_pw_shields"}, {"AFT", 135, 225, "lc_pw_shields"}, {"PORT", 225, 315, "lc_pw_shields"}}
  for i, s in ipairs(sections) do
    for ring = 1, 3 do
      local a = sc:arc{parent = parent, id = "sh" .. i .. "_" .. ring, x = cx, y = cy, r0 = 80 + ring * 34, r1 = 80 + ring * 34 + 24, a0 = s[2] + 3, a1 = s[3] - 3 + (s[3] < s[2] and 360 or 0),
        fill = P.q, glow = 0.5}
      T("q", a)
      a:bind("opacity", "clamp((" .. s[4] .. " - " .. ((3 - ring) * 25) .. ") / 25, 0.12, 1)", 0.8)
    end
  end
  sc:ellipse{parent = parent, id = "ownship", x = cx, y = cy, rx = 46, ry = 16, fill = "#cfe6ff", glow = 0.5}
  sc:circle{parent = parent, x = cx, y = cy - 6, r = 5, fill = "#7fd0ff", glow = 1}
  text(parent, "tt", cx, 130, "DEFLECTOR GRID", 30, P.x, "center")
  -- weapons
  local fire = sc:emitter{parent = parent, id = "muzzle", x = cx, y = cy - 24, rate = 0, lifeMin = 0.4, lifeMax = 0.9, speedMin = 160, speedMax = 380, angle = 0, spread = 20,
    sizeStart = 12, sizeEnd = 2, colorStart = "#ffdd77", colorEnd = "#ff220000", glow = 1}
  local burst = 0
  local function weapon(id, y, label, role, n)
    local b = sc:button{parent = parent, id = id, x = 900, y = y, w = 330, h = 64, pill = true, fill = P[role], text = label, color = "#000000", size = 32, font = "Antonio", glow = 0.2}
    b:state("hover", {fill = lighten(P[role]), scaleX = 1.04, scaleY = 1.04}, {dur = 0.1})
    b:state("down", {scaleX = 0.97, scaleY = 0.97}, {dur = 0.05})
    T(role, b, true)
    b:on("click", function()
      burst = burst + 1
      fire:set{burst = n, burstId = burst}
      sim.pw.weapons = math.max(10, sim.pw.weapons - 5)
      push()
    end)
  end
  weapon("phasers", 170, "FIRE PHASERS", "p", 60)
  weapon("torps", 252, "PHOTON TORPEDO", "x", 120)
  local ra = sc:button{parent = parent, id = "ralert", x = 900, y = 360, w = 330, h = 90, pill = true, fill = "#cc2222", text = "RED ALERT", color = "#ffffff", size = 44, font = "Antonio", glow = 0.5}
  ra:state("hover", {scaleX = 1.04, scaleY = 1.04, glow = 0.9}, {dur = 0.1})
  ra:on("click", function() L.alert(alert == "red" and "off" or "red") end)
  text(parent, "tgl", 900, 490, "TARGET LOCK: {lc_lock}   (click a contact on SENSORS)", 24, P.k)
  text(parent, "tgl2", 900, 530, "SHIELDS {lc_pw_shields|%d}%   WEAPONS {lc_pw_weapons|%d}%", 26, P.s)
end

-- ------------------------------------------------------------------ ship systems (the power / damage / fuel / weapons screens)
-- The same data the text consoles of the space game print, as a display. The variables (sh_*) are what a game's
-- GMCP "Ship.Status" package would carry: the handler at the bottom of this file feeds them from squat.on("gmcp"),
-- and a binding may also read gmcp:Ship.Status.<field> directly, with no script in between.
local GROUPS = {{"arrays", "ARRAYS", "p"}, {"cloak", "CLOAK", "q"}, {"fuel", "FUEL", "x"}, {"ops", "OPERATIONS", "s"},
  {"shields", "SHIELDS", "q"}, {"warp", "WARP", "p"}, {"weapons", "WEAPONS", "r"}}

local function shipconsole(parent)
  local P = PAL.normal
  text(parent, "pt", 240, 130, "POWER OVERVIEW", 34, P.x)
  for i, g in ipairs(GROUPS) do
    local y = 176 + (i - 1) * 56
    text(parent, "pg" .. i, 240, y, g[2] .. " ({sh_pg_" .. g[1] .. "|%d}%)", 24, P.k)
    local tr = sc:rect{parent = parent, id = "pgt" .. i, x = 240, y = y + 14, w = 430, h = 22, r = 11, fill = "#0e151d", hit = true}
    T(g[3], sc:rect{parent = parent, id = "pgf" .. i, x = 240, y = y + 14, w = 10, h = 22, r = 11, fill = P[g[3]], glow = 0.3}):bind("w", "max(10, sh_pg_" .. g[1] .. " * 4.3)", 0.8)
    text(parent, "pgm" .. i, 680, y + 25, "{sh_pg_" .. g[1] .. " * sh_total / 100 / 1000|%.2f} GW", 22, P.s, "left")
    tr:on("click", function(_, e)   -- click a bar: ask the ship for that share (the game answers by changing the data)
      local pct = math.max(0, math.min(100, math.floor((e.x - 240) / 4.3 + 0.5)))
      squat.tf(string.format("/input power %s %d", g[1], pct))
    end)
    tr:state("hover", {fill = "#1a2733"}, {dur = 0.1})
  end
  -- pools
  text(parent, "pp", 900, 130, "POWER POOLS", 34, P.x)
  local rows = {{"MAIN", "sh_main"}, {"AUX", "sh_aux"}, {"BATTERY", "sh_batt"}}
  for i, r in ipairs(rows) do
    text(parent, "pool" .. i, 900, 182 + (i - 1) * 40, r[1], 26, P.k)
    text(parent, "poolv" .. i, 1190, 182 + (i - 1) * 40, "{" .. r[2] .. "|%.1f} GW", 26, P.s, "right")
  end
  text(parent, "pltot", 900, 306, "TOTAL", 26, P.x)
  text(parent, "pltotv", 1190, 306, "{sh_main + sh_aux + sh_batt|%.1f} GW", 26, "#ffffff", "right")
  T("p", sc:arc{parent = parent, id = "comp_bg", x = 1400, y = 230, r0 = 70, r1 = 86, a0 = 225, a1 = 495, fill = "#1a1208"})
  T("p", sc:arc{parent = parent, id = "comp", x = 1400, y = 230, r0 = 70, r1 = 86, a0 = 225, a1 = 300, fill = P.p, glow = 0.5}):bind("a1", "225 + 270 * clamp(sh_comp, 0, 100) / 100", 0.8)
  text(parent, "compv", 1400, 226, "{sh_comp|%d}%", 40, "#ffffff", "center")
  text(parent, "compl", 1400, 270, "COMPONENTS", 20, P.x, "center")
  -- damage statistics, fuel, weapons
  text(parent, "dt", 900, 380, "DAMAGE STATISTICS", 28, P.x)
  local dm = {{"PORT NACELLE", "sh_dm_port", 100}, {"STARBOARD NACELLE", "sh_dm_stbd", 100}, {"HULL", "sh_dm_hull", 875}}
  for i, d in ipairs(dm) do
    local y = 424 + (i - 1) * 44
    text(parent, "dml" .. i, 900, y, d[1], 22, P.k)
    sc:rect{parent = parent, id = "dmt" .. i, x = 1110, y = y - 11, w = 280, h = 22, r = 11, fill = "#0e151d"}
    local f = sc:rect{parent = parent, id = "dmf" .. i, x = 1110, y = y - 11, w = 10, h = 22, r = 11, fill = "#66cc88", glow = 0.25}
    f:bind("w", "max(10, " .. d[2] .. " / " .. d[3] .. " * 280)", 0.8)
    f:bind("fill", "color(\"#ff4444\", \"#66cc88\", " .. d[2] .. " / " .. d[3] .. ")")
    text(parent, "dmv" .. i, 1560, y, "{" .. d[2] .. "|%.1f}", 20, P.s, "right")
  end
  text(parent, "ft", 900, 580, "FUEL STATUS", 28, P.x)
  local tanks = {{"DEUTERIUM", "sh_deut", 500000, "#66aaff"}, {"ANTIMATTER", "sh_anti", 300000, "#ff77cc"}}
  for i, t in ipairs(tanks) do
    local x = 900 + (i - 1) * 330
    sc:rect{parent = parent, id = "tk" .. i, x = x, y = 610, w = 56, h = 190, r = 22, stroke = P.p, strokeWidth = 3, fill = "#0a0e12"}
    local lvl = sc:rect{parent = parent, id = "tkl" .. i, x = x + 5, y = 790, w = 46, h = 4, r = 17, fill = t[4], glow = 0.5}
    lvl:bind("h", "max(4, " .. t[2] .. " / " .. t[3] .. " * 176)", 0.8)
    lvl:bind("y", "794 - max(4, " .. t[2] .. " / " .. t[3] .. " * 176)", 0.8)
    text(parent, "tkn" .. i, x + 70, 640, t[1], 24, P.k)
    text(parent, "tkv" .. i, x + 70, 676, "{" .. t[2] .. "|%.0f}", 22, P.s)
    text(parent, "tkm" .. i, x + 70, 704, "OF " .. t[3], 20, P.x)
  end
  text(parent, "wt", 240, 590, "WEAPONS", 28, P.x)
  text(parent, "wl", 240, 632, "1  FORE PHASER", 24, P.k)
  sc:rect{parent = parent, id = "wch", x = 240, y = 650, w = 430, h = 22, r = 11, fill = "#0e151d"}
  sc:rect{parent = parent, id = "wchf", x = 240, y = 650, w = 10, h = 22, r = 11, fill = "#ffcc66", glow = 0.4}:bind("w", "max(10, sh_charge / 35000 * 430)", 0.8)
  text(parent, "wcv", 680, 661, "{sh_charge|%d} / 35000", 22, P.s)
  text(parent, "dct", 240, 712, "DAMAGE CONTROL", 28, P.x)
  for i = 1, 3 do text(parent, "dc" .. i, 240, 730 + i * 28, "TEAM " .. i .. "   10   HULL", 22, P.k) end
end

function L.shipsim()
  return {sh_main = 5.4, sh_aux = 1.0, sh_batt = 0.004, sh_total = 6400, sh_comp = 60, sh_charge = 0, sh_deut = 498815.78, sh_anti = 299334.36,
    sh_dm_port = 86.4, sh_dm_stbd = 86.4, sh_dm_hull = 875,
    sh_pg_arrays = 5, sh_pg_cloak = 0, sh_pg_fuel = 0, sh_pg_ops = 0, sh_pg_shields = 0, sh_pg_warp = 55, sh_pg_weapons = 0}
end

-- ------------------------------------------------------------------ control
function L.lock(n)
  sim.lock = (sim.lock == n) and 0 or n
  gfx.var("lc_lock", sim.lock)
  local ret = sc:get("reticle")
  if sim.lock == 1 or sim.lock == 2 or sim.lock == 5 then
    local sh = ({[1] = "sh1", [2] = "sh2", [5] = "sh5"})[sim.lock]
    local g = sc:get(sh)
    ret:set{y = g.y_hint or 0}
    ret:bind("x", "420 + (lc_b" .. sim.lock .. " > 180 ? lc_b" .. sim.lock .. " - 360 : lc_b" .. sim.lock .. ") * 4.2", 0.4)
    ret:set{y = ({[1] = 230, [2] = 120, [5] = 310})[sim.lock]}
    ret:animate{opacity = 1, dur = 0.3}
  else
    ret:animate{opacity = 0, dur = 0.3}
  end
end

function L.alert(state)
  alert = state == "red" and "red" or "off"
  local P = pal()
  for _, t in ipairs(themed) do
    t.obj:animate{[t.prop] = P[t.role], dur = 0.9, ease = "inOutSine"}
    if t.interactive then
      t.obj:state("hover", {fill = lighten(P[t.role])}, {dur = 0.1})
    end
  end
  sc:get("rdring"):animate{fill = P.p, dur = 0.9}
  gfx.var("lc_alert", alert)
  local edge = sc:get("alert_edge")
  if alert == "red" then
    edge:animate{opacity = {from = 0.15, to = 0.95}, dur = 0.7, ease = "inOutSine", loop = "inf", yoyo = true}
  else
    edge:stop()
    edge:animate{opacity = 0, dur = 0.5}
  end
  gfx.var("lc_bg", P.bg)
  sc:open{bg = P.bg}
end

function L.show(name)
  if not consoles[name] then return end
  local order = {sens = 1, eng = 2, tac = 3, ship = 4}
  for n, g in pairs(consoles) do
    if n == name then
      g:set{visible = true}
      g:animate{opacity = {from = 0, to = 1}, y = {from = 14, to = 0}, dur = 0.45, ease = "outCubic"}
    elseif n == current then
      g:animate{opacity = 0, dur = 0.25}
      local old = g
      squat.after(0.3, function() if current ~= n then old:hide() end end)
    end
  end
  current = name
  sc:get("marker"):animate{y = 206 + (order[name] - 1) * 68, dur = 0.35, ease = "outBack"}
  gfx.var("lc_mode", name)
end

function L.start(console, alertState)
  if not gfx.ensure() then return end
  if timerId then squat.cancel(timerId) end
  sim = sim or newSim()
  themed, consoles = {}, {}
  sc = gfx.scene("lcars", {w = W, h = H, bg = PAL.normal.bg, dock = "full", margin = {0, 0, 0, 0}, bloom = 0.55, fit = "contain"})
  sc:clear()
  gfx.font("Antonio", "fonts/Antonio-VF.ttf")
  sc:open{open = true}
  gfx.vars{lc_alert = alert}
  frame()
  nav()
  joystick()
  for name, build in pairs{sens = sensors, eng = engineering, tac = tactical, ship = shipconsole} do
    consoles[name] = sc:group{id = "c_" .. name, visible = false}
    build(consoles[name])
  end
  push()
  current = nil
  L.show(console or "sens")
  if alertState == "red" then L.alert("red") end
  timerId = squat.timer{every = 1, fn = tick}
end

function L.stop()
  if timerId then squat.cancel(timerId) timerId = nil end
  if sc then sc:close() end
end

function L.command(m)
  local arg = (m[1] or ""):gsub("^%s+", ""):gsub("%s+$", "")
  local first, rest = arg:match("^(%S*)%s*(.*)$")
  if first == "stop" or first == "off" then L.stop()
  elseif first == "alert" then if sc then L.alert(rest == "red" and "red" or "off") end
  elseif first == "eng" or first == "tac" or first == "sens" or first == "ship" or first == "" then
    if sc and consoles[first == "" and "sens" or first] then L.show(first == "" and "sens" or first)
    else L.start(first ~= "" and first or "sens") end
  else squat.echo("usage: /lcars [sens|eng|tac|alert red|off|stop]") end
end

-- A game's GMCP feeds the same display: Ship.Status {Power = {Warp = 55, ...}, Fuel = {...}} becomes sh_* variables.
squat.on("gmcp", function(m)
  if m.package ~= "Ship.Status" or type(m.data) ~= "table" or not sim then return end
  local v = {}
  for k, val in pairs(m.data) do
    if type(val) == "number" then v["sh_" .. k] = val end
  end
  gfx.vars(v)
end)

squat.alias{match = "^/lcars(?: (.*))?$", regex = true, fn = L.command}
squat.alias{match = "^/lock (\\d)$", regex = true, fn = function(m) if sim then L.lock(tonumber(m[1])) end end}

return L
