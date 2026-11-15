-- gfx.lua: the retained-mode graphics language (docs/GFX.md) for Lua plugins.
--
--   local gfx = require("gfx")
--   local sc = gfx.scene("main", {w = 1280, h = 720, bg = "#000"})   -- opens the scene
--   local r = sc:rect{id = "bar", x = 10, y = 10, w = 200, h = 40, r = 20, fill = "#ff9900"}
--   r:animate{x = 300, dur = 0.5, ease = "outCubic"}
--   r:bind("w", "lc_hull * 2")              -- renderer-side data binding on a variable
--   r:on("click", function(obj, e) squat.echo("clicked " .. obj.id) end)
--   gfx.vars{lc_hull = 80}
--
-- It is a thin layer over the /gfx command: every call becomes one line for squat.tf, which the TinyFugue engine
-- hands to the renderer, so Lua and TF scripts share scenes and variables (a TF macro can /gfx set an object a Lua
-- plugin made). Animation, shaders, particles and bindings run in the renderer at display rate: set the scene up
-- and update it on events, do not redraw per frame from a timer.

local M = {}

local handlers = {}   -- "scene\0id\0event" -> {obj, fn}
local nextId = 0

-- ------------------------------------------------------------------ encoding
local function jsonString(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    local map = {['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\t'] = '\\t', ['\r'] = '\\r'}
    return map[c] or string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function isArray(t)
  local n = 0
  for _ in pairs(t) do n = n + 1 end
  return n == #t
end

local function json(v)
  local ty = type(v)
  if ty == "number" then return tostring(v)
  elseif ty == "boolean" then return tostring(v)
  elseif ty == "string" then return jsonString(v)
  elseif ty == "table" then
    local out = {}
    if isArray(v) then
      for i = 1, #v do out[i] = json(v[i]) end
      return "[" .. table.concat(out, ",") .. "]"
    end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = tostring(k) end
    table.sort(keys)
    for _, k in ipairs(keys) do out[#out + 1] = jsonString(k) .. ":" .. json(v[k]) end
    return "{" .. table.concat(out, ",") .. "}"
  end
  return "null"
end

local function numlist(t)
  for i = 1, #t do if type(t[i]) ~= "number" then return nil end end
  local s = {}
  for i = 1, #t do s[i] = tostring(t[i]) end
  return table.concat(s, ",")
end

-- one key=value word for /gfx
local function word(key, v)
  local ty = type(v)
  if ty == "number" or ty == "boolean" then return key .. "=" .. tostring(v) end
  if ty == "table" then
    if (key == "shadow" or key == "u") and not isArray(v) then
      local parts = {}
      local ks = {}
      for k in pairs(v) do ks[#ks + 1] = k end
      table.sort(ks)
      for _, k in ipairs(ks) do parts[#parts + 1] = word(key .. "." .. k, v[k]) end
      return table.concat(parts, " ")
    end
    local nl = isArray(v) and numlist(v)
    if nl then return key .. "=" .. nl end
    return key .. "=" .. '"' .. json(v):gsub('\\', '\\\\'):gsub('"', '\\"') .. '"'
  end
  -- strings: double-quoted, with the escapes /gfx understands
  local s = tostring(v):gsub('\\', '\\\\'):gsub('"', '\\"'):gsub("\n", "\\n")
  return key .. '="' .. s .. '"'
end

local function props(t, skip)
  local keys, out = {}, {}
  for k in pairs(t) do
    if type(k) == "string" and not (skip and skip[k]) then keys[#keys + 1] = k end
  end
  table.sort(keys)
  for _, k in ipairs(keys) do out[#out + 1] = word(k, t[k]) end
  return table.concat(out, " ")
end

local failures, disabled, gaveUp = 0, false, false

-- The failure limit only exists to stop a flood from a broken setup. An explicit user command (/lcars, /gfxdemo) starts
-- fresh: reset() clears it.
function M.reset() failures, disabled, gaveUp = 0, false, false end

-- Makes sure the TF side (gfx.tf: the /gfx and /canvas wrappers) is loaded. It is part of SquatClient's standard
-- library, but SQUATCLIENT_TFLIB (another library) or a startup file may have replaced that. Call it from user commands.
function M.ensure()
  M.reset()
  local ok = squat.tf("/require -q gfx.tf")
  if not ok then
    disabled = true
    squat.echo("gfx: the graphics commands are not available (gfx.tf could not be loaded). Is SQUATCLIENT_TFLIB set to another library?")
    return false
  end
  return true
end

local function run(line)
  if disabled then return false end
  local ok, err = squat.tf(line)
  if ok then
    failures = 0
    return true
  end
  failures = failures + 1
  squat.log("gfx: " .. tostring(err) .. " (" .. line .. ")", "warn")
  if failures >= 5 then -- a broken setup must not flood the log and the window with hundreds of errors
    disabled = true
    if not gaveUp then
      gaveUp = true
      squat.echo("gfx: too many failed graphics commands, giving up until the next /lcars or /gfxdemo (see the log).")
    end
  end
  return false
end

-- ------------------------------------------------------------------ objects
local Obj = {}
Obj.__index = Obj

local function select(scene) return run("/gfx scene " .. scene.id) end

local function key(o, ev) return o.scene.id .. "\0" .. o.id .. "\0" .. ev end

function Obj:set(t)
  select(self.scene)
  run("/gfx set " .. self.id .. " " .. props(t))
  return self
end

-- animate{x = 100, y = {from = 0, to = 50}, dur = 0.5, ease = "outCubic", delay = 0, loop = "inf", yoyo = true, name = "n", after = "m"}
function Obj:animate(t)
  select(self.scene)
  local words, special = {}, {dur = true, ease = true, delay = true, loop = true, yoyo = true, name = true, after = true}
  local ks = {}
  for k in pairs(t) do ks[#ks + 1] = k end
  table.sort(ks)
  for _, k in ipairs(ks) do
    local v = t[k]
    if special[k] then
      if k == "yoyo" then
        if v then words[#words + 1] = "yoyo" end
      else
        words[#words + 1] = k .. "=" .. tostring(v)
      end
    elseif type(v) == "table" and v.to ~= nil then
      words[#words + 1] = k .. "=" .. tostring(v.from or "") .. ".." .. tostring(v.to)
      if v.from == nil then words[#words] = k .. "=" .. tostring(v.to) end
    else
      words[#words + 1] = k .. "=" .. tostring(v)
    end
  end
  run("/gfx anim " .. self.id .. " " .. table.concat(words, " "))
  return self
end

function Obj:stop() select(self.scene); run("/gfx stop " .. self.id); return self end

-- bind(prop, expr [, smoothSeconds]): the renderer re-evaluates expr when a variable it reads changes
function Obj:bind(prop, expr, smooth)
  select(self.scene)
  run("/gfx bind " .. self.id .. " " .. prop .. " " .. expr .. (smooth and (" smooth=" .. smooth) or ""))
  return self
end

function Obj:unbind(prop) select(self.scene); run("/gfx unbind " .. self.id .. " " .. prop); return self end

-- state("hover", {fill = "#fff", scaleX = 1.05}, {dur = 0.12})
function Obj:state(name, t, opt)
  select(self.scene)
  run("/gfx state " .. self.id .. " " .. name .. " " .. props(t) .. (opt and opt.dur and (" dur=" .. opt.dur) or ""))
  return self
end

-- on("click", function(obj, e) ... end); events: click down up enter leave
function Obj:on(event, fn)
  select(self.scene)
  handlers[key(self, event)] = {obj = self, fn = fn}
  run("/gfx on " .. self.id .. " " .. event .. " /_gfxev " .. self.scene.id .. " " .. self.id .. " " .. event .. " $x $y")
  return self
end

function Obj:off(event)
  handlers[key(self, event)] = nil
  select(self.scene)
  run("/gfx off " .. self.id .. " " .. event)
  return self
end

function Obj:show() return self:set{visible = true} end
function Obj:hide() return self:set{visible = false} end
function Obj:delete()
  select(self.scene)
  run("/gfx del " .. self.id)
  self.scene.objects[self.id] = nil
end

-- ------------------------------------------------------------------ scenes
local Scene = {}
Scene.__index = Scene

local TYPES = {"group", "layer", "rect", "circle", "ellipse", "arc", "elbow", "line", "polyline", "polygon", "path", "text",
  "image", "button", "planet", "starfield", "emitter", "shader", "radar", "graph"}

for _, ty in ipairs(TYPES) do
  -- scene:rect{id = "x", parent = obj_or_id, ...}   (id optional: one is made up)
  Scene[ty] = function(self, t)
    t = t or {}
    local id = t.id
    if not id then
      nextId = nextId + 1
      id = ty .. nextId
    end
    local parent = t.parent
    if type(parent) == "table" then parent = parent.id end
    select(self)
    local line = "/gfx new " .. ty .. " " .. id .. " " .. props(t, {id = true, parent = true})
    if parent then line = line .. " parent=" .. parent end
    run(line)
    local o = setmetatable({id = id, scene = self, type = ty}, Obj)
    self.objects[id] = o
    return o
  end
end

function Scene:get(id) return self.objects[id] end
function Scene:open(t) run("/gfx open " .. self.id .. " " .. props(t or {})); return self end
function Scene:close() run("/gfx close " .. self.id) end

-- scene:on_close(fn): the window closed the scene (close button, Escape); fn() runs
function Scene:on_close(fn)
  select(self)
  handlers[self.id .. "\0#scene\0close"] = {obj = self, fn = function() fn() end}
  run("/gfx on #scene close /_gfxev " .. self.id .. " #scene close $x $y")
end
function Scene:clear() select(self); run("/gfx clear " .. self.id); self.objects = {} end
function Scene:bloom(strength, radius) select(self); run("/gfx bloom " .. strength .. " " .. (radius or 1)) end

-- scene:timeline("intro", {loop = 0}, {{at = 0.5, anim = {obj = o, x = 10, dur = 1}}, {at = 2, set = {obj = o, fill = "#f00"}}})
function Scene:timeline(name, opt, steps)
  select(self)
  run("/gfx timeline " .. name .. " " .. props(opt or {}))
  for _, st in ipairs(steps or {}) do
    if st.anim then
      local a = st.anim
      local words = {}
      for k, v in pairs(a) do if k ~= "obj" then words[#words + 1] = k .. "=" .. tostring(v) end end
      table.sort(words)
      run("/gfx at " .. name .. " " .. st.at .. " anim " .. a.obj.id .. " " .. table.concat(words, " "))
    elseif st.set then
      local a = st.set
      run("/gfx at " .. name .. " " .. st.at .. " set " .. a.obj.id .. " " .. props(a, {obj = true}))
    end
  end
  return self
end
function Scene:play(name) select(self); run("/gfx play " .. name) end

local scenes = {}

-- gfx.scene(id [, {w=, h=, bg=, dock=, margin={t,r,b,l}, fit=, bloom=}]): creates (or returns) a scene and opens it
function M.scene(id, opt)
  local s = scenes[id]
  if not s then
    s = setmetatable({id = id, objects = {}}, Scene)
    scenes[id] = s
  end
  if opt then
    local o = {}
    for k, v in pairs(opt) do o[k] = v end
    if type(o.margin) == "table" then o.margin = table.concat(o.margin, ",") end
    s:open(o)
  end
  return s
end

-- variables the renderer's bindings read (the Lua twin of /gfx var)
function M.vars(t)
  local words = {}
  for k, v in pairs(t) do words[#words + 1] = word(k, v) end
  table.sort(words)
  -- /gfx vars takes key=value words; keep lines short
  local i = 1
  while i <= #words do
    local chunk = {}
    for j = i, math.min(i + 11, #words) do chunk[#chunk + 1] = words[j] end
    run("/gfx vars " .. table.concat(chunk, " "))
    i = i + 12
  end
end
function M.var(name, v) M.vars{[name] = v} end

-- gfx.shader{name = "pulse", uniform = {uK = "float"}, src = "vec4 shade(vec2 uv, vec2 px) { ... }"}
function M.shader(t)
  local u = {}
  for k, ty in pairs(t.uniform or {}) do u[#u + 1] = k .. ":" .. ty end
  table.sort(u)
  local src = tostring(t.src):gsub("\n", "\\n")
  run("/gfx shader " .. t.name .. ' src="' .. src:gsub('"', '\\"') .. '"' .. (#u > 0 and (" uniform=" .. table.concat(u, ",")) or ""))
end

function M.font(name, file, weight) run("/gfx font " .. name .. " " .. file .. (weight and (" weight=" .. weight) or "")) end

-- Pointer events arrive as the TF command /_gfxev scene id event x y (what /gfx on runs); this alias dispatches them.
function M.install()
  M.ensure_on_use = true
  squat.alias{match = "^/_gfxev (\\S+) (\\S+) (\\S+) (-?\\d+) (-?\\d+)$", regex = true, priority = 1000, fn = function(m)
    local h = handlers[m[1] .. "\0" .. m[2] .. "\0" .. m[3]]
    if not h then return false end   -- not ours: another plugin's copy of this module may own the object
    h.fn(h.obj, {event = m[3], x = tonumber(m[4]), y = tonumber(m[5])})
  end}
end

M.json = json
return M
