// Package gfxext registers the graphics commands with the TinyFugue engine (gtfparser.Extension).
//
// The commands are named _gfx and _canvas: the standard library (lib/squat) wraps them as /gfx and /canvas.
// Load the extension into any interpreter built on the shared engine:
//
//	in.Load(gfxext.Extension(hub))
//
// The daemon's tfengine does not yet offer a hook for client extensions, so the desktop app reaches the same Hub
// through /notify (see internal/app/gfxbridge.go); both routes end in Hub.Exec.
package gfxext

import (
	"github.com/itsnotyoutoday/gtfparser"

	"github.com/itsnotyoutoday/squatclient/internal/gfx"
)

// Extension returns the command table for a hub.
func Extension(h *gfx.Hub) gtfparser.Extension {
	run := func(cmd string) func(*gtfparser.Call) gtfparser.Value {
		return func(c *gtfparser.Call) gtfparser.Value {
			if err := h.Exec(cmd, c.Raw); err != nil {
				return c.Fail("%v", err)
			}
			return gtfparser.Int(1)
		}
	}
	return gtfparser.Extension{
		Name: "squatgfx",
		Commands: []gtfparser.CommandSpec{
			{Name: "_gfx", Category: "graphics", Usage: "subcommand [args]", Help: "the retained-mode graphics language (docs/GFX.md); scripts call /gfx", Do: run("gfx")},
			{Name: "_canvas", Category: "graphics", Usage: "subcommand NAME [args]", Help: "pixel-art canvases of the terminal client's /canvas family", Do: run("canvas")},
		},
	}
}
