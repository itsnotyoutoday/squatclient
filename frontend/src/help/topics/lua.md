---
title: Lua scripting
order: 9
keywords: lua, squat, plugins, scripting, api
aliases: lua, plugins, plugin, squat
---

SquatClient includes **Lua 5.1** as a second scripting language next to [the TinyFugue-style language](help:scripting). Use Lua for larger, more structured plugins and the TinyFugue-style language for quick triggers and for scripts you already have. The two can call each other.

Lua runs in a sandbox: it cannot read your files or run programs, and a plugin that runs too long is stopped without freezing the client.

## Try it

Everything is in a table called `squat`. Type Lua straight onto the input line with `/lua`:

```
/lua squat.echo("hello from Lua")
```

## Plugins

Plugins are `.lua` files in the `plugins` folder inside the SquatClient configuration folder (for example `~/Library/Application Support/SquatClient/plugins` on macOS). They load when the app starts. Type `/reload` to reload them after changing one.

A first plugin that answers a greeting:

```lua
squat.trigger{
  match = "* says, \"hello\"",
  fn = function(m) squat.send("say Hello, " .. m[1] .. "!") end,
}
```

## The reference

The pages below this one describe every `squat` function. Use `/help squat.on` or any other name to jump to it.

## What next

- [The scripting language](help:scripting) for quick triggers.
- [Commands](help:commands) for `/lua`, `/load` and `/reload`.
