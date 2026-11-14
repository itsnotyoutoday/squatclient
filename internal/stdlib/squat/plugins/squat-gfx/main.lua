-- squat-gfx: the Lua graphics module (require "gfx") and the LCARS demo (/lcars).
require("gfx").install()
require("lcars")

-- /gfxdemo also works when another standard library replaced SquatClient's (see gfx.ensure)
squat.alias{match = "^/gfxdemo(?: (.*))?$", regex = true, fn = function(m)
  if not require("gfx").ensure() then return end
  squat.tf("/load -q gfxdemo.tf")
  squat.tf("/gfxdemo_run " .. (m[1] or ""))
end}
