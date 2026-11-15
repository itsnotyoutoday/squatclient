-- model.lua: the ship-console model shared by every theme, and the panels (modules) the consoles are built from.
--
-- WHAT IS REAL AND WHAT IS SIMULATED
--   The data follows the game's own console commands:  dmg stat / dmg team stat / dmg assign <team>=<system>,
--   power / pg <group> / power <group>=<value> / eng main|aux <value>, op stat / hatch / dd open|close / fuel stat,
--   tractor lock|dest|engage|reset|stat, srs / lrs / passive|dockscan|internal <contact>.
--   Each panel shows variables (sh_*, dc_*, pg_*, op_*, tr_*).  They start from the numbers of a sample session (so the
--   screen is complete offline), and the client keeps them current by PARSING the game's output (parse() below): sending
--   `dmg stat` and reading "Port_Nacelle [====] <86.4/100.0>" updates sh_dm_port, and so on.  GMCP Ship.Status feeds the sh_* set too.
--   Every button sends a real command to the game in this session, only while it is connected, and shows the command in the
--   output first.  A reply "That function is not available from this console" becomes a hint (man opera).
return function(E)
  local gfx, L = E.gfx, E.L
  local M = {}

  M.PG = {{"arrays", "ARRAYS"}, {"cloak", "CLOAK"}, {"fuel", "FUEL"}, {"ops", "OPERATIONS"}, {"shields", "SHIELDS"}, {"warp", "WARP"}, {"weapons", "WEAPONS"}}
  M.SYSTEMS = {{"Hull", "HULL"}, {"Port_Nacelle", "PORT NACELLE"}, {"Starboard_Nacelle", "STARBOARD NACELLE"}}
  M.PRESETS = {{"0%", "0%"}, {"25%", "25%"}, {"50%", "50%"}, {"100%", "100%"}, {"max", "MAX"}, {"off", "OFF"}}

  -- the state the panels read; the sample numbers are those of a real session
  function M.initial()
    local v = {
      sh_main = 5.4, sh_aux = 1.0, sh_batt = 0.004, sh_total = 6400, sh_comp = 60, sh_compw = 3856, sh_repair = 0, sh_bchg = 0,
      sh_charge = 0, sh_deut = 498815.78, sh_anti = 299334.36,
      sh_dm_port = 86.4, sh_dm_stbd = 86.4, sh_dm_hull = 875,
      sh_pg_arrays = 5, sh_pg_cloak = 0, sh_pg_fuel = 0, sh_pg_ops = 0, sh_pg_shields = 0, sh_pg_warp = 55, sh_pg_weapons = 0,
      sh_w_arrays = 350, sh_w_cloak = 0, sh_w_fuel = 1.7, sh_w_ops = 4.5, sh_w_shields = 0, sh_w_warp = 3500, sh_w_weapons = 0,
      dc_sel = 0, dc_pend = "", lc_hint = "",
      pg_sel = 1, pg_name = "ARRAYS",
      op_tx = "On", op_code = "FCGR7043", op_name = "ENDEAVOUR", op_class = "Marauder", op_mass = "-", op_vis = "-", op_hatch = "Open",
      op_land = "Yes", op_launch = "Yes", op_dock = "Not Present",
      tr_state = "-", tr_target = "none", tr_room = 1,
    }
    for i = 1, 5 do v["dc_c" .. i], v["dc_a" .. i] = 10, "Hull" end
    for i = 1, 4 do for _, k in ipairs{"n", "sh", "co", "pw", "pr", "rq", "un"} do v["pgc_" .. k .. i] = "-" end end
    v.pgc_n1, v.pgc_n2, v.pgc_n3 = "Long_Range_Sensor", "Short_Range_Sensor", "Subspace_Array"
    v.pgc_pr1, v.pgc_pr2, v.pgc_pr3 = "Normal", "Normal", "Normal"
    return v
  end

  -- ------------------------------------------------------------------ sending commands
  -- every command is shown in the output, then sent to the game of THIS session; nothing is sent when it is not connected
  function M.cmd(c)
    squat.echo("lcars> " .. c)
    local ok, err = squat.send(c, E.world())
    if not ok then squat.echo("lcars: not connected, the command was not sent") return false end
    return true
  end
  function M.refreshDmg() if M.cmd("dmg stat") then M.cmd("dmg team stat") end end
  function M.refreshPower() if M.cmd("power") then if E.sim().ship.pg_name then M.cmd("pg " .. M.PG[E.sim().ship.pg_sel or 1][1]) end end end
  function M.selectTeam(i)
    local s = E.sim().ship
    s.dc_sel = (s.dc_sel == i) and 0 or i
    E.push()
  end
  function M.assign(system)
    local s = E.sim().ship
    if (s.dc_sel or 0) == 0 then s.lc_hint = "PICK A TEAM FIRST, THEN A SYSTEM" E.push() return end
    s.lc_hint = ""
    if M.cmd(string.format("dmg assign %d=%s", s.dc_sel, system)) then
      s.dc_pend = string.format("TEAM %d -> %s SENT", s.dc_sel, system)
      E.push()
      E.after(1.5, function() M.cmd("dmg team stat") end)   -- ask the game what it now says
    end
  end
  function M.selectPG(i)
    local s = E.sim().ship
    s.pg_sel, s.pg_name = i, M.PG[i][2]
    for k = 1, 4 do for _, f in ipairs{"n", "sh", "co", "pw", "pr", "rq", "un"} do s["pgc_" .. f .. k] = "-" end end
    s.pgc_n1 = "(send pg)"
    E.push()
    M.cmd("pg " .. M.PG[i][1])
  end
  function M.setPG(value)
    local s = E.sim().ship
    M.cmd(string.format("power %s=%s", M.PG[s.pg_sel or 1][1], value))
  end

  -- ------------------------------------------------------------------ parsing the game's output
  local UNIT = {W = 1e-6, kW = 1e-3, MW = 1, GW = 1e3}
  local function mw(num, unit) return (tonumber(num) or 0) * (UNIT[unit] or 1) end
  local team = false
  local pgwait = 0
  -- returns true when the line was one of ours
  function M.parse(text)
    local s = E.sim() and E.sim().ship
    if not s then return false end
    local t = text:gsub("^%s+", ""):gsub("%s+$", "")
    local hit = false
    local function num(k, v) s[k] = tonumber(v) or s[k] hit = true end
    local v1 = t:match("^Port_Nacelle.-<([%d%.]+)/[%d%.]+>")
    if v1 then num("sh_dm_port", v1) end
    local v2 = t:match("^Starboard_Nacelle.-<([%d%.]+)/[%d%.]+>")
    if v2 then num("sh_dm_stbd", v2) end
    local v3 = t:match("^Hull Status.-<([%d%.]+)/[%d%.]+>")
    if v3 then num("sh_dm_hull", v3) end
    if t:find("not available from this console", 1, true) then
      s.lc_hint = "NOT AVAILABLE FROM THIS CONSOLE - USE THE OPERATIONS CONSOLE (man opera)"
      squat.echo("lcars: that command needs the Operations console; see: man opera")
      hit = true
    end
    if t:match("^T#%s+Crew") then team = true return true end
    if team then
      local n, c, a = t:match("^(%d)%s+(%d+)%s+(%S+)")
      if n then s["dc_c" .. n], s["dc_a" .. n] = tonumber(c), a hit = true
      elseif t ~= "" then team = false end
    end
    -- op stat
    for pat, key in pairs{["^Transponder Status%s+(.+)$"] = "op_tx", ["^Transponder Code%s+(.+)$"] = "op_code", ["^Vessel Name%s+(.+)$"] = "op_name",
      ["^Vessel Class%s+(.+)$"] = "op_class", ["^Vessel Mass%s+(.+)$"] = "op_mass", ["^Vessel Visibility%s+(.+)$"] = "op_vis",
      ["^Hatch Status%s+(.+)$"] = "op_hatch", ["^CanLand%s+(.+)$"] = "op_land", ["^CanLaunch%s+(.+)$"] = "op_launch", ["^Docking Doors%s+(.+)$"] = "op_dock"} do
      local v = t:match(pat)
      if v then s[key] = v hit = true end
    end
    -- power: "Arrays(1) 5% 350MW", pools, components
    local name, pct, val, unit = t:match("^(%a+)%((%d)%)%s+(%d+)%%%s*([%d%.]*)%s*(%a*)")
    if name then
      local key = name:lower():gsub("^operations$", "ops")
      if s["sh_pg_" .. key] ~= nil then
        s["sh_pg_" .. key] = tonumber(val) or 0
        if unit ~= "" and tonumber(t:match("%%%s*([%d%.]+)")) then s["sh_w_" .. key] = mw(t:match("%%%s*([%d%.]+)"), unit) end
        hit = true
      end
    end
    for lbl, key in pairs{Main = "sh_main", Aux = "sh_aux", Battery = "sh_batt"} do
      local n, u = t:match("^" .. lbl .. "%s+([%d%.]+)%s*(%a+)")
      if n then s[key] = mw(n, u) / 1000 hit = true end
    end
    local cn, cu, cp = t:match("^Components%s+([%d%.]+)%s*(%a+)%s*%(?(%d+)%%")
    if cn then s.sh_compw, s.sh_comp = mw(cn, cu), tonumber(cp) hit = true end
    local rn, ru = t:match("^Repair%s+([%d%.]+)%s*(%a+)")
    if rn then s.sh_repair = mw(rn, ru) hit = true end
    local bn, bu = t:match("^Battery Charge%s+([%d%.]+)%s*(%a+)")
    if bn then s.sh_bchg = mw(bn, bu) hit = true end
    -- pg <group>: one row per component (a name with an underscore, then numbers and the priority word)
    if t:match("^PGID") then pgwait = 1 return true end
    local cname, rest = t:match("^([%a]+_[%w_]+)%s+(.+)$")
    if cname and pgwait > 0 and pgwait <= 4 then
      local f = {}
      for w in rest:gmatch("%S+") do f[#f + 1] = w end
      s["pgc_n" .. pgwait] = cname
      for i, k in ipairs{"sh", "co", "pw", "pr", "rq", "un"} do if f[i] then s["pgc_" .. k .. pgwait] = f[i] end end
      pgwait = pgwait + 1
      hit = true
    end
    return hit
  end

  -- ------------------------------------------------------------------ widgets
  local function btn(parent, id, x, y, w, h, label, role, fn, size, font)
    local sc, S, T = E.sc(), E.S(), E.T
    local P = S.pal.normal
    local b = sc:button{parent = parent, id = id, x = x, y = y, w = w, h = h, r = E.R(math.min(h / 2, 14)), fill = P[role], text = label, color = S.btncolor or "#000000",
      size = (size or 18) * (S.tscale or 1), weight = S.weight or "700", align = "center", font = S.font, glow = 0.05}
    b:state("hover", {fill = E.lighten(P[role])}, {dur = 0.1})
    b:state("down", {scaleX = 0.96}, {dur = 0.06})
    E.T(role, b, true)
    b:on("click", fn)
    return b
  end
  M.btn = btn

  local function txt(parent, id, x, y, str, size, role, align, extra)
    local P = E.S().pal.normal
    return E.text(parent, id, x, y, str, size, P[role] or role, align, extra)
  end
  M.txt = txt

  -- a horizontal bar bound to an expression (0..max)
  local function bar(parent, id, x, y, w, h, expr, max, role, click, ox)
    local sc, S = E.sc(), E.S()
    local P = S.pal.normal
    local tr = sc:rect{parent = parent, id = id .. "t", x = x, y = y, w = w, h = h, r = E.R(h / 2), fill = "#0e151d", hit = click ~= nil}
    local f = sc:rect{parent = parent, id = id .. "f", x = x, y = y, w = 6, h = h, r = E.R(h / 2), fill = P[role], glow = 0.2}
    E.T(role, f)
    f:bind("w", "max(4, clamp(" .. expr .. ", 0, " .. max .. ") / " .. max .. " * " .. w .. ")", 0.8)
    if click then
      tr:state("hover", {fill = "#1a2733"}, {dur = 0.1})
      tr:on("click", function(_, e) click(math.max(0, math.min(1, (e.x - (x + (ox or 0))) / w))) end)
    end
    return f
  end
  M.bar = bar

  -- ------------------------------------------------------------------ panels
  -- st = {size = text size, row = row height, ox = scene x of the parent's origin (for sliders)}
  function M.teams(parent, id, x, y, w, st)
    local sc = E.sc()
    txt(parent, id .. "h", x, y, "DAMAGE CONTROL TEAMS", st.size + 4, "x")
    txt(parent, id .. "hh", x, y + st.row * 0.9, "TEAM   CREW   ASSIGNMENT", st.size - 2, "k")
    for i = 1, 5 do
      local ry = y + st.row * (i + 0.9)
      local sel = sc:rect{parent = parent, id = id .. "s" .. i, x = x - 6, y = ry - st.row * 0.45, w = w, h = st.row * 0.9, r = E.R(4), fill = E.S().pal.normal.p, opacity = 0, hit = true}
      sel:bind("opacity", "dc_sel == " .. i .. " ? 0.35 : 0", 0.25)
      sel:state("hover", {opacity = 0.2}, {dur = 0.1})
      sel:on("click", function() M.selectTeam(i) end)
      txt(parent, id .. "r" .. i, x, ry, "TEAM " .. i .. "     {dc_c" .. i .. "|%2d}     {dc_a" .. i .. "}", st.size, "s")
    end
    txt(parent, id .. "pe", x, y + st.row * 6.9, "{dc_sel > 0 ? \"TEAM SELECTED: NOW CLICK A SYSTEM\" : \"CLICK A TEAM, THEN A SYSTEM\"}", st.size - 2, "x")
  end

  function M.systems(parent, id, x, y, w, st)
    local sc = E.sc()
    txt(parent, id .. "h", x, y, "DAMAGE STATISTICS", st.size + 4, "x")
    local rows = {{M.SYSTEMS[1], "sh_dm_hull", 875, "%.2f", "HULL STATUS"}, {M.SYSTEMS[2], "sh_dm_port", 100, "%.1f", "PORT NACELLE"}, {M.SYSTEMS[3], "sh_dm_stbd", 100, "%.1f", "STARBOARD NACELLE"}}
    for i, r in ipairs(rows) do
      local ry = y + st.row * (i * 2.0 - 0.3)
      local hit = sc:rect{parent = parent, id = id .. "z" .. i, x = x - 6, y = ry - st.row * 0.5, w = w, h = st.row * 1.7, r = E.R(4), fill = E.S().pal.normal.q, opacity = 0.0, hit = true}
      hit:state("hover", {opacity = 0.3}, {dur = 0.1})
      hit:on("click", function() M.assign(r[1][1]) end)
      txt(parent, id .. "n" .. i, x, ry, r[5], st.size, "k")
      txt(parent, id .. "v" .. i, x + w - 12, ry, "<{" .. r[2] .. "|" .. r[4] .. "}/" .. r[3] .. ".0>", st.size, "s", "right")
      local f = bar(parent, id .. "b" .. i, x, ry + st.row * 0.5, w - 12, st.size * 0.6, r[2] .. " / " .. r[3] .. " * 100", 100, "k")
      f:bind("fill", "color(\"#ff4444\", \"#66cc88\", " .. r[2] .. " / " .. r[3] .. ")")
      txt(parent, id .. "t" .. i, x, ry + st.row * 1.2, "TEAMS: {(dc_a1 == \"" .. r[1][1] .. "\" ? 1 : 0) + (dc_a2 == \"" .. r[1][1] .. "\" ? 1 : 0) + (dc_a3 == \"" .. r[1][1] .. "\" ? 1 : 0) + (dc_a4 == \"" .. r[1][1] .. "\" ? 1 : 0) + (dc_a5 == \"" .. r[1][1] .. "\" ? 1 : 0)}   CLICK TO ASSIGN THE SELECTED TEAM", st.size - 3, "x")
    end
    txt(parent, id .. "cmd", x, y + st.row * 6.7, "{dc_pend}   {lc_hint}", st.size - 2, "r")
  end

  function M.dcbuttons(parent, id, x, y, st)
    btn(parent, id .. "1", x, y, st.bw or 190, st.bh or 40, "REFRESH: DMG STAT", "p", function() M.refreshDmg() end, st.size)
  end

  function M.powergroups(parent, id, x, y, w, st)
    local sc = E.sc()
    txt(parent, id .. "h", x, y, "POWER OVERVIEW", st.size + 4, "x")
    for i, g in ipairs(M.PG) do
      local ry = y + st.row * (i + 0.5)
      local sel = sc:rect{parent = parent, id = id .. "s" .. i, x = x - 6, y = ry - st.row * 0.5, w = w, h = st.row * 0.95, r = E.R(4), fill = E.S().pal.normal.p, opacity = 0, hit = true}
      sel:bind("opacity", "pg_sel == " .. i .. " ? 0.3 : 0", 0.25)
      sel:state("hover", {opacity = 0.18}, {dur = 0.1})
      sel:on("click", function() M.selectPG(i) end)
      txt(parent, id .. "n" .. i, x, ry, g[2] .. " (" .. i .. ")", st.size, "k")
      txt(parent, id .. "p" .. i, x + w * 0.62, ry, "{sh_pg_" .. g[1] .. "|%d}%", st.size, "s", "right")
      txt(parent, id .. "w" .. i, x + w - 10, ry, "{sh_w_" .. g[1] .. "|%.1f} MW", st.size, "s", "right")
      bar(parent, id .. "b" .. i, x, ry + st.row * 0.3, w - 12, 3, "sh_pg_" .. g[1], 100, i % 2 == 0 and "s" or "p")
    end
  end

  function M.pools(parent, id, x, y, w, st)
    txt(parent, id .. "h", x, y, "POWER POOLS", st.size + 2, "x")
    local rows = {
      {"MAIN", "{sh_main|%.2f} GW"}, {"AUX", "{sh_aux|%.2f} GW"}, {"BATTERY", "{sh_batt * 1000|%.0f} MW"}, {"TOTAL", "{sh_main + sh_aux + sh_batt|%.2f} GW"},
      {"COMP", "{sh_compw|%.0f} MW ({sh_comp|%d}%)"}, {"REPAIR", "{sh_repair|%.0f} MW"}, {"BATT CHG", "{sh_bchg|%.0f} MW"},
    }
    local per = st.cols and 4 or #rows       -- st.cols: two columns, the second one starting after four rows
    for i, r in ipairs(rows) do
      local col, line = math.floor((i - 1) / per), (i - 1) % per + 1
      local cx = x + col * (w / 2 + 10)
      local cw = st.cols and (w / 2 - 10) or w
      local ry = y + st.row * line
      txt(parent, id .. "l" .. i, cx, ry, r[1], st.size, i == 4 and "x" or "k")
      txt(parent, id .. "v" .. i, cx + cw, ry, r[2], st.size, i == 4 and "#ffffff" or "s", "right")
    end
  end

  function M.pgdetail(parent, id, x, y, w, st)
    local sc = E.sc()
    txt(parent, id .. "h", x, y, "{pg_name} POWER GROUP", st.size + 4, "x")
    local cols = {{0, "COMPONENT", "n", "left"}, {0.46, "SHR", "sh", "left"}, {0.56, "CON", "co", "left"}, {0.66, "PWR", "pw", "left"}, {0.78, "PRIO", "pr", "left"}, {0.92, "REQ", "rq", "left"}}
    for _, c in ipairs(cols) do txt(parent, id .. "hh" .. c[3], x + c[1] * w, y + st.row, c[2], st.size - 3, "k") end
    for i = 1, 4 do
      local ry = y + st.row * (i + 1)
      for _, c in ipairs(cols) do txt(parent, id .. "c" .. c[3] .. i, x + c[1] * w, ry, "{pgc_" .. c[3] .. i .. "}", st.size - 3, "s") end
    end
    local by = y + st.row * 6.2
    txt(parent, id .. "sl", x, by - st.row * 0.5, "SET {pg_name}:   POWER <GROUP>=<VALUE>", st.size - 2, "x")
    local bw = (w - 5 * 8) / 6
    for i, p in ipairs(M.PRESETS) do
      btn(parent, id .. "pr" .. i, x + (i - 1) * (bw + 8), by, bw, st.bh or 38, p[2], i == 6 and "r" or "p", function() M.setPG(p[1]) end, st.size)
    end
    txt(parent, id .. "slt", x, by + (st.bh or 38) + st.row * 0.5, "SLIDER: CLICK THE BAR TO SEND A PERCENTAGE", st.size - 3, "k")
    bar(parent, id .. "sb", x, by + (st.bh or 38) + st.row * 0.9, w, 14,
      "(pg_sel == 1 ? sh_pg_arrays : (pg_sel == 2 ? sh_pg_cloak : (pg_sel == 3 ? sh_pg_fuel : (pg_sel == 4 ? sh_pg_ops : (pg_sel == 5 ? sh_pg_shields : (pg_sel == 6 ? sh_pg_warp : sh_pg_weapons))))))",
      100, "x", function(frac) M.setPG(math.floor(frac * 100 + 0.5) .. "%") end, st.ox)
    local ey = by + (st.bh or 38) + st.row * 2.3
    txt(parent, id .. "eh", x, ey - st.row * 0.2, "GENERATORS:  ENG MAIN | ENG AUX | ENG EMERGENCY", st.size - 2, "x")
    local labels = {{"MAIN 100%", "eng main 100%"}, {"MAIN 50%", "eng main 50%"}, {"AUX 100%", "eng aux 100%"}, {"AUX 50%", "eng aux 50%"}, {"GEN STAT", "eng gen stat"}, {"EMERG", "eng emergency"}}
    for i, l in ipairs(labels) do
      btn(parent, id .. "e" .. i, x + (i - 1) * (bw + 8), ey + st.row * 0.6, bw, st.bh or 38, l[1], i >= 5 and "k" or "x", function() M.cmd(l[2]) end, st.size - 3)
    end
  end

  function M.opstat(parent, id, x, y, w, st)
    txt(parent, id .. "h", x, y, "VESSEL STATUS  (OP STAT)", st.size + 4, "x")
    local rows = {{"TRANSPONDER", "{op_tx}"}, {"TRANSPONDER CODE", "{op_code}"}, {"VESSEL NAME", "{op_name}"}, {"VESSEL CLASS", "{op_class}"}, {"VESSEL MASS", "{op_mass}"},
      {"VESSEL VISIBILITY", "{op_vis}"}, {"HATCH STATUS", "{op_hatch}"}, {"CAN LAND", "{op_land}"}, {"CAN LAUNCH", "{op_launch}"}, {"DOCKING DOORS", "{op_dock}"}}
    for i, r in ipairs(rows) do
      local ry = y + st.row * i
      txt(parent, id .. "l" .. i, x, ry, r[1], st.size, "k")
      txt(parent, id .. "v" .. i, x + w, ry, r[2], st.size, "s", "right")
    end
    local by = y + st.row * 11.2
    local bw = (w - 16) / 3
    local function pos(i) if st.stack then return x, by + (i - 1) * ((st.bh or 38) + 6), w end return x + (i - 1) * (bw + 8), by, bw end
    local x1, y1, w1 = pos(1)
    btn(parent, id .. "b1", x1, y1, w1, st.bh or 38, "REFRESH: OP STAT", "p", function() M.cmd("op stat") end, st.size - 2)
    x1, y1, w1 = pos(2)
    btn(parent, id .. "b2", x1, y1, w1, st.bh or 38, "HATCH", "x", function() M.cmd("hatch") end, st.size - 2)
    x1, y1, w1 = pos(3)
    btn(parent, id .. "b3", x1, y1, w1, st.bh or 38, "DOCK DOORS", "k", function() M.cmd("dd " .. ((E.sim().ship.op_dock == "Open") and "close" or "open")) end, st.size - 2)
    txt(parent, id .. "hint", x, by + (st.stack and 3 or 1) * ((st.bh or 38) + 6) + st.row * 0.3, "SENDS: OP STAT | HATCH | DD OPEN/CLOSE   {lc_hint}", st.size - 3, "r")
  end

  function M.tractor(parent, id, x, y, w, st)
    txt(parent, id .. "h", x, y, "TRACTOR BEAM", st.size + 4, "x")
    txt(parent, id .. "t1", x, y + st.row, "TARGET   {lc_lock > 0 ? lc_ln : \"NONE - LOCK ONE ON SENSORS\"}", st.size, "s")
    txt(parent, id .. "t2", x, y + st.row * 2, "ROOM     {tr_room}", st.size, "s")
    txt(parent, id .. "t3", x, y + st.row * 3, "STATUS   {tr_state}", st.size, "s")
    local bw = (w - 16) / 3
    btn(parent, id .. "lk", x, y + st.row * 4, bw, st.bh or 38, "LOCK", "p", function()
      local s = E.sim()
      if s.lock == 0 then s.ship.lc_hint = "LOCK A CONTACT ON SENSORS FIRST" E.push() return end
      M.cmd("tractor lock " .. s.lock)
    end, st.size - 2)
    btn(parent, id .. "rm-", x + bw + 8, y + st.row * 4, bw / 2 - 4, st.bh or 38, "-", "k", function() local s = E.sim().ship s.tr_room = math.max(1, s.tr_room - 1) E.push() end, st.size)
    btn(parent, id .. "rm+", x + bw + 8 + bw / 2 + 4, y + st.row * 4, bw / 2 - 4, st.bh or 38, "+", "k", function() local s = E.sim().ship s.tr_room = s.tr_room + 1 E.push() end, st.size)
    btn(parent, id .. "ds", x + 2 * (bw + 8), y + st.row * 4, bw, st.bh or 38, "DEST", "x", function() M.cmd("tractor dest " .. E.sim().ship.tr_room) end, st.size - 2)
    btn(parent, id .. "en", x, y + st.row * 5.3, bw, st.bh or 38, "ENGAGE", "r", function() M.cmd("tractor engage") end, st.size - 2)
    btn(parent, id .. "rs", x + bw + 8, y + st.row * 5.3, bw, st.bh or 38, "RESET", "s", function() M.cmd("tractor reset") end, st.size - 2)
    btn(parent, id .. "st", x + 2 * (bw + 8), y + st.row * 5.3, bw, st.bh or 38, "STATUS", "k", function() M.cmd("tractor stat") end, st.size - 2)
    txt(parent, id .. "hint", x, y + st.row * 6.9, "TRACTOR LOCK/DEST/ENGAGE/RESET/STAT", st.size - 3, "k")
  end

  function M.scans(parent, id, x, y, w, st)
    local names = {{"SRS", "srs"}, {"LRS", "lrs"}, {"PASSIVE", "passive"}, {"DOCKSCAN", "dockscan"}, {"INTERNAL", "internal"}}
    local bw = (w - 4 * 8) / 5
    for i, n in ipairs(names) do
      btn(parent, id .. i, x + (i - 1) * (bw + 8), y, bw, st.bh or 38, n[1], i <= 2 and "p" or "x", function()
        local s = E.sim()
        if i > 2 then
          if s.lock == 0 then s.ship.lc_hint = "LOCK A CONTACT FIRST (CLICK A ROW)" E.push() return end
          M.cmd(n[2] .. " " .. s.lock)
        else M.cmd(n[2]) end
      end, st.size - 2)
    end
    if st.nohint then return end
    txt(parent, id .. "h", x, y + (st.bh or 38) + st.row * 0.5, "SCANS SEND: SRS | LRS | PASSIVE / DOCKSCAN / INTERNAL <LOCKED CONTACT>   {lc_hint}", st.size - 4, "k")
  end

  function M.fuel(parent, id, x, y, w, st)
    local sc = E.sc()
    local P = E.S().pal.normal
    txt(parent, id .. "h", x, y, "FUEL STATUS", st.size + 4, "x")
    local tanks = {{"DEUTERIUM", "sh_deut", 500000, "#66aaff"}, {"ANTIMATTER", "sh_anti", 300000, "#ff77cc"}}
    for i, t in ipairs(tanks) do
      local ty = y + st.row * (i * 1.8)
      txt(parent, id .. "n" .. i, x, ty, t[1], st.size, "k")
      txt(parent, id .. "v" .. i, x + w, ty, "{" .. t[2] .. "|%.0f} / " .. t[3], st.size, "s", "right")
      sc:rect{parent = parent, id = id .. "t" .. i, x = x, y = ty + st.row * 0.5, w = w, h = st.size * 0.8, r = E.R(8), fill = "#0a0e12", stroke = P.p, strokeWidth = 2}
      local f = sc:rect{parent = parent, id = id .. "f" .. i, x = x + 3, y = ty + st.row * 0.5 + 3, w = 6, h = st.size * 0.8 - 6, r = E.R(6), fill = t[4], glow = 0.4}
      f:bind("w", "max(4, " .. t[2] .. " / " .. t[3] .. " * " .. (w - 6) .. ")", 0.8)
    end
    btn(parent, id .. "b", x, y + st.row * 5.6, w * 0.5, st.bh or 38, "FUEL STAT", "p", function() M.cmd("fuel stat") end, st.size - 2)
  end

  return M
end
