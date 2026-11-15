-- TOS: a 1960s bridge console: grey panels with rivets, chunky rounded push-buttons in primary colours, rows of lamps that
-- blink in stepped patterns, toggle switches, big round dials with swinging needles, a flat CRT viewscreen (scan lines,
-- flicker, film grain). Own artwork; type is Orbitron (SIL OFL).
return function(E)
  local L, gfx = E.L, E.gfx
  local function lamps(sc, S, T, x, y, cols, rows, gap, seed)
    local P = S.pal.normal
    local roles = {"p", "s", "q", "t", "r"}
    for r = 0, rows - 1 do
      for c = 0, cols - 1 do
        local k = (r * cols + c + seed) % #roles + 1
        local id = string.format("lamp%d_%d_%d", seed, r, c)
        local o = T(roles[k], sc:rect{id = id, x = x + c * gap, y = y + r * gap, w = gap - 6, h = gap - 6, r = 5, fill = P[roles[k]], stroke = "#111", strokeWidth = 2})
        if (r * 7 + c * 3 + seed) % 3 ~= 0 then -- stepped blink, no smooth glow
          o:animate{opacity = {from = 1, to = 0.18}, dur = 0.4 + ((r * 5 + c * 3 + seed) % 7) * 0.23, ease = "steps(1)", loop = "inf", yoyo = true, delay = ((r + c * 2) % 5) * 0.31}
        end
      end
    end
  end
  local function toggle(sc, S, id, x, y)
    sc:rect{id = id .. "b", x = x, y = y, w = 22, h = 40, r = 6, fill = "#15181b", stroke = "#555a60", strokeWidth = 2}
    sc:rect{id = id .. "l", x = x + 6, y = y + 4, w = 10, h = 22, r = 4, fill = S.pal.normal.x}
  end
  local function dial(sc, S, T, id, x, y, r, var, role)
    local P = S.pal.normal
    sc:circle{id = id .. "f", x = x, y = y, r = r + 8, fill = "#1a1d20", stroke = "#6c7178", strokeWidth = 4}
    sc:arc{id = id .. "a", x = x, y = y, r0 = r - 8, r1 = r, a0 = 225, a1 = 495, fill = "#2a2e32"}
    T(role, sc:arc{id = id .. "g", x = x, y = y, r0 = r - 8, r1 = r, a0 = 225, a1 = 330, fill = P[role]})
    local g = sc:get(id .. "g")
    g:bind("a1", "225 + 270 * clamp(" .. var .. ", 0, 100) / 100", 0.6)
    -- the needle swings (a damped step toward the value, like a mechanical meter)
    local n = sc:line{id = id .. "n", x1 = x, y1 = y, x2 = x, y2 = y - r + 4, strokeWidth = 4, stroke = "#f5f1e6", rotation = 0}
    sc:get(id .. "n"):set{x = x, y = y, pivotX = x, pivotY = y}   -- x,y is where the pivot lands: rotate about the hub
    n:bind("rotation", "-135 + 270 * clamp(" .. var .. ", 0, 100) / 100", 0.7)
    sc:circle{id = id .. "c", x = x, y = y, r = 7, fill = "#f5f1e6"}
  end
  local function frame()
    local sc, S, T, text = E.sc(), E.S(), E.T, E.text
    local P = S.pal.normal
    -- grey bezel bands top and bottom, riveted
    T("t", sc:rect{id = "bandtop", x = 14, y = 10, w = 1572, h = 92, r = 18, fill = P.t, stroke = "#14161a", strokeWidth = 4})
    T("t", sc:rect{id = "bandbot", x = 236, y = 826, w = 1350, h = 64, r = 18, fill = P.t, stroke = "#14161a", strokeWidth = 4})
    T("t", sc:rect{id = "bandleft", x = 14, y = 110, w = 214, h = 780, r = 18, fill = P.t, stroke = "#14161a", strokeWidth = 4})
    for i = 0, 22 do
      sc:circle{id = "rv" .. i, x = 30 + i * 70, y = 22, r = 4, fill = "#9aa0a6", stroke = "#3a3e43", strokeWidth = 1}
    end
    lamps(sc, S, T, 250, 28, 14, 2, 30, 1)           -- top lamp rows
    text(nil, "tt1", 700, 54, "BRIDGE  -  {lc_mode|upper}", 34, P.x, "left", {glow = 0})
    text(nil, "tt2", 1570, 54, "STARDATE {lc_sd|%.1f}", 28, P.k, "right")
    lamps(sc, S, T, 250, 836, 8, 1, 30, 2)
    text(nil, "tb1", 520, 858, "HULL {lc_hull|%d}   CORE {lc_core|%d}   LOCK {lc_lock}   {lc_alert == \"red\" ? \"RED ALERT\" : \"ALL STATIONS NORMAL\"}", 24, P.x, "left")
    -- left column: dials and toggle switches
    dial(sc, S, T, "d1", 70, 600, 42, "lc_core", "q")
    dial(sc, S, T, "d2", 168, 600, 42, "lc_hull", "q")
    dial(sc, S, T, "d3", 70, 700, 42, "lc_pw_shields", "s")
    dial(sc, S, T, "d4", 168, 700, 42, "lc_pw_warp", "p")
    for i = 0, 3 do toggle(sc, S, "tg" .. i, 38 + i * 48, 770) end
    E.port{role = "x", r = 10, width = 4, glow = 0}
  end
  local function nav()
    local sc, S = E.sc(), E.S()
    E.navbtns({{"SENSORS", "sens", "p"}, {"ENGINEER", "eng", "s"}, {"WEAPONS", "tac", "q"}, {"SHIP", "ship", "r"}}, {x = 26, y = 130, w = 190, h = 58, dy = 76, r = 14, size = 24, color = "#f5f1e6"})
    for i = 1, 4 do sc:get("nav" .. i):set{stroke = "#14161a", strokeWidth = 4} end
    E.logbtn{x = 26, y = 440, w = 190, h = 54, r = 14, role = "x", size = 22, color = "#111", shrink = "LOG: SMALL", expand = "LOG: LARGE"}
  end
  local function decor(name, parent)
    local sc, S = E.sc(), E.S()
    if name == "sens" then -- CRT over the flat viewscreen
      sc:shader{parent = sc:get("vsg"), id = "crt", w = 800, h = 420, shader = "crt", u = {uK = 1.0}}
    end
  end
  E.register{
    name = "tos", font = "Orbitron", weight = "700", sharp = false, bloom = 0.15, decor = decor, tscale = 0.78,
    fonts = {{"Orbitron", "fonts/Orbitron-VF.ttf", "400 900"}},
    pal = {
      normal = {p = "#e8372c", s = "#f2c230", t = "#34393e", q = "#2f6fd6", x = "#f5f1e6", r = "#2aa75b", k = "#9fd0ff", bg = "#1e2125"},
      red    = {p = "#ff2a1f", s = "#ff8a00", t = "#3a2a2a", q = "#b3202a", x = "#ffd9d0", r = "#ff5a2a", k = "#ffb0a0", bg = "#2a1a1a"},
    },
    alertEdge = "#ff2a1f", frame = frame, nav = nav,
  }
end
