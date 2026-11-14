// Package gfx is the command layer of SquatClient's graphics: it parses the /gfx and /canvas commands
// that TinyFugue scripts run into the JSON scene operations of docs/GFX.md, keeps a mirror of the scenes
// (to validate commands and to rebuild a window that mounts late) and delivers the operations to the UI.
// The frontend (frontend/src/gfx) renders them with WebGL2.
package gfx

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Hub receives commands and emits batches of scene operations.
type Hub struct {
	mu  sync.Mutex
	st  *state
	q   []Op
	vq  map[string]any // pending variable changes, merged into one "vars" op per flush
	tmr *time.Timer

	// Emit delivers a batch of operations to the window.
	Emit func(ops []Op)
	// Run executes a TF command line (event handlers: clicks and hovers).
	Run func(line string) error
	// Echo shows a line of command output (/gfx list ...).
	Echo func(line string)
	// Notice reports an error or a message (level "error", "warn" or "info").
	Notice func(level, text string)
	// Dirs are searched for files named by /gfx font|image|shader|load (after the current directory).
	Dirs []string
	// FlushDelay batches operations produced close together (default 8ms; <0 delivers synchronously).
	FlushDelay time.Duration
}

// New creates a hub; set the callbacks before use.
func New() *Hub { return &Hub{st: newState(), vq: map[string]any{}, FlushDelay: 8 * time.Millisecond} }

func (h *Hub) echo(f string, a ...any) {
	if h.Echo != nil {
		h.Echo(fmt.Sprintf(f, a...))
	}
}

// push queues ops (the caller holds h.mu).
func (h *Hub) push(ops ...Op) {
	h.q = append(h.q, ops...)
	if h.FlushDelay < 0 {
		h.flushLocked()
		return
	}
	if h.tmr == nil {
		d := h.FlushDelay
		if d == 0 {
			d = 8 * time.Millisecond
		}
		h.tmr = time.AfterFunc(d, h.Flush)
	}
}

// Flush delivers the queued operations now.
func (h *Hub) Flush() {
	h.mu.Lock()
	h.flushLocked()
	h.mu.Unlock()
}

func (h *Hub) flushLocked() {
	if h.tmr != nil {
		h.tmr.Stop()
		h.tmr = nil
	}
	if len(h.vq) > 0 {
		h.q = append(h.q, Op{"op": "vars", "vars": h.vq})
		h.vq = map[string]any{}
	}
	if len(h.q) == 0 {
		return
	}
	ops := h.q
	h.q = nil
	if h.Emit != nil {
		h.Emit(ops)
	}
}

// Handle runs one command line ("gfx" or "canvas" with its arguments); an error is reported through Notice.
func (h *Hub) Handle(cmd, args string) {
	if err := h.Exec(cmd, args); err != nil && h.Notice != nil {
		h.Notice("error", err.Error())
	}
}

// Exec runs one command line and returns its error.
func (h *Hub) Exec(cmd, args string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	switch cmd {
	case "gfx":
		return h.gfxCmd(strings.TrimSpace(args))
	case "canvas":
		return h.canvasCmd(strings.TrimSpace(args))
	}
	return fmt.Errorf("gfx: unknown command /%s", cmd)
}

// Snapshot rebuilds every open scene as a batch of ops (for a window that mounts late).
func (h *Hub) Snapshot() []Op {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []Op
	for _, id := range h.st.order {
		if s := h.st.scenes[id]; s != nil {
			out = append(out, s.snapshot(h.st.vars)...)
		}
	}
	return out
}

// Event reports a pointer event on an object ("click", "down", "up", "enter", "leave"); it runs the TF command
// the script attached with /gfx on. $id, $x, $y and $ev in the command become the object, position and event.
func (h *Hub) Event(sceneID, id, ev string, x, y float64) error {
	h.mu.Lock()
	var cmd string
	if s := h.st.scenes[sceneID]; s != nil {
		cmd = s.handlers[id][ev]
		if id == "#scene" && ev == "close" { // the window closed the scene (close button, Escape): keep the mirror in step
			s.cfg["open"] = false
		}
	}
	run := h.Run
	h.mu.Unlock()
	if cmd == "" || run == nil {
		return nil
	}
	r := strings.NewReplacer("$id", id, "$ev", ev, "$x", fmt.Sprint(int(x)), "$y", fmt.Sprint(int(y)), "$scene", sceneID)
	return run(r.Replace(cmd))
}

// Vars returns the latest values pushed with /gfx var (used by tests and the dev page recorder).
func (h *Hub) Vars() map[string]any {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := map[string]any{}
	for k, v := range h.st.vars {
		out[k] = v
	}
	return out
}

// Scenes lists the scene ids in creation order.
func (h *Hub) Scenes() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.st.order...)
}

func (h *Hub) findFile(name string) (string, error) {
	if filepath.IsAbs(name) {
		return name, nil
	}
	cands := append([]string{"."}, h.Dirs...)
	for _, d := range cands {
		p := filepath.Join(d, name)
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("gfx: cannot find file %q", name)
}

// Handlers lists the TF commands attached with /gfx on, as "scene/id:event" -> command (the dev page recorder).
func (h *Hub) Handlers() map[string]string {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := map[string]string{}
	for sid, s := range h.st.scenes {
		for id, evs := range s.handlers {
			for ev, cmd := range evs {
				out[sid+"/"+id+":"+ev] = cmd
			}
		}
	}
	return out
}
