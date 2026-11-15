-- Ops: (also /lcars bridge, /lcars picard) a wraparound wall of angled black-glass screens, dense small readouts, thin red strip lighting and a warm floor
-- glow, in the spirit of a dense starship-bridge wall. The real text port is one panel of the wall.
-- Every console re-skins the WHOLE wall (left panel, centre schematic, right panel, title): sensors, power, tactical, damage
-- control and operations each carry their own data from the shared simulation (lc_*, sh_* variables), nothing is repeated.
-- Own line geometry. Type: Rajdhani (SIL OFL).
return function(E)
  local L, gfx, M = E.L, E.gfx, E.M
  local CY, RED, AMB, DIM = "#4fd6e8", "#ff3b2f", "#e8a23a", "#1a232a"
  -- the console group sits at the centre panel (240, 100); the side panels are children at -220 and +870
  local AX, CX = -220, 870
  local SYS = {{"warp", "WARP"}, {"impulse", "IMPULSE"}, {"shields", "SHIELDS"}, {"weapons", "WEAPONS"}, {"sensors", "SENSORS"}, {"life", "LIFE SUPPORT"}}

  local function glass(sc, id, x, y, w, h, skew)
    sc:rect{id = id, x = x, y = y, w = w, h = h, r = 12, skewY = skew, z = -6, stroke = "#313a42", strokeWidth = 2,
      fill = {type = "linear", angle = 160, stops = {{0, "#10161b"}, {1, "#04060a"}}}}
    sc:rect{id = id .. "s", x = x, y = y, w = w, h = h, r = 12, skewY = skew, z = 40, opacity = 0.5,   -- glass sheen
      fill = {type = "linear", angle = 115, stops = {{0, "#ffffff22"}, {0.35, "#ffffff00"}, {1, "#ffffff08"}}}}
  end
  local function small(parent, id, x, y, str, size, fill, align)
    return E.text(parent, id, x, y, str, size or 16, fill or "#9fd0d8", align or "left", {weight = "500"})
  end

  -- the wall shared by every console: glass, strip lights, status strip, text port
  local function frame()
    local sc, S, T, text = E.sc(), E.S(), E.T, E.text
    local P = S.pal.normal
    sc:rect{id = "floor", x = 0, y = 850, w = 1600, h = 50, z = -8, fill = {type = "linear", angle = 180, stops = {{0, "#e8a23a00"}, {1, "#e8a23a66"}}}}
    glass(sc, "gA", 20, 100, 210, 740, -3)
    glass(sc, "gB", 240, 100, 800, 524, 0)
    glass(sc, "gC", 1110, 100, 470, 740, 3)
    for i, r in ipairs{{236, 92, 808}, {1106, 92, 478}, {16, 92, 218}} do
      T("p", sc:rect{id = "strip" .. i, x = r[1], y = r[2], w = r[3], h = 3, fill = P.p, glow = 0.35, skewY = i == 2 and 3 or (i == 3 and -3 or 0)})
    end
    T("x", sc:rect{id = "rail1", x = 240, y = 630, w = 800, h = 4, fill = P.x, opacity = 0.9})
    T("s", sc:rect{id = "rail2", x = 240, y = 836, w = 1340, h = 3, fill = P.s, opacity = 0.7})
    text(nil, "bh2", 1570, 72, "SD {lc_sd|%.1f}", 26, P.x, "right")
    text(nil, "bf1", 250, 862, "CONDITION {lc_alert == \"red\" ? \"RED\" : \"GREEN\"}   HULL {lc_hull|%d}%   SHIELDS {lc_pw_shields|%d}%   CORE {lc_core|%d}%", 22, P.k, "left")
    E.port{role = "x", r = 8, width = 2, glow = 0}
  end
  local function nav()
    E.navbtns({{"SENS", "sens", "x"}, {"POWER", "eng", "s"}, {"TAC", "tac", "p"}, {"DAMAGE", "ship", "k"}, {"OPS", "op", "r"}}, {x = 480, y = 104, w = 90, h = 28, dx = 94, r = 3, size = 16, color = "#0a0d10"})
    E.logbtn{x = 960, y = 104, w = 80, h = 28, r = 3, role = "x", size = 15, color = "#0a0d10", shrink = "LOG -", expand = "LOG +"}
  end

  -- ---------------------------------------------------------------- pieces
  -- a labelled horizontal bar (value expression 0..max) with an optional click handler
  local function bar(parent, id, x, y, w, label, expr, max, role, valfmt, click, ox)
    local sc, T = E.sc(), E.T
    local P = E.S().pal.normal
    small(parent, id .. "n", x, y, label, 14, P.k)
    if valfmt then small(parent, id .. "v", x + w, y, valfmt, 14, P.s, "right") end
    local tr = sc:rect{parent = parent, id = id .. "t", x = x, y = y + 10, w = w, h = 8, r = 2, fill = DIM, hit = click ~= nil}
    local f = sc:rect{parent = parent, id = id .. "f", x = x, y = y + 10, w = 6, h = 8, r = 2, fill = P[role]}
    T(role, f)
    f:bind("w", "max(4, clamp(" .. expr .. ", 0, " .. max .. ") / " .. max .. " * " .. w .. ")", 0.8)
    if click then
      tr:state("hover", {fill = "#2a3a44"}, {dur = 0.1})
      tr:on("click", function(_, e) click(math.max(0, math.min(1, (e.x - (x + (ox or 0))) / w))) end)
    end
    return f
  end
  local function lights(parent, id, x, y, rows, cols, seedmod)
    local sc = E.sc()
    for r = 0, rows - 1 do for c = 0, cols - 1 do
      local o = sc:rect{parent = parent, id = string.format("%s%d_%d", id, r, c), x = x + c * 32, y = y + r * 22, w = 24, h = 12, r = 2, fill = ((r + c) % seedmod == 0) and RED or CY, opacity = 0.85}
      if (r * 5 + c * 3) % 4 ~= 0 then o:animate{opacity = {from = 0.85, to = 0.12}, dur = 0.6 + ((r + c) % 5) * 0.4, ease = "steps(2)", loop = "inf", yoyo = true, delay = (r * c) % 4 * 0.3} end
    end end
  end
  -- the wire schematic of an invented starship (own geometry), centred at (x, y)
  local function wireship(parent, pre, x, y, k)
    local sc = E.sc()
    local g = sc:group{parent = parent, id = pre .. "ship", x = x - 115 * k, y = y - 50 * k, scaleX = k, scaleY = k}   -- (x, y) is the middle of the drawing
    for i, rx in ipairs{150, 112, 76, 40} do sc:ellipse{parent = g, id = pre .. "sau" .. i, x = 0, y = -30, rx = rx, ry = rx * 0.42, stroke = CY, strokeWidth = i == 1 and 2.5 or 1.5, fill = "none"} end
    for k2 = 0, 7 do local a = math.rad(k2 * 45) sc:line{parent = g, id = pre .. "sp" .. k2, x1 = 40 * math.cos(a), y1 = -30 + 17 * math.sin(a), x2 = 150 * math.cos(a), y2 = -30 + 63 * math.sin(a), stroke = CY, strokeWidth = 1, opacity = 0.5} end
    sc:ellipse{parent = g, id = pre .. "hullo", x = 110, y = 90, rx = 112, ry = 28, stroke = CY, strokeWidth = 2, fill = "none"}
    sc:ellipse{parent = g, id = pre .. "hulli", x = 120, y = 90, rx = 70, ry = 14, stroke = CY, strokeWidth = 1, fill = "none", opacity = 0.7}
    sc:polyline{parent = g, id = pre .. "neck1", points = {40, -8, 80, 66}, stroke = CY, strokeWidth = 2}
    sc:polyline{parent = g, id = pre .. "neck2", points = {-6, -2, 20, 70}, stroke = CY, strokeWidth = 2}
    sc:rect{parent = g, id = pre .. "nac1", x = 150, y = 20, w = 230, h = 26, r = 13, stroke = CY, strokeWidth = 2, fill = "none"}
    sc:rect{parent = g, id = pre .. "nac2", x = 150, y = 160, w = 230, h = 26, r = 13, stroke = CY, strokeWidth = 2, fill = "none"}
    sc:polyline{parent = g, id = pre .. "py1", points = {190, 70, 210, 46}, stroke = CY, strokeWidth = 2}
    sc:polyline{parent = g, id = pre .. "py2", points = {190, 110, 210, 160}, stroke = CY, strokeWidth = 2}
    return g
  end
  local function panelhead(parent, id, x, y, str) return small(parent, id, x, y, str, 18, E.S().pal.normal.x) end

  -- one console = three panels (left, centre, right) in groups the LOG layout can scale
  local function panels(parent, name, title)
    local sc, S = E.sc(), E.S()
    local P = S.pal.normal
    sc:get("c_" .. name):set{x = 240, y = 100}
    local a = sc:group{id = "pA_" .. name, parent = parent, x = AX, y = 0}
    local b = sc:group{id = "pB_" .. name, parent = parent, x = 0, y = 0}
    local c = sc:group{id = "pC_" .. name, parent = parent, x = CX, y = 0}
    E.text(parent, name .. "_title", 10, -28, title, 30, P.s, "left")
    return a, b, c
  end

  -- ---------------------------------------------------------------- SENSORS
  local function sensors(parent)
    local sc, S, T = E.sc(), E.S(), E.T
    local P = S.pal.normal
    local a, b, c = panels(parent, "sens", "ENDEAVOUR  -  LONG-RANGE SENSORS")
    -- left: array gain, the noise floor as eight live columns, indicators
    panelhead(a, "s_a0", 14, 22, "SENSOR ARRAY")
    bar(a, "s_gain", 14, 54, 180, "ARRAY GAIN", "lc_pw_sensors", 100, "x", "{lc_pw_sensors|%d}%")
    bar(a, "s_cnt", 14, 92, 180, "CONTACTS TRACKED", "6", 12, "k", "6")
    panelhead(a, "s_a1", 14, 150, "NOISE FLOOR")
    for i = 1, 8 do
      local col = sc:rect{parent = a, id = "s_nz" .. i, x = 16 + (i - 1) * 22, y = 300, w = 16, h = 6, fill = AMB}
      col:bind("h", "max(4, fg_" .. i .. " * 1.5)", 0.9)
      col:bind("y", "300 - max(4, fg_" .. i .. " * 1.5)", 0.9)
    end
    small(a, "s_nzl", 14, 318, "OLDEST  >  NEWEST", 12, P.k)
    panelhead(a, "s_a2", 14, 350, "SCANS")
    for i, n in ipairs{{"SRS", "srs"}, {"LRS", "lrs"}, {"PASSIVE", "passive"}, {"DOCKSCAN", "dockscan"}, {"INTERNAL", "internal"}} do
      M.btn(a, "s_scn" .. i, 14, 372 + (i - 1) * 40, 182, 32, n[1], i <= 2 and "x" or "s", function()
        local sm = E.sim()
        if i > 2 then
          if sm.lock == 0 then sm.ship.lc_hint = "LOCK A CONTACT FIRST" E.push() return end
          M.cmd(n[2] .. " " .. sm.lock)
        else M.cmd(n[2]) end
      end, 16)
    end
    small(a, "s_hint", 14, 586, "LOCKED CONTACT: {lc_hint}", 11, P.k)
    -- centre: polar scope of the contacts, scan sweep, lock reticle, own ship in the middle
    panelhead(b, "s_b0", 16, 22, "CONTACT OVERLAY")
    for i, r in ipairs{73, 147, 220} do sc:circle{parent = b, id = "s_ring" .. i, x = 400, y = 310, r = r, stroke = "#2a4a52", strokeWidth = 1.5, fill = "none"} end
    sc:line{parent = b, id = "s_ax1", x1 = 180, y1 = 310, x2 = 620, y2 = 310, stroke = "#2a4a52", strokeWidth = 1}
    sc:line{parent = b, id = "s_ax2", x1 = 400, y1 = 90, x2 = 400, y2 = 510, stroke = "#2a4a52", strokeWidth = 1}
    small(b, "s_r1", 477, 310, "33", 12, P.k); small(b, "s_r2", 551, 310, "66", 12, P.k); small(b, "s_r3", 624, 310, "100", 12, P.k)
    local sweep = sc:group{parent = b, id = "s_sweep", x = 400, y = 310}
    sc:line{parent = sweep, id = "s_sw1", x1 = 0, y1 = 0, x2 = 0, y2 = -220, stroke = "#7ff0a0", strokeWidth = 2, opacity = 0.8}
    sc:arc{parent = sweep, id = "s_sw2", x = 0, y = 0, r0 = 0, r1 = 220, a0 = 330, a1 = 360, fill = "#4fe08a22"}
    sweep:animate{rotation = {from = 0, to = 360}, dur = 5, ease = "linear", loop = "inf"}
    wireship(b, "s_", 400, 310, 0.26)
    for i = 1, 6 do
      local hostile = (i == 2 or i == 4 or i == 6)
      local dot = sc:circle{parent = b, id = "s_bl" .. i, x = 400, y = 310, r = 6, fill = hostile and RED or CY, glow = 0.5}
      dot:bind("x", "400 + lc_r" .. i .. " * 2.2 * sin(lc_b" .. i .. " * 0.0174533)", 0.9)
      dot:bind("y", "310 - lc_r" .. i .. " * 2.2 * cos(lc_b" .. i .. " * 0.0174533)", 0.9)
      local lb = small(b, "s_bn" .. i, 408, 296, "{lc_n" .. i .. "}", 12, hostile and "#ff9a8a" or P.k)
      lb:bind("x", "412 + lc_r" .. i .. " * 2.2 * sin(lc_b" .. i .. " * 0.0174533)", 0.9)
      lb:bind("y", "296 - lc_r" .. i .. " * 2.2 * cos(lc_b" .. i .. " * 0.0174533)", 0.9)
    end
    local ret = sc:circle{parent = b, id = "s_reticle", x = 400, y = 310, r = 18, stroke = AMB, strokeWidth = 2, fill = "none", glow = 0.4, opacity = 0}
    ret:bind("x", "400 + lc_lr * 2.2 * sin(lc_lb * 0.0174533)", 0.4)
    ret:bind("y", "310 - lc_lr * 2.2 * cos(lc_lb * 0.0174533)", 0.4)
    ret:bind("opacity", "lc_lock > 0 ? 1 : 0", 0.3)
    small(b, "s_lk", 16, 500, "LOCK {lc_lock > 0 ? lc_ln : \"NONE\"}   BRG {lc_lb|%03d}   RNG {lc_lr|%d}", 15, AMB)
    -- right: the contact table (click a row to lock), the radar dish, noise telemetry
    panelhead(c, "s_c0", 16, 22, "CONTACT TABLE")
    small(c, "s_ch", 16, 52, "NAME           T  BRG  RNG", 14, P.x)
    for i = 1, 6 do
      local y = 80 + (i - 1) * 30
      local sel = sc:rect{parent = c, id = "s_sel" .. i, x = 10, y = y - 14, w = 330, h = 26, r = 2, fill = AMB, opacity = 0}
      sel:bind("opacity", "lc_lock == " .. i .. " ? 0.25 : 0", 0.3)
      local row = small(c, "s_ct" .. i, 16, y, "{lc_n" .. i .. "|pad:-13} {lc_t" .. i .. "}  {lc_b" .. i .. "|%03d}  {lc_r" .. i .. "|%3d}", 17, P.k)
      row:set{hit = true}
      row:state("hover", {fill = "#ffffff"}, {dur = 0.08})
      row:on("click", function() L.lock(i) end)
    end
    small(c, "s_chint", 16, 266, "CLICK A ROW TO LOCK THE SENSORS ON IT", 12, P.x)
    local rd = sc:radar{parent = c, id = "s_radar", x = 235, y = 400, r = 120, trail = 110, rings = 4, color = "#4fe08a", bg = "#03110a", glow = 0.6}
    rd:bind("sweep", "mod(time() * 80, 360)")
    rd:bind("contacts", "lc_ct")
    small(c, "s_rl", 16, 530, "TACTICAL SENSOR ARRAY  -  RANGE 100 = SCOPE EDGE", 12, P.x)
    panelhead(c, "s_c1", 16, 556, "SENSOR NOISE")
    sc:graph{parent = c, id = "s_gr", x = 16, y = 578, w = 260, h = 90, source = "fg_8", samples = 50, interval = 1, min = 0, max = 100, stroke = AMB,
      strokeWidth = 2, fill = {type = "linear", angle = 180, stops = {{0, "#e8a23a44"}, {1, "#e8a23a00"}}}}
    small(c, "s_grl", 16, 684, "WIDEBAND ({fg_8|%d}%)", 13, P.k)
    lights(c, "s_cg", 16, 706, 1, 9, 4)
  end

  -- ---------------------------------------------------------------- POWER (the game's power model)
  local function engineering(parent)
    local sc, S, T = E.sc(), E.S(), E.T
    local P = S.pal.normal
    local a, b, c = panels(parent, "eng", "ENDEAVOUR  -  POWER / ENGINEERING")
    -- left: power groups 1-7 (click one to open it) and the pools
    M.powergroups(a, "pgl", 14, 22, 190, {size = 13, row = 30})
    M.pools(a, "pls", 14, 280, 190, {size = 12, row = 24})
    lights(a, "e_lg", 14, 560, 5, 6, 3)
    -- centre: power-flow schematic with the warp core
    panelhead(b, "e_b0", 16, 22, "POWER FLOW SCHEMATIC")
    wireship(b, "e_", 445, 280, 1)
    local core = sc:shader{parent = b, id = "e_core", x = 398, y = 262, w = 84, h = 150, shader = "warpcore", u = {uA = "#2a6bff", uB = "#bfe0ff", uSpeed = 1, uPower = 0.7}, glow = 0.7}
    core:bind("u.uPower", "lc_core / 100", 0.9)
    local flows = {{-40, 60, 330, 50}, {-20, 20, 280, 10}, {30, 110, 260, 150}}
    for i, p in ipairs(flows) do
      sc:line{parent = b, id = "e_cd" .. i, x1 = 330 + p[1], y1 = 230 + p[2], x2 = 330 + p[3], y2 = 230 + p[4], stroke = AMB, strokeWidth = 2, opacity = 0.6}
      local dot = sc:circle{parent = b, id = "e_fl" .. i, x = 330 + p[1], y = 230 + p[2], r = 5, fill = "#ffe9a0", glow = 0.8}
      dot:animate{x = {from = 330 + p[1], to = 330 + p[3]}, y = {from = 230 + p[2], to = 230 + p[4]}, dur = 1.6 + i * 0.5, ease = "linear", loop = "inf"}
    end
    small(b, "e_n1", 510, 270, "PORT NACELLE  <{sh_dm_port|%.1f}/100>", 14, AMB)
    small(b, "e_n2", 510, 410, "STBD NACELLE  <{sh_dm_stbd|%.1f}/100>", 14, AMB)
    small(b, "e_n3", 40, 270, "WARP CORE  {lc_core|%d}%", 14, AMB)
    small(b, "e_n4", 40, 296, "MAIN  {sh_main|%.2f} GW", 14, P.k)
    small(b, "e_n5", 40, 322, "AUX   {sh_aux|%.2f} GW", 14, P.k)
    small(b, "e_n6", 40, 348, "BATTERY {sh_batt * 1000|%.0f} MW", 14, P.k)
    small(b, "e_n7", 16, 500, "SELECTED GROUP: {pg_name}   WARP {sh_pg_warp|%d}%   SHIELDS {sh_pg_shields|%d}%   WEAPONS {sh_pg_weapons|%d}%", 15, AMB)
    -- right: the selected group (components, set buttons, slider, generators), then the trends
    M.pgdetail(c, "pgd", 16, 22, 430, {size = 14, row = 28, bh = 30, ox = 1110})
    panelhead(c, "e_c0", 16, 470, "CORE THERMAL")
    sc:graph{parent = c, id = "e_gr1", x = 16, y = 490, w = 260, h = 44, source = "lc_core", samples = 60, interval = 1, min = 30, max = 100, stroke = RED, strokeWidth = 2,
      fill = {type = "linear", angle = 180, stops = {{0, "#ff3b2f44"}, {1, "#ff3b2f00"}}}}
    panelhead(c, "e_c1", 16, 556, "WARP FIELD")
    sc:graph{parent = c, id = "e_gr2", x = 16, y = 576, w = 260, h = 44, source = "lc_trend", samples = 60, interval = 1, min = 0, max = 100, stroke = CY, strokeWidth = 2,
      fill = {type = "linear", angle = 180, stops = {{0, "#4fd6e844"}, {1, "#4fd6e800"}}}}
    lights(c, "e_cg", 16, 650, 1, 9, 4)
  end

  -- ---------------------------------------------------------------- TACTICAL
  local function tactical(parent)
    local sc, S, T = E.sc(), E.S(), E.T
    local P = S.pal.normal
    local a, b, c = panels(parent, "tac", "ENDEAVOUR  -  TACTICAL / WEAPONS AND DEFLECTORS")
    -- left: weapon status and the three controls
    panelhead(a, "t_a0", 14, 22, "WEAPONS STATUS")
    bar(a, "t_ph", 14, 54, 180, "PHASER CHARGE", "sh_charge", 35000, "p", "{sh_charge / 350|%d}%")
    bar(a, "t_wp", 14, 92, 180, "WEAPONS POWER", "lc_pw_weapons", 100, "x", "{lc_pw_weapons|%d}%")
    bar(a, "t_sp", 14, 130, 180, "SHIELD POWER", "lc_pw_shields", 100, "k", "{lc_pw_shields|%d}%")
    local burst = 0
    local muzzle = sc:emitter{parent = b, id = "t_muzzle", x = 400, y = 270, rate = 0, lifeMin = 0.4, lifeMax = 0.9, speedMin = 160, speedMax = 300, angle = 0, spread = 16,
      sizeStart = 9, sizeEnd = 2, colorStart = "#ffdd77", colorEnd = "#ff220000", glow = 1}
    local function weapon(id, y, label, role, n, cost)
      local btn = sc:button{parent = a, id = id, x = 14, y = y, w = 182, h = 38, r = 4, fill = P[role], text = label, color = "#0a0d10", size = 18, font = S.font, weight = "700"}
      btn:state("hover", {fill = E.lighten(P[role])}, {dur = 0.1})
      btn:state("down", {scaleX = 0.97}, {dur = 0.05})
      T(role, btn, true)
      btn:on("click", function()
        burst = burst + 1
        muzzle:set{burst = n, burstId = burst}
        for i = 1, 3 do sc:get("t_f" .. i):animate{opacity = {from = 1, to = 0.25}, dur = 0.45, ease = "outQuad"} end
        E.setPower("weapons", nil, -cost)
      end)
    end
    weapon("t_phasers", 190, "FIRE PHASERS", "p", 60, 5)
    weapon("t_torps", 240, "PHOTON TORPEDO", "x", 120, 8)
    local ra = sc:button{parent = a, id = "t_ralert", x = 14, y = 296, w = 182, h = 50, r = 4, fill = "#cc2222", text = "RED ALERT", color = "#ffffff", size = 24, font = S.font, weight = "700"}
    ra:state("hover", {fill = "#ff4a3a"}, {dur = 0.1})
    ra:on("click", function() L.alert(E.alertState() == "red" and "off" or "red") end)
    panelhead(a, "t_a1", 14, 382, "FACING DEFLECTORS")
    for i, f in ipairs{"FORE", "STARBOARD", "AFT", "PORT"} do
      bar(a, "t_fc" .. i, 14, 408 + (i - 1) * 40, 180, f, "lc_pw_shields", 100, "q", "{lc_pw_shields|%d}%")
    end
    lights(a, "t_lg", 14, 590, 5, 6, 3)
    -- centre: deflector arcs per facing around the ship, lock brackets
    panelhead(b, "t_b0", 16, 22, "SHIELD FACINGS")
    wireship(b, "t_", 400, 290, 0.55)
    local sections = {{"FORE", 315, 45, 0}, {"STBD", 45, 135, 1}, {"AFT", 135, 225, 2}, {"PORT", 225, 315, 3}}
    for i, s in ipairs(sections) do
      for ring = 1, 3 do
        local arc = sc:arc{parent = b, id = "t_sh" .. i .. "_" .. ring, x = 400, y = 290, r0 = 110 + ring * 22, r1 = 110 + ring * 22 + 12, a0 = s[2] + 3, a1 = s[3] - 3 + (s[3] < s[2] and 360 or 0), fill = CY, glow = 0.25}
        arc:bind("opacity", "clamp((lc_pw_shields - " .. ((3 - ring) * 25) .. ") / 25, 0.12, 1)", 0.8)
        if ring == 3 then sc:get("t_sh" .. i .. "_" .. ring) end
      end
    end
    -- the hit flash on firing: the three rings pulse together
    for i = 1, 3 do sc:circle{parent = b, id = "t_f" .. i, x = 400, y = 290, r = 110 + i * 22 + 18, stroke = "#ffffff", strokeWidth = 1, fill = "none", opacity = 0.25} end
    small(b, "t_fa", 400, 88, "FORE", 14, AMB, "center"); small(b, "t_fb", 400, 494, "AFT", 14, AMB, "center")
    small(b, "t_fc", 628, 290, "STBD", 14, AMB, "left"); small(b, "t_fd", 172, 290, "PORT", 14, AMB, "right")
    local ret = sc:circle{parent = b, id = "t_reticle", x = 400, y = 290, r = 20, stroke = RED, strokeWidth = 2, fill = "none", glow = 0.5, opacity = 0}
    ret:bind("x", "400 + lc_lr * 2.2 * sin(lc_lb * 0.0174533)", 0.4)
    ret:bind("y", "290 - lc_lr * 2.2 * cos(lc_lb * 0.0174533)", 0.4)
    ret:bind("opacity", "lc_lock > 0 ? 1 : 0", 0.3)
    small(b, "t_lk", 16, 500, "TARGET {lc_lock > 0 ? lc_ln : \"NONE\"}   BEARING {lc_lb|%03d}   RANGE {lc_lr|%d}", 15, AMB)
    -- right: target list (click to lock), threat colouring, lock data
    panelhead(c, "t_c0", 16, 22, "TARGET LIST")
    small(c, "t_ch", 16, 52, "NAME           T  BRG  RNG   THREAT", 14, P.x)
    for i = 1, 6 do
      local y = 80 + (i - 1) * 34
      local sel = sc:rect{parent = c, id = "t_sel" .. i, x = 10, y = y - 15, w = 440, h = 28, r = 2, fill = RED, opacity = 0}
      sel:bind("opacity", "lc_lock == " .. i .. " ? 0.3 : 0", 0.3)
      local row = small(c, "t_ct" .. i, 16, y, "{lc_n" .. i .. "|pad:-13} {lc_t" .. i .. "}  {lc_b" .. i .. "|%03d}  {lc_r" .. i .. "|%3d}   {lc_t" .. i .. " == \"H\" ? \"HOSTILE\" : (lc_t" .. i .. " == \"U\" ? \"UNKNOWN\" : \"FRIENDLY\")}", 16, P.k)
      row:set{hit = true}
      row:state("hover", {fill = "#ffffff"}, {dur = 0.08})
      row:on("click", function() L.lock(i) end)
    end
    panelhead(c, "t_c1", 16, 300, "LOCK SOLUTION")
    small(c, "t_s1", 16, 330, "TARGET     {lc_lock > 0 ? lc_ln : \"NONE\"}", 16, P.s)
    small(c, "t_s2", 16, 356, "BEARING    {lc_lb|%03d}", 16, P.s)
    small(c, "t_s3", 16, 382, "RANGE      {lc_lr|%d}", 16, P.s)
    small(c, "t_s4", 16, 408, "WEAPONS    {lc_lock > 0 ? \"TRACKING\" : \"SAFE\"}", 16, P.s)
    panelhead(c, "t_c2", 16, 450, "WEAPON POWER")
    sc:graph{parent = c, id = "t_gr", x = 16, y = 470, w = 270, h = 70, source = "lc_pw_weapons", samples = 40, interval = 1, min = 0, max = 100, stroke = RED, strokeWidth = 2,
      fill = {type = "linear", angle = 180, stops = {{0, "#ff3b2f44"}, {1, "#ff3b2f00"}}}}
    lights(c, "t_cg", 16, 560, 1, 9, 4)
  end

  -- ---------------------------------------------------------------- DAMAGE CONTROL (the game's dmg commands)
  local function shipstatus(parent)
    local sc, S, T = E.sc(), E.S(), E.T
    local P = S.pal.normal
    local a, b, c = panels(parent, "ship", "ENDEAVOUR  -  DAMAGE CONTROL")
    -- left: teams 1-5 (click to pick one), refresh
    M.teams(a, "dct", 14, 22, 196, {size = 13, row = 32})
    M.btn(a, "d_ref", 14, 300, 182, 34, "REFRESH: DMG STAT", "p", function() M.refreshDmg() end, 14)
    small(a, "d_cr", 14, 360, "CREW TOTAL {dc_c1 + dc_c2 + dc_c3 + dc_c4 + dc_c5}", 14, P.k)
    small(a, "d_note", 14, 392, "TEAM STAT SENDS:  DMG TEAM STAT", 11, P.x)
    small(a, "d_note2", 14, 410, "ASSIGN SENDS:  DMG ASSIGN <N>=<SYSTEM>", 11, P.x)
    lights(a, "d_lg", 14, 460, 5, 6, 3)
    -- centre: schematic with damage glows; clicking a glow assigns the selected team to that system
    panelhead(b, "d_b0", 16, 22, "DAMAGE SCHEMATIC")
    wireship(b, "d_", 445, 280, 1)
    local zones = {{"sh_dm_port", 595, 263, "PORT NACELLE", 100, "Port_Nacelle"}, {"sh_dm_stbd", 595, 403, "STBD NACELLE", 100, "Starboard_Nacelle"}, {"sh_dm_hull", 440, 320, "HULL", 875, "Hull"}}
    for i, z in ipairs(zones) do
      local glow = sc:circle{parent = b, id = "d_dz" .. i, x = z[2], y = z[3], r = 26, fill = RED, opacity = 0.2, glow = 0.6, hit = true}
      glow:bind("opacity", "(1 - " .. z[1] .. " / " .. z[5] .. ") * 1.6 + 0.06", 0.8)
      glow:animate{scaleX = {from = 0.7, to = 1.15}, scaleY = {from = 0.7, to = 1.15}, dur = 1.1 + i * 0.3, ease = "inOutSine", loop = "inf", yoyo = true}
      glow:on("click", function() M.assign(z[6]) end)
      small(b, "d_dzl" .. i, z[2] + 34, z[3], z[4] .. "  <{" .. z[1] .. "|%.1f}/" .. z[5] .. ">", 14, AMB)
    end
    small(b, "d_sum", 16, 500, "CLICK A GLOW TO ASSIGN THE SELECTED TEAM   {dc_pend}   {lc_hint}", 14, AMB)
    -- right: the damage statistics with bars, then the trends
    M.systems(c, "dcs", 16, 22, 430, {size = 15, row = 32})
    panelhead(c, "d_c2", 16, 330, "HULL INTEGRITY")
    sc:graph{parent = c, id = "d_gr1", x = 16, y = 350, w = 300, h = 50, source = "lc_hull", samples = 60, interval = 1, min = 0, max = 105, stroke = "#66cc88", strokeWidth = 2,
      fill = {type = "linear", angle = 180, stops = {{0, "#66cc8844"}, {1, "#66cc8800"}}}}
    panelhead(c, "d_c3", 16, 424, "PORT NACELLE")
    sc:graph{parent = c, id = "d_gr2", x = 16, y = 444, w = 300, h = 50, source = "sh_dm_port", samples = 60, interval = 1, min = 60, max = 105, stroke = AMB, strokeWidth = 2,
      fill = {type = "linear", angle = 180, stops = {{0, "#e8a23a44"}, {1, "#e8a23a00"}}}}
    lights(c, "d_cg", 16, 540, 1, 9, 4)
  end

  -- ---------------------------------------------------------------- OPERATIONS (op stat, hatch, docking, fuel, tractor beam)
  local function operations(parent)
    local sc, S, T = E.sc(), E.S(), E.T
    local P = S.pal.normal
    local a, b, c = panels(parent, "op", "ENDEAVOUR  -  OPERATIONS")
    M.opstat(a, "ops", 14, 22, 190, {size = 12, row = 24, bh = 30, stack = true})
    -- centre: the ship with its hatch, and the tractor beam to the locked contact
    panelhead(b, "o_b0", 16, 22, "VESSEL / TRACTOR")
    wireship(b, "o_", 250, 300, 0.7)
    local hatch = sc:circle{parent = b, id = "o_hatch", x = 250, y = 330, r = 9, fill = AMB, glow = 0.6}
    hatch:bind("fill", "op_hatch == \"Open\" ? \"#66cc88\" : \"#ff3b2f\"")
    small(b, "o_hl", 266, 330, "HATCH {op_hatch}", 13, AMB)
    local beam = sc:line{parent = b, id = "o_beam", x1 = 250, y1 = 300, x2 = 250, y2 = 300, stroke = CY, strokeWidth = 3, opacity = 0, glow = 0.6}
    beam:bind("x2", "250 + lc_lr * 1.2 * sin(lc_lb * 0.0174533)", 0.5)
    beam:bind("y2", "300 - lc_lr * 1.2 * cos(lc_lb * 0.0174533)", 0.5)
    beam:bind("opacity", "lc_lock > 0 ? 0.8 : 0", 0.3)
    local tgt = sc:circle{parent = b, id = "o_tgt", x = 250, y = 300, r = 10, stroke = CY, strokeWidth = 2, fill = "none", opacity = 0}
    tgt:bind("x", "250 + lc_lr * 1.2 * sin(lc_lb * 0.0174533)", 0.5)
    tgt:bind("y", "300 - lc_lr * 1.2 * cos(lc_lb * 0.0174533)", 0.5)
    tgt:bind("opacity", "lc_lock > 0 ? 1 : 0", 0.3)
    small(b, "o_dk", 40, 470, "DOCKING DOORS {op_dock}   LAND {op_land}   LAUNCH {op_launch}", 14, P.k)
    M.tractor(b, "trc", 500, 60, 280, {size = 13, row = 32, bh = 30})
    -- right: fuel and the contact list (lock a target for the tractor beam)
    M.fuel(c, "fuel", 16, 22, 430, {size = 14, row = 28, bh = 32})
    panelhead(c, "o_c1", 16, 250, "CONTACTS  -  CLICK TO LOCK")
    for i = 1, 6 do
      local y = 282 + (i - 1) * 28
      local sel = sc:rect{parent = c, id = "o_sel" .. i, x = 10, y = y - 12, w = 330, h = 24, r = 2, fill = AMB, opacity = 0}
      sel:bind("opacity", "lc_lock == " .. i .. " ? 0.25 : 0", 0.3)
      local row = small(c, "o_ct" .. i, 16, y, "{lc_n" .. i .. "|pad:-13} {lc_t" .. i .. "}  {lc_b" .. i .. "|%03d}  {lc_r" .. i .. "|%3d}", 15, P.k)
      row:set{hit = true}
      row:state("hover", {fill = "#ffffff"}, {dur = 0.08})
      row:on("click", function() L.lock(i) end)
    end
    lights(c, "o_cg", 16, 500, 1, 9, 4)
  end

  -- while the text grows the panels shrink toward the top (each console has its own three)
  local function layout(ex, instant, mv)
    local sc = E.sc()
    for _, n in ipairs{"sens", "eng", "tac", "ship", "op"} do
      mv(sc:get("pB_" .. n), {scaleX = ex and 0.3 or 1, scaleY = ex and 0.3 or 1}, instant)
      mv(sc:get("pC_" .. n), {scaleX = ex and 0.4 or 1, scaleY = ex and 0.4 or 1}, instant)
      mv(sc:get("pA_" .. n), {scaleX = ex and 0.55 or 1, scaleY = ex and 0.55 or 1}, instant)
    end
  end

  E.register{
    name = "ops", conY = 100, font = "Rajdhani", weight = "700", sharp = true, bloom = 0.5, frame = frame, nav = nav, layout = layout, tscale = 1,
    fonts = {{"Rajdhani", "fonts/Rajdhani-Medium.ttf", "500"}, {"Rajdhani", "fonts/Rajdhani-Bold.ttf", "700"}},
    consoles = {sens = sensors, eng = engineering, tac = tactical, ship = shipstatus, op = operations},
    pal = {
      normal = {p = "#ff3b2f", s = "#efe6d2", t = "#4a2a14", q = "#2a3a44", x = "#e8923a", r = "#ff7a2a", k = "#7fd0dc", bg = "#040506"},
      red    = {p = "#ff1a1a", s = "#ffb8a0", t = "#5a1010", q = "#3a1a1a", x = "#ff6a2a", r = "#ff3a1a", k = "#ff9a8a", bg = "#0a0304"},
    },
    alertEdge = "#ff2a1f",
  }
end
