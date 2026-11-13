---
title: Lua scripting
order: 9
keywords: lua, squat, plugins, gopher-lua, scripting, api
aliases: lua, plugins, plugin, squat
---

SquatClient embeds Lua 5.1 as a sandboxed second scripting language alongside [the TinyFugue-style language](help:scripting). Use Lua for larger, structured plugins and TF for quick triggers and for scripts you already have; the two can call each other.

Everything lives in the global table `squat`. Plugins are `.lua` files in the `plugins` folder of the SquatClient scripts directory and are loaded at start. Type `/reload` to reload them. You can also try code directly:

```
/lua squat.echo("hello from Lua")
```

The following pages are the full reference of the `squat.*` API.
