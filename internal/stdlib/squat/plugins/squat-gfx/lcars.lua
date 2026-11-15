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
-- A theme is a skin over the shared consoles: palette (roles p s t q x r k bg, normal and red), font, a frame and navigation
-- of its own, optional decorations and replacements. S is the theme in use; the simulation, the text-port toggle, the
-- alert recolouring and the console builders are shared (docs/GFX.md, "Themes").
local themes, themeOrder = {}, {}
local S
local E = {}      -- what the theme files get to use
local SYSTEMS = {
  {"warp", "WARP", "x"}, {"impulse", "IMPULSE", "p"}, {"shields", "SHIELDS", "q"},
  {"weapons", "WEAPONS", "r"}, {"sensors", "SENSORS", "t"}, {"life", "LIFE SUPPORT", "s"},
}

local M                  -- the ship-console model and panels (model.lua)
local sc                 -- the scene
local themed = {}        -- objects recoloured on alert: {obj, role, hover}
local consoles = {}      -- name -> group object
local current = "sens"
local alert = "off"
local timerId
local sim
local closed = true      -- the window is closed (stop, close button, Escape): the simulation tick must not run
-- The console fills the output area and leaves a "text port" in it (PORT, scene units): the real game output shows through
-- there, so people keep talking to each other. /lcars size 50 instead docks a graphics strip above the text; /lcars full
-- goes back to the port layout.
-- The port is an object (textport) that the renderer animates: the LOG button grows it from PORT_C (compact) to PORT_E
-- (about 80% of the content height) and back while the other widgets shrink around it. The app's real input bar stays
-- below the output area, outside the scene, untouched.
local PORT_C = {240, 640, 860, 182}
local PORT_E = {240, 268, 860, 552}
local DUR = 0.55
local expanded = false
local dock, size, usePort = "full", nil, true
local curTheme = "tng"
local tourTimer

-- Everything above (the scene, theme, simulation, timers, LOG state ...) belongs to ONE SESSION. The code below uses these
-- upvalues directly, so each entry point (a command, a click, a timer tick, a GMCP message) runs inside with(world, fn), which
-- loads that session's state into them first and stores it back afterwards. The calm setting alone is global.
local states, depth, cw = {}, 0, ""
local function load(st)
  sc, themed, consoles, current, alert, timerId, sim, closed, expanded = st.sc, st.themed or {}, st.consoles or {}, st.current or "sens", st.alert or "off", st.timerId, st.sim, st.closed ~= false, st.expanded or false
  dock, size, usePort, curTheme, tourTimer, S = st.dock or "full", st.size, st.usePort ~= false, st.curTheme or "tng", st.tourTimer, st.S
end
local function store(world)
  states[world] = {sc = sc, themed = themed, consoles = consoles, current = current, alert = alert, timerId = timerId, sim = sim, closed = closed, expanded = expanded,
    dock = dock, size = size, usePort = usePort, curTheme = curTheme, tourTimer = tourTimer, S = S}
end
local function with(world, fn, ...)
  world = world or ""
  if depth > 0 and cw == world then return fn(...) end   -- already inside this session
  local prev, nested = cw, depth > 0
  if nested then store(prev) end   -- another session's code is running: keep its state while we borrow the upvalues
  load(states[world] or {})
  cw = world
  gfx.setWorld(world)
  depth = depth + 1
  local ok, err = pcall(fn, ...)
  depth = depth - 1
  store(world)
  cw = prev
  gfx.setWorld(prev)
  if nested then load(states[prev]) end
  if not ok then error(err, 0) end
end
-- squat.after / timers run later, in the session that scheduled them
local function after(sec, fn)
  local w = cw
  squat.after(sec, function() with(w, fn) end)
end
local function every(sec, fn)
  local w = cw
  return squat.timer{every = sec, fn = function() with(w, fn) end}
end
local calm = tonumber(squat.var.get("lcars_calm", 0)) or 0

local function lighten(hex)
  local r, g, b = hex:match("#(%x%x)(%x%x)(%x%x)")
  local f = function(h) return math.min(255, tonumber(h, 16) + 45) end
  return string.format("#%02x%02x%02x", f(r), f(g), f(b))
end

local function R(v) return S.sharp and 0 or v end   -- sharp themes have no rounded ends

local function pal() return S.pal[alert == "red" and "red" or "normal"] end

local function T(role, o, interactive, prop)
  themed[#themed + 1] = {obj = o, role = role, interactive = interactive, prop = prop or "fill"}
  return o
end

local function text(parent, id, x, y, str, size, fill, align, extra)
  local t = {id = id, parent = parent, x = x, y = y, text = str, size = (size or 28) * (S.tscale or 1), fill = fill or "#99ccff", align = align or "left",
    baseline = "middle", weight = S.weight or "700", font = S.font}
  for k, v in pairs(extra or {}) do t[k] = v end
  return sc:text(t)
end

-- ------------------------------------------------------------------ simulation
local function newSim()
  return {
    fg = {52, 48, 60, 57, 63, 58, 66, 70}, sd = 47634.4, hull = 100, core = 62, trend = 50, lock = 0,
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
  local lk = sim.c[sim.lock]   -- the locked contact, for panels that show the lock solution
  v.lc_ln, v.lc_lb, v.lc_lr = lk and lk.n or "", lk and lk.b or 0, lk and lk.r or 0
  for i, val in ipairs(sim.fg) do v["fg_" .. i] = val end
  v.fg_profit = sim.fg[8] - sim.fg[7]
  for k, val in pairs(sim.pw) do v["lc_pw_" .. k] = val end
  for k, val in pairs(sim.ship) do v[k] = val end
  gfx.vars(v)
end

local function tick()
  if closed or not sc then -- nobody is watching: stop our own timer instead of poking a closed scene
    if timerId then squat.cancel(timerId) timerId = nil end
    return
  end
  sim.sd = sim.sd + 0.1
  for _, c in ipairs(sim.c) do c.b = (c.b + c.d + 360) % 360 end
  sim.core = math.max(40, math.min(95, sim.core + math.random(-3, 3)))
  sim.trend = math.random(20, 80)
  for i = 1, 7 do sim.fg[i] = sim.fg[i + 1] end
  sim.fg[8] = math.max(15, math.min(95, sim.fg[8] + math.random(-9, 10)))
  local sh = sim.ship
  sh.sh_charge = math.min(35000, sh.sh_charge + 2500)
  if sh.sh_charge >= 35000 then sh.sh_charge = 0 end
  sh.sh_deut = sh.sh_deut - 0.7
  sh.sh_comp = 55 + math.random(0, 12)
  push()
end

-- ------------------------------------------------------------------ frame
local function tng_frame()
  local P = S.pal.normal
  T("p", sc:elbow{id = "el_top", x = 20, y = 20, w = 330, h = 176, ro = 92, ri = 28, bar = 48, side = 190, corner = "tl", fill = P.p, glow = 0.08})
  T("t", sc:elbow{id = "el_bot", x = 20, y = 724, w = 330, h = 156, ro = 80, ri = 26, bar = 44, side = 190, corner = "bl", fill = P.t, glow = 0.08})
  local top = {{354, 300, "p"}, {660, 170, "s"}, {836, 430, "t"}, {1272, 112, "q"}, {1390, 190, "x"}}
  for i, s in ipairs(top) do
    local o = sc:rect{id = "tb" .. i, x = s[1], y = 20, w = s[2], h = 48, fill = P[s[3]], r = i == 5 and {0, 24, 24, 0} or 0, glow = 0.06}
    T(s[3], o)
  end
  local bot = {{354, 300, "t"}, {660, 170, "p"}, {836, 430, "q"}, {1272, 112, "s"}, {1390, 190, "x"}}
  for i, sg in ipairs(bot) do
    T(sg[3], sc:rect{id = "bb" .. i, x = sg[1], y = 832, w = sg[2], h = 48, fill = P[sg[3]], r = i == 5 and {0, 24, 24, 0} or 0, glow = 0.06})
  end
  text(nil, "h1", 368, 45, "U.S.S. ENDEAVOUR", 34, "#000000", "left", {glow = 0})
  text(nil, "h2", 674, 45, "NCC-1701-F", 34, "#000000")
  text(nil, "h3", 850, 45, "DEEP SPACE FRONTIER", 34, "#000000")
  text(nil, "h4", 1404, 45, "SD {lc_sd|%.1f}", 32, "#000000")
  text(nil, "h5", 1284, 45, "{lc_mode|upper}", 28, "#000000")
  text(nil, "b1", 366, 857, "{lc_mode|upper} CONSOLE", 32, "#000000")
  text(nil, "b2", 674, 857, "ALERT {lc_alert|upper}", 32, "#000000")
  text(nil, "b3", 850, 857, "CORE {lc_core|%d}%   HULL {lc_hull|%d}%   LOCK {lc_lock}", 30, "#000000")
  text(nil, "b4", 1404, 857, "SQUATCLIENT", 32, "#000000")
  if usePort then -- the text port (an object the renderer animates; invisible) and a frame round it
    sc:rect{id = "textport", x = PORT_C[1], y = PORT_C[2], w = PORT_C[3], h = PORT_C[4], visible = false}
    T("p", sc:rect{id = "portframe", x = PORT_C[1] - 8, y = PORT_C[2] - 8, w = PORT_C[3] + 16, h = PORT_C[4] + 16, r = 14, stroke = P.p, strokeWidth = 4, fill = "none", glow = 0.2}, false, "stroke")
  end
  sc:rect{id = "alert_edge", x = 6, y = 6, w = W - 12, h = H - 12, r = 22, stroke = "#ff2a1f", strokeWidth = 8, fill = "none", opacity = 0, glow = 0.9, z = 50}
end

local function tng_nav()
  local items = {{"SENSORS", "sens", "p"}, {"POWER", "eng", "x"}, {"TACTICAL", "tac", "t"}, {"DAMAGE", "ship", "q"}, {"OPS", "op", "r"}}
  local P = S.pal.normal
  for i, it in ipairs(items) do
    local y = 206 + (i - 1) * 68
    local b = sc:button{id = "nav" .. i, x = 20, y = y, w = 190, h = 60, r = {0, 30, 30, 0}, fill = P[it[3]], text = it[1], color = "#000000",
      size = 30, weight = "700", align = "right", padX = 20, font = S.font, glow = 0.04}
    b:state("hover", {fill = lighten(P[it[3]])}, {dur = 0.1})
    b:state("down", {scaleX = 0.96}, {dur = 0.06})
    T(it[3], b, true)
    if it[2] then b:on("click", function() L.show(it[2]) end) end
  end
  sc:rect{id = "marker", x = 216, y = 206, w = 12, h = 60, fill = "#ffffff", glow = 0.8}
  T("t", sc:rect{id = "navfill", x = 20, y = 552, w = 190, h = 172, fill = S.pal.normal.t, r = 0})
  text(nil, "st1", 34, 636, "ALERT {lc_alert|upper}", 24, "#000000")
  text(nil, "st2", 34, 668, "CORE {lc_core|%d}%", 24, "#000000")
  text(nil, "st3", 34, 700, "HULL {lc_hull|%d}%", 24, "#000000")
  if usePort then -- Alt+L too
    local lb = sc:button{id = "logbtn", x = 20, y = 560, w = 190, h = 54, r = {0, 27, 27, 0}, fill = S.pal.normal.x, text = '{lc_logx == 1 ? "LOG - SHRINK" : "LOG - EXPAND"}',
      color = "#000000", size = 26, weight = "700", align = "right", padX = 18, font = S.font, key = "alt+l", glow = 0.04}
    lb:state("hover", {fill = lighten(S.pal.normal.x)}, {dur = 0.1})
    lb:state("down", {scaleX = 0.96}, {dur = 0.06})
    T("x", lb, true)
    lb:on("click", function() L.toggle() end)
  end
end

-- ------------------------------------------------------------------ joystick
-- A helm stick in the lower right. The renderer drags the knob and writes its offset to js_x / js_y at display rate,
-- the readouts are bindings on those variables; the script only hears "settle" (the pointer stopped moving for a
-- moment, or was released) and answers by dropping a command into the input line, the way a game would take a
-- helm order.
local function joystick()
  local cx, cy = 1500, 750
  local g = sc:group{id = "joy", z = 20}
  T("p", sc:circle{parent = g, id = "joybase", x = cx, y = cy, r = 66, fill = "#0b0f14", stroke = S.pal.normal.p, strokeWidth = 4, glow = 0.15}, false, "stroke")
  sc:circle{parent = g, x = cx, y = cy, r = 44, stroke = "#33404d", strokeWidth = 2, fill = "none"}
  sc:line{parent = g, x1 = cx - 64, y1 = cy, x2 = cx + 64, y2 = cy, stroke = "#33404d", strokeWidth = 2}
  sc:line{parent = g, x1 = cx, y1 = cy - 64, x2 = cx, y2 = cy + 64, stroke = "#33404d", strokeWidth = 2}
  text(g, "joyhdg", cx, 652, "HDG {mod(atan2(js_x, -js_y) * 57.2958 + 360, 360)|%03d}  PWR {min(100, sqrt(js_x * js_x + js_y * js_y))|%3d}", 22, S.pal.normal.k, "center")
  text(g, "joyxy", cx, 682, "X {js_x|%+4d}  Y {js_y|%+4d}", 20, S.pal.normal.x, "center")
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
  local P = S.pal.normal
  local vsg = sc:group{id = "vsg", parent = parent, x = 240, y = 130}
  local vs = sc:group{id = "vs", parent = vsg, clip = {0, 0, 800, 420}}
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
  if S.vsframe then S.vsframe(vsg) else
    T("p", sc:rect{parent = vsg, id = "vsframe", x = 0, y = 0, w = 800, h = 420, r = R(18), stroke = P.p, strokeWidth = 5, fill = "none", glow = 0.3}, false, "stroke")
  end
  text(vsg, "vslabel", 18, 22, "FORWARD VIEWSCREEN", 26, P.x)
  text(vsg, "vshead", 782, 22, "HEADING 000 MARK 000", 24, P.k, "right")
  -- radar dish
  local rdg = sc:group{id = "rdg", parent = parent, x = 1370, y = 330}
  if S.radar then S.radar(rdg) else
    T("p", sc:arc{parent = rdg, id = "rdring", x = 0, y = 0, r0 = 214, r1 = 224, a0 = 0, a1 = 360, fill = P.p, glow = 0.35})
    sc:radar{parent = rdg, id = "radar", x = 0, y = 0, r = 208, trail = 110, rings = 4, color = P.x, bg = "#03110a", glow = 0.7}
    local rd = sc:get("radar")
    rd:bind("sweep", "mod(time() * 80, 360)")
    rd:bind("contacts", "lc_ct")
  end
  text(rdg, "rdlabel", 0, 242, "TACTICAL SENSOR ARRAY", 22, P.x, "center")
  -- contact list
  local ctg = sc:group{id = "ctg", parent = parent}
  for i = 1, 6 do
    local y = 640 + (i - 1) * 28
    local row = text(ctg, "ct" .. i, 1130, y, "{lc_n" .. i .. "|pad:-13} {lc_t" .. i .. "}  {lc_b" .. i .. "|%03d}  {lc_r" .. i .. "|%3d}", 24 * (S.ctscale or 1), P.k, "left",
      {hit = true, font = S.font})
    row:state("hover", {fill = "#ffffff"}, {dur = 0.08})
    row:on("click", function() L.lock(i) end)
  end
  text(ctg, "cthead", 1130, 612, "ID NAME           T  BRG  RNG", 22 * (S.ctscale or 1), P.x)
  -- the scans the operations console offers (srs, lrs, passive/dockscan/internal on the locked contact)
  local scg = sc:group{id = "scg", parent = parent}
  M.scans(scg, "scn", 240, 562, 800, {size = 20, row = 30, bh = 40, nohint = true})
end

-- ------------------------------------------------------------------ engineering: the game's power model
-- Power groups 1-7 with percent and watts, the pools, components, repair and battery charge; click a group to see its
-- components and set it with power <group>=<value>; eng main/aux for the generators (model.lua).
local function engineering(parent)
  local P = S.pal.normal
  local st = {size = 22, row = 40, bh = 40, ox = 0}
  M.powergroups(parent, "pgl", 240, 130, 560, st)
  M.pools(parent, "pls", 240, 462, 560, {size = 20, row = 30, cols = true})
  M.pgdetail(parent, "pgd", 840, 130, 560, {size = 22, row = 34, bh = 40, ox = 0})
  sc:shader{parent = parent, id = "core", x = 1440, y = 140, w = 110, h = 300, shader = "warpcore", u = {uA = "#2a6bff", uB = "#bfe0ff", uSpeed = 1, uPower = 0.7}, glow = 0.8}
  sc:get("core"):bind("u.uPower", "lc_core / 100", 0.9)
  text(parent, "coretitle", 1495, 460, "CORE {lc_core|%d}%", 24, P.s, "center")
  M.btn(parent, "pgrefresh", 1420, 500, 140, 40, "POWER", "p", function() M.refreshPower() end, 18)
end

-- ------------------------------------------------------------------ tactical
local function tactical(parent)
  local P = S.pal.normal
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
    local b = sc:button{parent = parent, id = id, x = 900, y = y, w = 330, h = 64, pill = true, fill = P[role], text = label, color = "#000000", size = 32 * (S.tscale or 1), font = S.font, glow = 0.2}
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
  local ra = sc:button{parent = parent, id = "ralert", x = 900, y = 360, w = 330, h = 90, pill = true, fill = "#cc2222", text = "RED ALERT", color = "#ffffff", size = 44 * (S.tscale or 1), font = S.font, glow = 0.5}
  ra:state("hover", {scaleX = 1.04, scaleY = 1.04, glow = 0.9}, {dur = 0.1})
  ra:on("click", function() L.alert(alert == "red" and "off" or "red") end)
  text(parent, "tgl", 900, 490, "TARGET LOCK: {lc_lock}   (click a contact on SENSORS)", 24, P.k)
  text(parent, "tgl2", 900, 530, "SHIELDS {lc_pw_shields|%d}%   WEAPONS {lc_pw_weapons|%d}%", 26, P.s)
end

-- ------------------------------------------------------------------ damage control (the game's dmg commands)
-- Teams 1-5 with crew and assignment, the damage statistics, and a click on a system sends dmg assign <team>=<system>.
local function shipconsole(parent)
  M.teams(parent, "dct", 240, 130, 520, {size = 24, row = 44})
  M.systems(parent, "dcs", 840, 130, 560, {size = 24, row = 40})
  local P = S.pal.normal
  text(parent, "dch1", 840, 440, "HULL INTEGRITY", 20, P.x)
  sc:graph{parent = parent, id = "dcg1", x = 840, y = 456, w = 260, h = 70, source = "lc_hull", samples = 60, interval = 1, min = 0, max = 105, stroke = "#66cc88", strokeWidth = 3,
    fill = {type = "linear", angle = 180, stops = {{0, "#66cc8855"}, {1, "#66cc8800"}}}}
  text(parent, "dch2", 1140, 440, "PORT NACELLE", 20, P.x)
  sc:graph{parent = parent, id = "dcg2", x = 1140, y = 456, w = 260, h = 70, source = "sh_dm_port", samples = 60, interval = 1, min = 60, max = 105, stroke = P.s, strokeWidth = 3,
    fill = {type = "linear", angle = 180, stops = {{0, "#ffffff33"}, {1, "#ffffff00"}}}}
  M.btn(parent, "dcrefresh", 240, 560, 220, 38, "REFRESH: DMG STAT", "p", function() M.refreshDmg() end, 18)
  text(parent, "dcnote", 480, 580, "SENDS DMG STAT AND DMG TEAM STAT; ASSIGNING SENDS DMG ASSIGN <TEAM>=<SYSTEM>", 17, S.pal.normal.x)
end

-- ------------------------------------------------------------------ operations (op stat, hatch, docking, fuel, tractor beam)
local function opsconsole(parent)
  M.opstat(parent, "ops", 240, 130, 440, {size = 22, row = 34, bh = 38})
  M.fuel(parent, "fuel", 740, 130, 300, {size = 20, row = 34, bh = 38})
  M.tractor(parent, "trc", 1090, 130, 460, {size = 22, row = 40, bh = 40})
end

function L.shipsim() return M.initial() end

-- ------------------------------------------------------------------ control
function L.lock(n)
  L.endTour()
  sim.lock = (sim.lock == n) and 0 or n
  push()   -- lc_lock and the locked contact's name, bearing and range (panels bind to them)
  local ret = sc:get("reticle")
  if not ret then return end   -- a theme with its own lock display (the bridge wall binds to lc_lock)
  if sim.lock == 1 or sim.lock == 2 or sim.lock == 5 then
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
    t.obj:animate{[t.prop] = P[t.role], dur = 0.9 + 1.5 * calm, ease = "inOutSine"}
    if t.interactive then
      t.obj:state("hover", {fill = lighten(P[t.role])}, {dur = 0.1})
    end
  end
  local rr = sc:get("rdring")
  if rr then rr:animate{fill = P.p, dur = 0.9} end
  gfx.var("lc_alert", alert)
  local edge = sc:get("alert_edge")
  if edge then
    edge:set{stroke = S.alertEdge or "#ff2a1f"}
    if alert == "red" then -- calm makes it a slow, shallow pulse instead of a flash
      edge:animate{opacity = {from = 0.15 * (1 - 0.6 * calm), to = 0.95 * (1 - 0.7 * calm)}, dur = 0.7 + 2.2 * calm, ease = "inOutSine", loop = "inf", yoyo = true}
    else
      edge:stop()
      edge:animate{opacity = 0, dur = 0.5}
    end
  end
  if S.onAlert then S.onAlert(alert == "red") end
  gfx.var("lc_bg", P.bg)
  sc:open{bg = P.bg}
end

local function mv(o, props, instant)
  if not o then return end
  if instant then o:set(props) return end
  local t = {dur = DUR, ease = "inOutCubic"}
  for k, v in pairs(props) do t[k] = v end
  o:animate(t)
end

-- Lays the console out for the compact or the expanded text port. Everything is a renderer-side tween (eased, same
-- duration), the script only says where things end up. Policy: the sensors console shrinks its viewscreen, radar and
-- contact list around the port; the engineering, tactical and ship consoles fade their widgets out and show a one-line
-- summary strip above the port; pressing LOG again brings everything back.
local function layout(ex, instant)
  if not sc then return end
  local pr = ex and PORT_E or PORT_C
  for _, id in ipairs{"textport", "portframe"} do
    local o, pad = sc:get(id), id == "portframe" and 8 or 0
    if o then
      local final = {x = pr[1] - pad, y = pr[2] - pad, w = pr[3] + 2 * pad, h = pr[4] + 2 * pad}
      mv(o, final, instant)
      if not instant then -- the Go side mirrors only what is set, so record the end state (for reopen)
        after(DUR + 0.1, function() if sc and not closed then o:set(final) end end)
      end
    end
  end
  if S.layout then S.layout(ex, instant, mv) return end   -- a theme with its own layout policy (the bridge wall)
  local k = ex and 0.3 or 1
  mv(sc:get("vsg"), {scaleX = k, scaleY = k}, instant)
  mv(sc:get("rdg"), {scaleX = k, scaleY = k, x = ex and 1450 or 1370, y = ex and 205 or 330}, instant)
  mv(sc:get("ctg"), {y = ex and -330 or 0}, instant)
  for _, id in ipairs{"vslabel", "vshead", "rdlabel", "scg"} do mv(sc:get(id), {opacity = ex and 0 or 1}, instant) end
  for _, name in ipairs{"eng", "tac", "ship", "op"} do
    local m, mi = sc:get("m_" .. name), sc:get("mini_" .. name)
    if m and mi then
      if ex then
        mi:set{visible = true}
        mv(m, {opacity = 0}, instant)
        mv(mi, {opacity = 1}, instant)
        if instant then m:set{visible = false} else after(DUR, function() if expanded then m:set{visible = false} end end) end
      else
        m:set{visible = true}
        mv(m, {opacity = 1}, instant)
        mv(mi, {opacity = 0}, instant)
        if instant then mi:set{visible = false} else after(DUR, function() if not expanded then mi:set{visible = false} end end) end
      end
    end
  end
end

function L.toggle()
  L.endTour()
  expanded = not expanded
  gfx.var("lc_logx", expanded and 1 or 0)
  layout(expanded, false)
end

local function minis()
  local P = S.pal.normal
  local defs = {
    eng = "POWER   WARP {sh_pg_warp|%d}%   SHIELDS {sh_pg_shields|%d}%   MAIN {sh_main|%.1f} GW   AUX {sh_aux|%.1f} GW   COMPONENTS {sh_comp|%d}%",
    tac = "TACTICAL   SHIELDS {lc_pw_shields|%d}%   WEAPONS {lc_pw_weapons|%d}%   TARGET LOCK {lc_lock}",
    ship = "DAMAGE CONTROL   HULL <{sh_dm_hull|%.0f}/875>   PORT <{sh_dm_port|%.1f}/100>   STBD <{sh_dm_stbd|%.1f}/100>   TEAMS 1-5: {dc_a1}",
    op = "OPERATIONS   HATCH {op_hatch}   DOCKING {op_dock}   TRACTOR {tr_state}   TRANSPONDER {op_tx}",
  }
  for name, str in pairs(defs) do
    local g = sc:group{id = "mini_" .. name, parent = consoles[name], visible = false, opacity = 0}
    text(g, "mt_" .. name, 240, 170, str, 30, P.k)
    text(g, "mh_" .. name, 240, 214, "LOG - SHRINK RETURNS THE FULL CONSOLE", 22, P.x)
  end
end

function L.show(name)
  if not consoles[name] then return end
  local order = {sens = 1, eng = 2, tac = 3, ship = 4, op = 5}
  for n, g in pairs(consoles) do
    if n == name then
      g:set{visible = true}
      g:animate{opacity = {from = 0, to = 1}, y = {from = (S.conY or 0) + 14, to = S.conY or 0}, dur = 0.45, ease = "outCubic"}
    elseif n == current then
      g:animate{opacity = 0, dur = 0.25}
      local old = g
      after(0.3, function() if current ~= n then old:hide() end end)
    end
  end
  current = name
  local joy = sc:get("joy")   -- the helm stick only where the ship is flown or aimed
  if joy then joy:set{visible = (name == "sens" or name == "tac")} end
  layout(expanded, true)
  if S.mark then S.mark(order[name]) end
  gfx.var("lc_mode", name)
end

local DEFAULT_BUILD = {sens = sensors, eng = engineering, tac = tactical, ship = shipconsole, op = opsconsole}

function L.start(console, alertState, themeName)
  closed = false
  if timerId then squat.cancel(timerId) end
  sim = sim or newSim()
  S = themes[themeName or curTheme] or themes.tng
  curTheme = S.name
  themed, consoles = {}, {}
  sc = gfx.scene("lcars", {w = W, h = H, bg = S.pal.normal.bg, dock = dock, size = size, portNode = usePort and "textport" or "none", margin = {0, 0, 0, 0}, bloom = S.bloom or 0.55, fit = "contain", calm = calm})
  sc:clear()
  sc:on_close(function() L.stop(true) end)
  for _, f in ipairs(S.fonts or {}) do gfx.font(f[1], f[2], f[3]) end
  sc:open{open = true}
  gfx.vars{lc_alert = alert}
  S.frame()
  S.nav()
  joystick()
  if usePort then sc:rect{id = "alert_edge", x = 6, y = 6, w = W - 12, h = H - 12, r = R(22), stroke = "#ff2a1f", strokeWidth = 8, fill = "none", opacity = 0, glow = 0.9, z = 50} end
  for name, build in pairs(DEFAULT_BUILD) do
    consoles[name] = sc:group{id = "c_" .. name, visible = false}
    local main = sc:group{id = "m_" .. name, parent = consoles[name]}
    ;((S.consoles and S.consoles[name]) or build)(main)
    if S.decor then S.decor(name, main) end
  end
  if usePort then minis() end
  gfx.vars{lc_logx = expanded and 1 or 0}
  push()
  current = nil
  L.show(console or "sens")
  if alertState == "red" or alert == "red" then L.alert("red") end
  timerId = every(1, tick)
end

function L.endTour()
  if tourTimer then squat.cancel(tourTimer) tourTimer = nil end
end

function L.stop(fromWindow)
  closed = true
  L.endTour()
  if timerId then squat.cancel(timerId) timerId = nil end
  if sc and not fromWindow then sc:close() end   -- the window already closed it when fromWindow
end

function L.setCalm(v)
  calm = math.max(0, math.min(1, v))
  squat.var.set("lcars_calm", calm)
  local here = cw
  for w, st in pairs(states) do -- the one global setting: every session's scene follows
    if w == here then if sc then sc:open{calm = calm} end
    else with(w, function() if sc then sc:open{calm = calm} end end) end
  end
  if states[here] == nil and sc then sc:open{calm = calm} end
end

function L.tour()
  L.endTour()
  local i = 0
  local function nextTheme()
    i = i % #themeOrder + 1
    L.start(current or "sens", nil, themeOrder[i])
  end
  nextTheme()
  tourTimer = every(12, function() if closed then L.endTour() else nextTheme() end end)
end

local ALIASES = {bridge = "ops", picard = "ops", calm_theme = "soft"}
local CONSOLES = {power = "eng", dc = "ship", dmg = "ship", damage = "ship", operations = "op", opscon = "op"}

local function command(m)
  local raw = (m[1] or "")
  if raw:match("^%s*stop") == nil and raw:match("^%s*off") == nil then
    if not gfx.ensure() then return end   -- an explicit command starts fresh: clears any earlier give-up
  end
  local arg = raw:gsub("^%s+", ""):gsub("%s+$", "")
  local first, rest = arg:match("^(%S*)%s*(.*)$")
  first = ALIASES[first] or CONSOLES[first] or first
  if first ~= "" and first ~= "stop" and first ~= "off" and first ~= "tour" then L.endTour() end
  if first == "stop" or first == "off" then L.stop()
  elseif first == "themes" then
    squat.echo("/lcars themes: " .. table.concat(themeOrder, ", ") .. "   (tng is the default; /lcars tour cycles them; /lcars calm on|off|0-100)")
  elseif first == "tour" then L.tour()
  elseif first == "calm" then
    local v = rest == "on" and 0.7 or rest == "off" and 0 or tonumber(rest) and tonumber(rest) / 100
    if not v then squat.echo("calm is " .. math.floor(calm * 100 + 0.5) .. "%   usage: /lcars calm on|off|0-100") return end
    L.setCalm(v)
  elseif themes[first] then
    L.start(current or "sens", nil, first)
  elseif first == "alert" then if sc then L.alert(rest == "red" and "red" or "off") end
  elseif first == "full" then
    dock, size, usePort = "full", nil, true
    L.start(current or "sens")
  elseif first == "size" then
    local n = tonumber(rest)
    if not n or n < 15 or n > 100 then squat.echo("usage: /lcars size 15-100 (percent of the output area)") return end
    dock, size, usePort = "top", n .. "%", false
    L.start(current or "sens")
  elseif first == "log" then
    if sc and usePort then L.toggle() else squat.echo("/lcars log needs the framed console (/lcars full)") end
  elseif first == "eng" or first == "tac" or first == "sens" or first == "ship" or first == "op" or first == "" then
    if sc and consoles[first == "" and "sens" or first] then
      closed = false
      sc:open{dock = dock, size = size, portNode = usePort and "textport" or "none", open = true, calm = calm}   -- reopens after the close button / Escape / /lcars stop
      if not timerId then timerId = every(1, tick) end
      L.show(first == "" and "sens" or first)
    else L.start(first ~= "" and first or "sens") end
  else squat.echo("usage: /lcars [theme|sens|eng|tac|ship|op|themes|tour|calm N|full|size N|log|alert red|off|stop]") end
end

function L.command(m) with(m.world, command, m) end

-- A game's GMCP feeds the same display: Ship.Status {Power = {Warp = 55, ...}, Fuel = {...}} becomes sh_* variables.
squat.on("gmcp", function(m)
  with(m.world, function()
    if m.package ~= "Ship.Status" or type(m.data) ~= "table" or not sim then return end
    local v = {}
    for k, val in pairs(m.data) do
      if type(val) == "number" then v["sh_" .. k] = val end
    end
    gfx.vars(v)
  end)
end)

-- the game's own output feeds the panels: dmg stat, dmg team stat, op stat, power, pg <group> (model.lua)
squat.on("line", function(m)
  with(m.world, function()
    if sim and M and M.parse(m.text or "") then push() end
  end)
end)

squat.alias{match = "^/lcars(?: (.*))?$", regex = true, fn = L.command}
squat.alias{match = "^/lock (\\d)$", regex = true, fn = function(m) with(m.world, function() if sim then L.lock(tonumber(m[1])) end end) end}

-- ------------------------------------------------------------------ themes
local function register(t)
  themes[t.name] = t
  themeOrder[#themeOrder + 1] = t.name
end

register{
  name = "tng", font = "Antonio", fonts = {{"Antonio", "fonts/Antonio-VF.ttf"}},
  pal = {
    normal = {p = "#ff9900", s = "#ffcc99", t = "#cc99cc", q = "#9999ff", x = "#ffcc66", r = "#cc6666", k = "#99ccff", bg = "#000000"},
    red    = {p = "#ff2a1f", s = "#ff8a7a", t = "#b3202a", q = "#8a1622", x = "#ff5a44", r = "#ff2a1f", k = "#ffb0a0", bg = "#140000"},
  },
  frame = tng_frame, nav = tng_nav,
  mark = function(i) sc:get("marker"):animate{y = 206 + (i - 1) * 68, dur = 0.35, ease = "outBack"} end,
}

E.register, E.T, E.text, E.lighten, E.R, E.L, E.gfx, E.PORT_C, E.W, E.H = register, T, text, lighten, R, L, gfx, PORT_C, W, H
E.sc = function() return sc end
E.alertState = function() return alert end
E.sim = function() return sim end
E.push = function() push() end
E.world = function() return cw end
E.after = function(sec, fn) after(sec, fn) end
-- set a system's power level (or change it by delta) and push the variables
E.setPower = function(name, level, delta)
  if not sim then return end
  sim.pw[name] = math.max(0, math.min(100, level or (sim.pw[name] + (delta or 0))))
  push()
end
E.S = function() return S end
E.calm = function() return calm end

-- the text port (an object the renderer animates, invisible) and the frame round it
function E.port(o)
  o = o or {}
  local role = o.role or "p"
  sc:rect{id = "textport", x = PORT_C[1], y = PORT_C[2], w = PORT_C[3], h = PORT_C[4], visible = false}
  T(role, sc:rect{id = "portframe", x = PORT_C[1] - 8, y = PORT_C[2] - 8, w = PORT_C[3] + 16, h = PORT_C[4] + 16, r = o.r or R(14), stroke = S.pal.normal[role],
    strokeWidth = o.width or 4, fill = "none", glow = o.glow or 0.2}, false, "stroke")
end

-- the LOG toggle pill (Alt+L too)
function E.logbtn(o)
  local role = o.role or "x"
  local lb = sc:button{id = "logbtn", x = o.x, y = o.y, w = o.w, h = o.h, r = o.r or R(o.h / 2), fill = S.pal.normal[role],
    text = '{lc_logx == 1 ? "' .. (o.shrink or "LOG - SHRINK") .. '" : "' .. (o.expand or "LOG - EXPAND") .. '"}', color = o.color or "#000000", size = o.size or 26,
    weight = S.weight or "700", align = o.align or "center", padX = o.padX or 18, font = S.font, key = "alt+l", glow = o.glow or 0.04}
  lb:state("hover", {fill = lighten(S.pal.normal[role])}, {dur = 0.1})
  lb:state("down", {scaleX = 0.96}, {dur = 0.06})
  T(role, lb, true)
  lb:on("click", function() L.toggle() end)
  return lb
end

-- console buttons nav1..: items {label, console, role}; o = {x, y, w, h, dx, dy, r, size, align, color}
function E.navbtns(items, o)
  for i, it in ipairs(items) do
    local role = it[3] or "p"
    local b = sc:button{id = "nav" .. i, x = o.x + (i - 1) * (o.dx or 0), y = o.y + (i - 1) * (o.dy or 0), w = o.w, h = o.h, r = o.r or R(o.h / 2), fill = S.pal.normal[role],
      text = it[1], color = o.color or "#000000", size = o.size or 28, weight = S.weight or "700", align = o.align or "center", padX = o.padX or 16, font = S.font, glow = o.glow or 0.04}
    b:state("hover", {fill = lighten(S.pal.normal[role])}, {dur = 0.1})
    b:state("down", {scaleX = 0.96}, {dur = 0.06})
    T(role, b, true)
    if it[2] then b:on("click", function() L.endTour() L.show(it[2]) end) end
  end
end

-- the theme files (each registers one theme through E)
M = require("model")(E)
E.M = M
for _, name in ipairs{"theme_soft", "theme_romulan", "theme_klingon", "theme_tos", "theme_ferengi", "theme_bridge"} do
  local ok, err = pcall(function() require(name)(E) end)
  if not ok then squat.log("lcars: theme " .. name .. " failed to load: " .. tostring(err), "warn") end
end

gfx.wrap = function(world, fn) with(world, fn) end   -- clicks and window events run in the session that owns the scene

return L
