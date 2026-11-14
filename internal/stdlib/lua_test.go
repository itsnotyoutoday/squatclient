package stdlib

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/lua"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/proto"

	"github.com/itsnotyoutoday/squatclient/internal/gfx"
)

// luaHost runs the Lua gfx module for real: squat.tf lines go to a gfx.Hub exactly like TinyFugue's /gfx command
// (through the same Hub.Exec), timers run on a manual clock, and clicks come back through Lua aliases.
type luaHost struct {
	now    time.Time
	timers []*struct {
		at     time.Time
		fn     func()
		cancel bool
	}
	dir     string
	hub     *gfx.Hub
	logs    []string
	rt      *lua.Runtime
	tfLines []string
	failTF  bool
}

func (h *luaHost) Send(w, t string) error        { return nil }
func (h *luaHost) Echo(w string, s []proto.Span) {}
func (h *luaHost) Notify(t, b string)            {}
func (h *luaHost) Now() time.Time                { return h.now }
func (h *luaHost) WorldName(id string) string    { return id }
func (h *luaHost) Log(l lua.LogLevel, p, t string) {
	h.logs = append(h.logs, fmt.Sprintf("%v %s: %s", l, p, t))
}
func (h *luaHost) ListScripts() ([]string, error) {
	var out []string
	root := filepath.Join(h.dir, "plugins")
	_ = filepath.Walk(root, func(p string, i os.FileInfo, err error) error {
		if err == nil && !i.IsDir() {
			r, _ := filepath.Rel(root, p)
			out = append(out, filepath.ToSlash(r))
		}
		return nil
	})
	sort.Strings(out)
	return out, nil
}
func (h *luaHost) ReadScript(n string) ([]byte, error) {
	return os.ReadFile(filepath.Join(h.dir, "plugins", filepath.FromSlash(n)))
}
func (h *luaHost) Schedule(d time.Duration, fn func()) func() {
	t := &struct {
		at     time.Time
		fn     func()
		cancel bool
	}{h.now.Add(d), fn, false}
	h.timers = append(h.timers, t)
	return func() { t.cancel = true }
}
func (h *luaHost) RunTF(world, line string) error {
	if h.failTF {
		return fmt.Errorf("no such command: %s", line)
	}
	cmd, rest, _ := strings.Cut(strings.TrimPrefix(line, "/"), " ")
	if cmd != "gfx" && cmd != "canvas" {
		h.tfLines = append(h.tfLines, line) // /input, /echo ...: what a real client would hand to TinyFugue
		return nil
	}
	return h.hub.Exec(cmd, rest)
}
func (h *luaHost) advance(d time.Duration) {
	target := h.now.Add(d)
	for {
		var next *struct {
			at     time.Time
			fn     func()
			cancel bool
		}
		for _, t := range h.timers {
			if !t.cancel && !t.at.After(target) && (next == nil || t.at.Before(next.at)) {
				next = t
			}
		}
		if next == nil {
			h.now = target
			return
		}
		next.cancel = true
		h.now = next.at
		next.fn()
	}
}

type luaFixture struct {
	h   *luaHost
	rt  *lua.Runtime
	ops []gfx.Op
	hub *gfx.Hub
}

// startLua installs the library and, when code is not empty, a test plugin (with its own copy of gfx.lua, as
// require only reads the plugin's own folder) whose main.lua is code.
func startLua(t *testing.T, code ...string) *luaFixture {
	t.Helper()
	cfg := t.TempDir()
	lib, err := Install(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(code) > 0 {
		d := filepath.Join(cfg, "plugins", "tplug")
		_ = os.MkdirAll(d, 0o755)
		g, _ := os.ReadFile(filepath.Join(cfg, "plugins", "squat-gfx", "gfx.lua"))
		_ = os.WriteFile(filepath.Join(d, "gfx.lua"), g, 0o644)
		_ = os.WriteFile(filepath.Join(d, "main.lua"), []byte("local gfx = require('gfx'); gfx.install()\nsquat.alias{match='^/t$', regex=true, fn=function()\n"+code[0]+"\nend}\n"), 0o644)
	}
	hub := gfx.New()
	hub.FlushDelay = -1
	hub.Dirs = []string{lib}
	f := &luaFixture{hub: hub}
	hub.Emit = func(ops []gfx.Op) { f.ops = append(f.ops, ops...) }
	h := &luaHost{now: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), dir: cfg, hub: hub}
	rt := lua.New(h, lua.Options{})
	t.Cleanup(rt.Close)
	h.rt = rt
	f.h, f.rt = h, rt
	hub.Run = func(line string) error {
		if !rt.OnInput("w", line) {
			return fmt.Errorf("no alias took %q", line)
		}
		return nil
	}
	infos, err := rt.LoadPlugins()
	if err != nil {
		t.Fatal(err)
	}
	for _, i := range infos {
		if i.Err != "" {
			t.Fatalf("plugin failed to load: %s", i.Err)
		}
	}
	if len(code) > 0 && !rt.OnInput("w", "/t") {
		t.Fatal("test plugin alias missing")
	}
	return f
}

func (f *luaFixture) errors(t *testing.T) {
	t.Helper()
	for _, l := range f.h.logs {
		if strings.Contains(l, "error") || strings.Contains(l, "gfx:") {
			t.Errorf("log: %s", l)
		}
	}
}

func (f *luaFixture) find(op, id string) gfx.Op {
	for _, o := range f.ops {
		if o["op"] == op && (id == "" || o["id"] == id || o["target"] == id) {
			return o
		}
	}
	return nil
}

func TestLuaModuleBuildsScenesFromTables(t *testing.T) {
	f := startLua(t, `
local sc = gfx.scene("t", {w = 640, h = 360, bg = "#000", margin = {0, 0, 40, 0}})
local r = sc:rect{id = "bar", x = 10, y = 10, w = 200, h = 40, r = {20, 20, 0, 0}, fill = "#ff9900", shadow = {dy = 4, blur = 8},
  glow = 0.5}
local g = sc:rect{id = "grad", w = 10, h = 10, fill = {type = "linear", angle = 90, stops = {{0, "#f00"}, {1, "#00f"}}}}
local t = sc:text{id = "lbl", x = 5, y = 5, text = 'say "hi"; 50% done', size = 20}
r:set{x = 99}
r:animate{x = {from = 0, to = 300}, y = 20, dur = 0.5, ease = "outCubic", loop = "inf", yoyo = true}
r:bind("w", "lc_hull * 2", 0.5)
r:state("hover", {fill = "#fff"}, {dur = 0.1})
gfx.vars{lc_hull = 80, lc_name = "SHUTTLE 12"}
`)
	f.errors(t)
	scene := f.find("scene", "")
	if scene["w"] != 640.0 || fmt.Sprint(scene["margin"]) != "[0 0 40 0]" {
		t.Fatalf("scene %v", scene)
	}
	bar := f.find("create", "bar")
	p := bar["props"].(map[string]any)
	if bar["type"] != "rect" || p["fill"] != "#ff9900" || fmt.Sprint(p["r"]) != "[20 20 0 0]" || p["shadow"].(map[string]any)["blur"] != 8.0 {
		t.Fatalf("bar %v", bar)
	}
	g := f.find("create", "grad")["props"].(map[string]any)["fill"].(map[string]any)
	if g["type"] != "linear" || g["angle"] != 90.0 {
		t.Fatalf("gradient %v", g)
	}
	if got := f.find("create", "lbl")["props"].(map[string]any)["text"]; got != `say "hi"; 50% done` {
		t.Fatalf("text round trip: %q", got)
	}
	tw := f.find("tween", "bar")
	tr := tw["tracks"].(map[string]any)
	if tw["loop"] != -1 || tw["yoyo"] != true || tr["x"].(map[string]any)["from"] != 0.0 || tr["x"].(map[string]any)["to"] != 300.0 {
		t.Fatalf("tween %v", tw)
	}
	b := f.find("bind", "bar")
	if b["expr"] != "lc_hull * 2" || b["smooth"] != 0.5 || b["prop"] != "w" {
		t.Fatalf("bind %v", b)
	}
	vars := map[string]any{}
	for _, o := range f.ops {
		if o["op"] == "vars" {
			for k, v := range o["vars"].(map[string]any) {
				vars[k] = v
			}
		}
	}
	if vars["lc_hull"] != 80.0 || vars["lc_name"] != "SHUTTLE 12" {
		t.Fatalf("vars %v", vars)
	}
}

func TestLuaClicksRunLuaCallbacks(t *testing.T) {
	f := startLua(t, `
local sc = gfx.scene("t", {w = 100, h = 100})
local b = sc:button{id = "b1", x = 0, y = 0, w = 50, h = 20, text = "GO"}
b:on("click", function(o, e) squat.var.set("clicked", o.id .. "@" .. e.x .. "," .. e.y) end)
`)
	if err := f.hub.Event("t", "b1", "click", 12.4, 7); err != nil {
		t.Fatal(err)
	}
	if err := f.rt.Exec("w", `if squat.var.get("clicked") ~= "b1@12,7" then error("got " .. tostring(squat.var.get("clicked"))) end`); err != nil {
		t.Fatal(err)
	}
	f.errors(t)
}

func TestLuaBadCommandsAreLoggedNotFatal(t *testing.T) {
	f := startLua(t, `local sc = gfx.scene("t"); sc:rect{id="a"}; sc:get("a"):animate{dur = 1}`)
	found := false
	for _, l := range f.h.logs {
		if strings.Contains(l, "gfx:") {
			found = true
		}
	}
	if !found {
		t.Fatalf("no warning logged: %v", f.h.logs)
	}
}

func TestLcarsDemoInLua(t *testing.T) {
	f := startLua(t)
	if !f.rt.OnInput("w", "/lcars") {
		t.Fatal("/lcars alias did not run")
	}
	f.errors(t)
	need := []string{"joyknob", "joyhdg", "pgf1", "tkl1", "dmf3", "wchf", "el_top", "nav1", "nav2", "nav3", "radar", "planet", "stars", "core", "gauge", "phasers", "ralert", "trend", "sh1"}
	for _, id := range need {
		if f.find("create", id) == nil {
			t.Errorf("object %s not created", id)
		}
	}
	if len(f.hub.Handlers()) < 6 {
		t.Fatalf("handlers: %v", f.hub.Handlers())
	}
	n0 := len(f.ops)
	f.h.advance(2 * time.Second) // two simulation ticks
	var ct string
	for _, o := range f.ops[n0:] {
		if o["op"] == "vars" {
			if v, ok := o["vars"].(map[string]any)["lc_ct"].(string); ok {
				ct = v
			}
		}
	}
	if !strings.Contains(ct, ":F;") && !strings.Contains(ct, ":H;") {
		t.Fatalf("contact table not pushed: %q", ct)
	}
	// the joystick reports where it settled: Lua answers by putting a command in the input line
	if err := f.hub.Event("lcars", "joyknob", "settle", 60, -80); err != nil {
		t.Fatal(err)
	}
	f.h.tfLines = f.h.tfLines[1:] // the /require of gfx.tf from /lcars
	if got := f.h.tfLines; len(got) != 1 || got[0] != "/input /echo JoyStick to 37 power 100" {
		t.Fatalf("settle produced %v", got)
	}
	// a centred stick says nothing
	f.h.tfLines = nil
	_ = f.hub.Event("lcars", "joyknob", "settle", 1, 1)
	if len(f.h.tfLines) != 0 {
		t.Fatalf("centred stick spoke: %v", f.h.tfLines)
	}
	// a click on ENGINEER switches consoles with animation ops
	n1 := len(f.ops)
	if err := f.hub.Event("lcars", "nav2", "click", 5, 5); err != nil {
		t.Fatal(err)
	}
	f.h.advance(time.Second)
	sawFade := false
	for _, o := range f.ops[n1:] {
		if o["op"] == "tween" && o["target"] == "c_eng" {
			sawFade = true
		}
	}
	if !sawFade {
		t.Fatal("engineering group did not fade in")
	}
	// red alert recolours the themed objects with eased tweens
	n2 := len(f.ops)
	if !f.rt.OnInput("w", "/lcars alert red") {
		t.Fatal("alert alias")
	}
	recolor := 0
	for _, o := range f.ops[n2:] {
		if o["op"] == "tween" {
			if _, ok := o["tracks"].(map[string]any)["fill"]; ok {
				recolor++
			}
		}
	}
	if recolor < 15 {
		t.Fatalf("only %d objects recoloured", recolor)
	}
	f.errors(t)
	if !f.rt.OnInput("w", "/lcars stop") {
		t.Fatal("stop")
	}
	if f.ops[len(f.ops)-1]["open"] != false {
		t.Fatalf("scene not closed: %v", f.ops[len(f.ops)-1])
	}
}

// GFX_RECORD=<dir> writes the demo as streams for frontend/gfx-demo.html (no TinyFugue or Wails needed to view it).
func TestRecordDevPageStreams(t *testing.T) {
	dir := os.Getenv("GFX_RECORD")
	if dir == "" {
		t.Skip("set GFX_RECORD=<dir> to record the dev page streams")
	}
	type stream struct {
		Ops      []gfx.Op          `json:"ops"`
		Vars     []map[string]any  `json:"vars"`
		Delta    bool              `json:"delta,omitempty"`
		Commands map[string]string `json:"commands,omitempty"`
		Handlers map[string]string `json:"handlers,omitempty"`
		Loop     float64           `json:"loop,omitempty"`
	}
	write := func(name string, s stream) {
		b, _ := json.Marshal(s)
		if err := os.WriteFile(filepath.Join(dir, name), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	record := func(first string, alert bool) stream {
		f := startLua(t)
		f.rt.OnInput("w", "/lcars "+first)
		if alert {
			f.rt.OnInput("w", "/lcars alert red")
		}
		s := stream{Ops: append([]gfx.Op(nil), f.ops...), Loop: 12}
		var vars []map[string]any
		for i := 1; i <= 12; i++ {
			n := len(f.ops)
			f.h.advance(time.Second)
			for _, o := range f.ops[n:] {
				if o["op"] == "vars" {
					vars = append(vars, map[string]any{"t": float64(i), "vars": o["vars"]})
				}
			}
		}
		s.Vars = vars
		s.Handlers = map[string]string{}
		for k, v := range f.hub.Handlers() {
			k = strings.TrimPrefix(k, "lcars/")
			s.Handlers[k] = strings.TrimPrefix(strings.NewReplacer("$x", "0", "$y", "0").Replace(v), "/")
		}
		s.Commands = map[string]string{}
		// each button's effect, recorded as operations to apply on top of the running scene
		for key, cmd := range s.Handlers {
			id, ev, _ := strings.Cut(key, ":")
			g := startLua(t)
			g.rt.OnInput("w", "/lcars "+first)
			if alert {
				g.rt.OnInput("w", "/lcars alert red")
			}
			n := len(g.ops)
			_ = g.hub.Event("lcars", id, ev, 0, 0)
			g.h.advance(time.Second)
			var delta []gfx.Op
			for _, o := range g.ops[n:] {
				if o["op"] != "vars" {
					delta = append(delta, o)
				}
			}
			name := "lcars-" + strings.NewReplacer(":", "-", "_", "").Replace(key) + "-" + first + ".json"
			if alert {
				name = strings.Replace(name, ".json", "-red.json", 1)
			}
			write(name, stream{Ops: delta, Delta: true})
			s.Commands[cmd] = "/gfx/" + name
		}
		return s
	}
	write("lcars-sens.json", record("sens", false))
	write("lcars-eng.json", record("eng", false))
	write("lcars-tac.json", record("tac", false))
	write("lcars-ship.json", record("ship", false))
	write("lcars-red.json", record("sens", true))
}

// With the TF side missing (another standard library), /lcars must say so once and stop, not flood the window.
func TestLcarsGivesUpQuietlyWhenGfxCommandsAreMissing(t *testing.T) {
	f := startLua(t)
	f.h.failTF = true
	f.rt.OnInput("w", "/lcars")
	f.h.advance(3 * time.Second)
	if n := len(f.h.logs); n > 8 {
		t.Fatalf("%d log lines: %v", n, f.h.logs)
	}
	if len(f.ops) != 0 {
		t.Fatalf("ops emitted without a working /gfx: %d", len(f.ops))
	}
}
