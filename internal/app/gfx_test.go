package app

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/testutil/fakemush"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/tfengine"

	"github.com/itsnotyoutoday/squatclient/internal/config"
	"github.com/itsnotyoutoday/squatclient/internal/secrets"
	"github.com/itsnotyoutoday/squatclient/internal/stdlib"
)

// gfxFixture is a Service whose TF engine loads SquatClient's own standard library, like the desktop app.
func gfxFixture(t *testing.T) (*fixture, string) {
	t.Helper()
	dir := t.TempDir()
	cs, err := config.Open(filepath.Join(dir, "cfg"))
	if err != nil {
		t.Fatal(err)
	}
	scripts := filepath.Join(dir, "scripts")
	lib, err := stdlib.Install(scripts)
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{t: t, sec: secrets.NewMemory(), cfg: cs, dir: dir, quit: make(chan struct{}, 1)}
	svc, err := New(Options{
		Config: cs, Secrets: f.sec,
		Emit: func(name string, p any) {
			b, _ := json.Marshal(p)
			f.mu.Lock()
			f.evs = append(f.evs, captured{name, p, string(b)})
			f.mu.Unlock()
		},
		Engine: engine.Options{ConfigDir: scripts, TF: tfengine.Options{StdLib: lib, LibDirs: []string{lib, scripts}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	f.svc = svc
	svc.Start()
	t.Cleanup(svc.Shutdown)
	return f, lib
}

func (f *fixture) sessionForTF(t *testing.T) string {
	srv := fakemush.New(t)
	si, err := f.svc.Connect(ConnectTarget{Host: srv.Host(), Port: srv.Port()})
	if err != nil {
		t.Fatal(err)
	}
	f.waitConnected(si.ID)
	return si.ID
}

func (f *fixture) gfxOps() []map[string]any {
	var out []map[string]any
	for _, e := range f.events("gfx") {
		b, _ := json.Marshal(e.Payload)
		var ops []map[string]any
		if err := json.Unmarshal(b, &ops); err != nil {
			f.t.Fatal(err)
		}
		out = append(out, ops...)
	}
	return out
}

func TestGfxCommandsFlowFromScriptsToTheWindow(t *testing.T) {
	f, _ := gfxFixture(t)
	id := f.sessionForTF(t)
	for _, c := range []string{"/gfx open s w=320 h=200 bg=#000", "/gfx rect a 1 2 30 40 fill=#ff9900", "/canvas new hdr 20 3",
		"/canvas disc hdr 5 3 2 red", "/gfx on a click /echo clicked $id at $x"} {
		if err := f.svc.Input(id, c); err != nil {
			t.Fatal(err)
		}
	}
	f.until("the rectangle reaches the window", func() bool {
		for _, o := range f.gfxOps() {
			if o["op"] == "create" && o["id"] == "a" {
				return true
			}
		}
		return false
	})
	snap := f.svc.GfxSnapshot()
	types := map[string]bool{}
	for _, o := range snap {
		if ty, ok := o["type"].(string); ok {
			types[ty] = true
		}
	}
	if !types["rect"] || !types["pixelcanvas"] {
		t.Fatalf("snapshot lacks objects: %v", snap)
	}
	// a click runs the attached command in the foreground session
	f.until("handler registered", func() bool { return len(f.svc.Gfx(id).Scenes()) == 2 })
	if err := f.svc.GfxEvent(id+"/s", "a", "click", 7, 1); err != nil {
		t.Fatal(err)
	}
	f.until("the click handler's echo", func() bool { return f.hasText("clicked a at 7") })
}

func TestGfxBadCommandsBecomeNotices(t *testing.T) {
	f, _ := gfxFixture(t)
	id := f.sessionForTF(t)
	_ = f.svc.Input(id, "/gfx frob")
	_ = f.svc.Input(id, "/canvas px nope 1 2 red")
	f.until("two errors", func() bool {
		n := 0
		for _, e := range f.events("notice") {
			if strings.Contains(e.JSON, `"error"`) && (strings.Contains(e.JSON, "unknown subcommand") || strings.Contains(e.JSON, "no canvas")) {
				n++
			}
		}
		return n >= 2
	})
}

func TestWindowCommandsOpenDialogs(t *testing.T) {
	f, _ := gfxFixture(t)
	id := f.sessionForTF(t)
	_ = f.svc.Input(id, "/settings")
	_ = f.svc.Input(id, "/layouts")
	f.until("dialogs requested", func() bool {
		var got []string
		for _, e := range f.events("dialog") {
			got = append(got, e.JSON)
		}
		return strings.Contains(strings.Join(got, ""), "settings") && strings.Contains(strings.Join(got, ""), "layouts")
	})
}

func sessionsOf(ops []map[string]any) map[string]bool {
	m := map[string]bool{}
	for _, o := range ops {
		if o["op"] == "create" {
			if id, ok := o["session"].(string); ok {
				m[id] = true
			}
		}
	}
	return m
}

func TestGfxIsPerSession(t *testing.T) {
	f, _ := gfxFixture(t)
	a := f.sessionForTF(t)
	b := f.sessionForTF(t)
	if err := f.svc.Input(a, "/gfx open s w=320 h=200"); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Input(a, "/gfx rect r 1 2 30 40 fill=#ff9900"); err != nil {
		t.Fatal(err)
	}
	f.until("scene reaches the window tagged with its session", func() bool { return sessionsOf(f.gfxOps())[a] })
	if sessionsOf(f.gfxOps())[b] || len(f.svc.Gfx(b).Scenes()) != 0 {
		t.Fatalf("the other session has a scene: %v", f.svc.Gfx(b).Scenes())
	}
	snap := f.svc.GfxSnapshot()
	if !sessionsOf(snap)[a] || sessionsOf(snap)[b] {
		t.Fatalf("snapshot not per session: %v", snap)
	}
	// the other session draws its own scene with the same ids, separately
	_ = f.svc.Input(b, "/gfx open s w=100 h=100")
	_ = f.svc.Input(b, "/gfx rect r 1 2 3 4")
	f.until("second session has its own scene", func() bool { return sessionsOf(f.gfxOps())[b] })
	if err := f.svc.Input(b, "/gfx on r click /echo B clicked"); err != nil {
		t.Fatal(err)
	}
	f.until("b has its scene", func() bool { return len(f.svc.Gfx(b).Scenes()) == 1 })
	if len(f.svc.Gfx(a).Scenes()) != 1 {
		t.Fatalf("a changed: %v", f.svc.Gfx(a).Scenes())
	}
	// a click addressed to b's scene runs in b
	if err := f.svc.GfxEvent(b+"/s", "r", "click", 1, 1); err != nil {
		t.Fatal(err)
	}
	f.until("b's handler ran in b", func() bool { return f.hasText("B clicked") })
	// closing a session discards its scene
	if err := f.svc.Dismiss(a); err != nil {
		t.Fatal(err)
	}
	f.until("a's scene is gone", func() bool { return !sessionsOf(f.svc.GfxSnapshot())[a] })
	if !sessionsOf(f.svc.GfxSnapshot())[b] {
		t.Fatal("b lost its scene")
	}
}
