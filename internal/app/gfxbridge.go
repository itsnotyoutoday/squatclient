package app

import (
	"errors"
	"fmt"
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

// Graphics belong to a session: a scene is drawn only while the session that opened it is in front, each session keeps its own
// scenes, state and variables, and closing a session discards them. Every session has its own gfx.Hub; the operations the
// window receives carry "session" (the session id), and pointer events come back as "<session>/<scene>".

// Gfx returns a session's graphics hub (tests, the standalone dev page recorder); the hub is made on first use.
func (s *Service) Gfx(session string) *gfx.Hub { return s.hubFor(session) }

func (s *Service) hubFor(session string) *gfx.Hub {
	s.gfxMu.Lock()
	defer s.gfxMu.Unlock()
	if h, ok := s.gfxHubs[session]; ok {
		return h
	}
	h := gfx.New()
	h.Dirs = s.gfxDirs
	h.Emit = func(ops []gfx.Op) {
		for _, o := range ops {
			o["session"] = session
		}
		s.emit("gfx", ops)
	}
	h.Notice = func(level, text string) { s.emit("notice", Notice{Level: level, Text: text, Session: session}) }
	h.Echo = func(line string) { s.emit("notice", Notice{Level: "info", Text: line, Session: session}) }
	h.Run = func(line string) error {
		if session == "" {
			return errors.New("gfx: a button ran a command but no session is open to run it in")
		}
		return s.eng.Input(session, line) // the command runs in the session that owns the scene
	}
	if s.gfxHubs == nil {
		s.gfxHubs = map[string]*gfx.Hub{}
	}
	s.gfxHubs[session] = h
	return h
}

// dropGfx discards a closed session's scenes.
func (s *Service) dropGfx(session string) {
	s.gfxMu.Lock()
	delete(s.gfxHubs, session)
	s.gfxMu.Unlock()
}

// sessionForWorld maps the script name of a world (what ${world_name} is in TF) to its session. Script names are the world
// name, with "#2", "#3" ... for further sessions of the same world, in the order they were opened. "" or an unknown name is
// the foreground session.
func (s *Service) sessionForWorld(world string) string {
	if world != "" {
		taken := map[string]bool{}
		for _, si := range s.eng.Sessions() {
			name := si.Name
			for n := 2; taken[name]; n++ {
				name = fmt.Sprintf("%s#%d", si.Name, n)
			}
			taken[name] = true
			if name == world || si.ID == world {
				return si.ID
			}
		}
	}
	return s.eng.Foreground()
}

// notify is the engine's Notify hook: reserved titles carry graphics and UI commands, everything else is the
// engine's default (an info notice).
func (s *Service) notify(title, body string) {
	switch title {
	case notifyGfx, notifyCanvas:
		// the library's macros put the script name of the world in front of the command: "@gfx|<world>|<command>"
		world, cmd, _ := strings.Cut(body, "|")
		id := s.sessionForWorld(world)
		if id == "" {
			s.emit("notice", Notice{Level: "error", Text: "graphics need a session: open a world first"})
			return
		}
		name := "gfx"
		if title == notifyCanvas {
			name = "canvas"
		}
		s.hubFor(id).Handle(name, cmd)
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

// GfxSnapshot returns the open scenes of every session as scene operations, each tagged with its "session"; a window that
// mounts after the script ran asks for it.
func (s *Service) GfxSnapshot() []gfx.Op {
	s.gfxMu.Lock()
	hubs := make(map[string]*gfx.Hub, len(s.gfxHubs))
	for id, h := range s.gfxHubs {
		hubs[id] = h
	}
	s.gfxMu.Unlock()
	var out []gfx.Op
	for id, h := range hubs {
		for _, o := range h.Snapshot() {
			o["session"] = id
			out = append(out, o)
		}
	}
	return out
}

// GfxEvent reports a pointer event on a graphics object. scene is "<session>/<scene>"; the command the script attached with
// /gfx on runs in that session.
func (s *Service) GfxEvent(scene, id, event string, x, y float64) error {
	session, sc, ok := strings.Cut(scene, "/")
	if !ok {
		session, sc = s.eng.Foreground(), scene
	}
	err := s.hubFor(session).Event(sc, id, event, x, y)
	if err != nil {
		s.emit("notice", Notice{Level: "error", Text: err.Error(), Session: session})
	}
	return err
}
