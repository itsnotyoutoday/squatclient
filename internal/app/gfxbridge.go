package app

import (
	"errors"
	"strings"

	"github.com/itsnotyoutoday/squatclient/internal/gfx"
)

// The graphics commands (docs/GFX.md) are wrapped by the standard library (lib/squat/gfx.tf) as TF macros that
// call /notify with a reserved title. The daemon's TF engine has no hook for client commands yet, but it hands
// /notify to Options.Notify, which is ours; internal/gfx/gfxext registers the same commands natively for hosts
// that can load an engine extension.
const (
	notifyGfx    = "@gfx"
	notifyCanvas = "@canvas"
	notifyUI     = "@ui"
)

// uiDialogs are the windows /worlds, /settings ... may open (EngineEvents "dialog").
var uiDialogs = map[string]bool{"worlds": true, "quick": true, "settings": true, "layouts": true, "history": true,
	"about": true, "squatters": true, "help": true, "gfx": true}

// Gfx returns the graphics hub (tests, the standalone dev page recorder).
func (s *Service) Gfx() *gfx.Hub { return s.gfx }

func (s *Service) newGfx(libDirs ...string) *gfx.Hub {
	h := gfx.New()
	h.Dirs = libDirs
	h.Emit = func(ops []gfx.Op) { s.emit("gfx", ops) }
	h.Notice = func(level, text string) { s.emit("notice", Notice{Level: level, Text: text}) }
	h.Echo = func(line string) { s.emit("notice", Notice{Level: "info", Text: line}) }
	h.Run = func(line string) error {
		id := s.eng.Foreground()
		if id == "" {
			if ss := s.eng.Sessions(); len(ss) > 0 {
				id = ss[0].ID
			}
		}
		if id == "" {
			return errors.New("gfx: a button ran a command but no session is open to run it in")
		}
		return s.eng.Input(id, line)
	}
	return h
}

// notify is the engine's Notify hook: reserved titles carry graphics and UI commands, everything else is the
// engine's default (an info notice).
func (s *Service) notify(title, body string) {
	switch title {
	case notifyGfx:
		s.gfx.Handle("gfx", body)
	case notifyCanvas:
		s.gfx.Handle("canvas", body)
	case notifyUI:
		name := strings.TrimSpace(body)
		if !uiDialogs[name] {
			s.emit("notice", Notice{Level: "error", Text: "unknown window " + name})
			return
		}
		s.emit("dialog", map[string]string{"name": name})
	default:
		s.emit("notice", Notice{Level: "info", Text: title + ": " + body})
	}
}

// GfxSnapshot returns every open scene as scene operations; a window that mounts after the script ran asks for it.
func (s *Service) GfxSnapshot() []gfx.Op { return s.gfx.Snapshot() }

// GfxEvent reports a pointer event on a graphics object; the command the script attached with /gfx on runs.
func (s *Service) GfxEvent(scene, id, event string, x, y float64) error {
	err := s.gfx.Event(scene, id, event, x, y)
	if err != nil {
		s.emit("notice", Notice{Level: "error", Text: err.Error()})
	}
	return err
}
