package stdlib

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
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
	echoes  []string
	failTF  bool
	offline bool                // squat.send fails: the session is not connected
	sent    []string            // lines squat.send delivered to the game
	hubs    map[string]*gfx.Hub // per-session graphics, when a test runs several worlds
}

func (h *luaHost) Send(w, t string) error {
	if h.offline {
		return fmt.Errorf("not connected")
	}
	h.sent = append(h.sent, t)
	return nil
}
func (h *luaHost) Echo(w string, s []proto.Span) {
	for _, sp := range s {
		h.echoes = append(h.echoes, sp.S)
	}
}
func (h *luaHost) Notify(t, b string)         {}
func (h *luaHost) Now() time.Time             { return h.now }
func (h *luaHost) WorldName(id string) string { return id }
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
	if h.hubs != nil {
		return h.hubs[world].Exec(cmd, rest)
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
	need := []string{"joyknob", "joyhdg", "pglb1f", "dctr1", "dcsb1f", "opsv1", "trcen", "pgdpr1", "portframe", "el_top", "nav1", "nav2", "nav3", "radar", "planet", "stars", "core", "phasers", "ralert", "sh1"}
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
		s := stream{Ops: devFonts(f.ops), Loop: 12}
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
			delta = append(delta, g.ops[n:]...)
			name := "lcars-" + strings.NewReplacer(":", "-", "_", "").Replace(key) + "-" + first + ".json"
			if alert {
				name = strings.Replace(name, ".json", "-red.json", 1)
			}
			write(name, stream{Ops: delta, Delta: true})
			s.Commands[cmd] = "/gfx/" + name
		}
		return s
	}
	for _, th := range []string{"soft", "romulan", "klingon", "tos", "ferengi", "ops"} {
		f := startLua(t)
		f.rt.OnInput("w", "/lcars "+th)
		first := devFonts(f.ops)
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
		write("lcars-theme-"+th+".json", stream{Ops: first, Vars: vars, Loop: 12})
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

// The console can be closed (/lcars stop, the close button, Escape) and opened again; by default it shares the
// output area (top 60%), /lcars full and /lcars size N change that.
func TestLcarsReopensAndDocksInTheOutputArea(t *testing.T) {
	f := startLua(t)
	f.rt.OnInput("w", "/lcars")
	sc := f.find("scene", "")
	if sc["dock"] != "full" || sc["portNode"] != "textport" {
		t.Fatalf("default placement %v", sc)
	}
	f.rt.OnInput("w", "/lcars stop")
	n := len(f.ops)
	f.rt.OnInput("w", "/lcars")
	reopened := false
	for _, o := range f.ops[n:] {
		if o["op"] == "scene" && o["open"] == true {
			reopened = true
		}
	}
	if !reopened {
		t.Fatal("/lcars after stop did not reopen the scene")
	}
	before := len(f.ops)
	f.h.advance(2 * time.Second)
	if len(f.ops) == before {
		t.Fatal("the simulation did not restart after reopening")
	}
	f.rt.OnInput("w", "/lcars size 45")
	var last gfx.Op
	for _, o := range f.ops {
		if o["op"] == "scene" && o["size"] == "45%" {
			last = o
		}
	}
	if last == nil || last["dock"] != "top" || last["portNode"] != "none" {
		t.Fatalf("size command: %v", last)
	}
	f.rt.OnInput("w", "/lcars full")
	if got := f.find("scene", ""); got == nil {
		t.Fatal("no scene op")
	}
	f.errors(t)
}

// Closing the window (close button, Escape) tells the script; the console stops ticking, and /lcars brings it back
// cleanly every time.
func TestLcarsCloseEventStopsTheTickAndReopensCleanly(t *testing.T) {
	f := startLua(t)
	f.rt.OnInput("w", "/lcars")
	for round := 0; round < 3; round++ {
		if err := f.hub.Event("lcars", "#scene", "close", 0, 0); err != nil {
			t.Fatal(err)
		}
		n := len(f.ops)
		f.h.advance(8 * time.Second) // several ticks while closed: nothing may be sent, nothing may fail
		if len(f.ops) != n {
			t.Fatalf("round %d: %d ops were sent while the console was closed", round, len(f.ops)-n)
		}
		if !f.rt.OnInput("w", "/lcars") {
			t.Fatal("/lcars alias missing")
		}
		reopened := false
		for _, o := range f.ops[n:] {
			if o["op"] == "scene" && o["open"] == true {
				reopened = true
			}
		}
		if !reopened || f.find("create", "radar") == nil {
			t.Fatalf("round %d: scene not reopened", round)
		}
		m := len(f.ops)
		f.h.advance(2 * time.Second)
		if len(f.ops) == m {
			t.Fatalf("round %d: the simulation did not restart", round)
		}
	}
	f.errors(t)
}

// The failure limit protects against a flood, it never locks the user out: an explicit /lcars starts fresh.
func TestLcarsRecoversAfterTheGiveUpLimit(t *testing.T) {
	f := startLua(t)
	f.rt.OnInput("w", "/lcars")
	f.h.failTF = true
	f.h.advance(8 * time.Second) // more than five failing ticks
	f.h.failTF = false
	n := len(f.ops)
	f.rt.OnInput("w", "/lcars")
	f.h.advance(2 * time.Second)
	sawVars, sawOpen := false, false
	for _, o := range f.ops[n:] {
		if o["op"] == "vars" {
			sawVars = true
		}
		if o["op"] == "scene" && o["open"] == true {
			sawOpen = true
		}
	}
	if !sawOpen || !sawVars {
		t.Fatalf("no recovery: open=%v vars=%v", sawOpen, sawVars)
	}
	// and from a cold start: six commands fail (the TF side is missing), then the cause is fixed
	g := startLua(t)
	g.h.failTF = true
	g.rt.OnInput("w", "/lcars")
	g.rt.OnInput("w", "/lcars")
	g.h.failTF = false
	g.rt.OnInput("w", "/lcars")
	if g.find("create", "radar") == nil {
		t.Fatal("a fresh /lcars did not build the console once the cause was gone")
	}
	// the give-up message is printed once per run
	h := startLua(t)
	h.rt.OnInput("w", "/lcars")
	h.h.failTF = true
	h.h.advance(20 * time.Second)
	if c := countEchoes(h.h, "giving up"); c > 1 {
		t.Fatalf("give-up message %d times", c)
	}
}

func countEchoes(h *luaHost, sub string) int {
	n := 0
	for _, e := range h.echoes {
		if strings.Contains(e, sub) {
			n++
		}
	}
	return n
}

// The LOG button animates the text port between compact and about 80% of the content height; the state survives
// console switches and reopening, and everything is renderer-side tweens.
func TestLcarsLogToggleAnimatesThePortAndSurvivesSwitchesAndReopen(t *testing.T) {
	f := startLua(t)
	f.rt.OnInput("w", "/lcars")
	tweenH := func(from int, id string) float64 {
		var h float64
		for _, o := range f.ops[from:] {
			if o["op"] == "tween" && o["target"] == id {
				if tr, ok := o["tracks"].(map[string]any)["h"].(map[string]any); ok {
					h, _ = tr["to"].(float64)
				}
			}
		}
		return h
	}
	n := len(f.ops)
	if err := f.hub.Event("lcars", "logbtn", "click", 1, 1); err != nil {
		t.Fatal(err)
	}
	if h := tweenH(n, "textport"); h < 500 || h > 600 { // about 80% of the 710 px content height
		t.Fatalf("expanded port height %v", h)
	}
	for _, id := range []string{"vsg", "rdg", "ctg", "m_eng", "m_tac", "m_ship"} {
		found := false
		for _, o := range f.ops[n:] {
			if o["op"] == "tween" && o["target"] == id {
				found = true
			}
		}
		if !found {
			t.Errorf("%s was not tweened for the expanded layout", id)
		}
	}
	f.h.advance(time.Second) // the end state is mirrored for a later reopen
	if got := f.hub.Snapshot(); got == nil {
		t.Fatal("no snapshot")
	}
	var mirrored float64
	for _, o := range f.hub.Snapshot() {
		if o["op"] == "create" && o["id"] == "textport" {
			mirrored = o["props"].(map[string]any)["h"].(float64)
		}
	}
	if mirrored != 552 {
		t.Fatalf("mirrored port height %v", mirrored)
	}
	f.rt.OnInput("w", "/lcars eng") // switching consoles keeps the expanded state
	if err := f.hub.Event("lcars", "#scene", "close", 0, 0); err != nil {
		t.Fatal(err)
	}
	f.rt.OnInput("w", "/lcars")
	n = len(f.ops)
	f.rt.OnInput("w", "/lcars log")
	if h := tweenH(n, "textport"); h != 182 {
		t.Fatalf("collapse after reopen: %v", h)
	}
	f.errors(t)
}

// GFX_RECORD_THEMES=<dir> writes every theme and console as a stream for the dev page (screenshots, frame-rate checks).
func TestRecordThemeStreams(t *testing.T) {
	dir := os.Getenv("GFX_RECORD_THEMES")
	if dir == "" {
		t.Skip("set GFX_RECORD_THEMES=<dir>")
	}
	for _, theme := range []string{"tng", "soft", "romulan", "klingon", "tos", "ferengi", "ops"} {
		for _, con := range []string{"sens", "eng", "tac", "ship", "op"} {
			f := startLua(t)
			f.rt.OnInput("w", "/lcars "+theme)
			f.rt.OnInput("w", "/lcars "+con)
			ops := devFonts(f.ops)
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
			b, _ := json.Marshal(map[string]any{"ops": ops, "vars": vars, "loop": 12.0})
			if err := os.WriteFile(filepath.Join(dir, "lcars-"+theme+"-"+con+".json"), b, 0o644); err != nil {
				t.Fatal(err)
			}
			// the same with the LOG toggle pressed (text port expanded, the other widgets shrunk or faded)
			g := startLua(t)
			g.rt.OnInput("w", "/lcars "+theme)
			g.rt.OnInput("w", "/lcars "+con)
			_ = g.hub.Event("lcars", "logbtn", "click", 0, 0)
			g.h.advance(time.Second)
			b, _ = json.Marshal(map[string]any{"ops": devFonts(g.ops), "loop": 12.0})
			_ = os.WriteFile(filepath.Join(dir, "lcars-"+theme+"-"+con+"-log.json"), b, 0o644)
		}
	}
}

// devFonts replaces the font data inside recorded streams by the file under /fonts (the dev page serves frontend/public/fonts).
func devFonts(ops []gfx.Op) []gfx.Op {
	out := make([]gfx.Op, 0, len(ops))
	for _, o := range ops {
		if o["op"] == "font" {
			c := gfx.Op{}
			for k, v := range o {
				c[k] = v
			}
			if f, ok := o["file"].(string); ok {
				c["src"] = "/fonts/" + filepath.Base(f)
			}
			o = c
		}
		out = append(out, o)
	}
	return out
}

var allThemes = []string{"tng", "soft", "romulan", "klingon", "tos", "ferengi", "ops"}

// Every theme opens, builds the shared pieces (text port object, frame round it, LOG toggle, console buttons), obeys the
// alert, survives switching to every other theme without losing the LOG state, and reopens after a window close.
func TestEveryThemeOpensSwitchesAndKeepsTheLogState(t *testing.T) {
	f := startLua(t)
	f.rt.OnInput("w", "/lcars")
	f.hub.Event("lcars", "logbtn", "click", 0, 0) // expand once; the state must survive every switch below
	f.h.advance(time.Second)
	for _, theme := range allThemes {
		n := len(f.ops)
		if !f.rt.OnInput("w", "/lcars "+theme) {
			t.Fatalf("/lcars %s not handled", theme)
		}
		for _, id := range []string{"textport", "portframe", "logbtn", "nav1", "nav4", "c_sens", "c_eng", "c_tac", "c_ship", "joyknob"} {
			found := false
			for _, o := range f.ops[n:] {
				if o["op"] == "create" && o["id"] == id {
					found = true
				}
			}
			if !found {
				t.Errorf("%s: %s not created", theme, id)
			}
		}
		// the port object ends up expanded (instantly) in every theme
		var h float64
		for _, o := range f.ops[n:] {
			if o["op"] == "set" && o["id"] == "textport" {
				if v, ok := o["props"].(map[string]any)["h"].(float64); ok {
					h = v
				}
			}
		}
		if h != 552 {
			t.Errorf("%s: expanded port height %v after the switch", theme, h)
		}
		f.h.advance(2 * time.Second) // ticks run
		f.rt.OnInput("w", "/lcars alert red")
		f.rt.OnInput("w", "/lcars alert off")
		for _, console := range []string{"eng", "tac", "ship", "sens"} {
			f.rt.OnInput("w", "/lcars "+console)
		}
	}
	// close through the window, reopen: the last theme comes back
	f.hub.Event("lcars", "#scene", "close", 0, 0)
	n := len(f.ops)
	f.rt.OnInput("w", "/lcars")
	reopened := false
	for _, o := range f.ops[n:] {
		if o["op"] == "scene" && o["open"] == true {
			reopened = true
		}
	}
	if !reopened {
		t.Fatal("not reopened")
	}
	f.errors(t)
}

func TestThemesListAliasesAndTour(t *testing.T) {
	f := startLua(t)
	f.rt.OnInput("w", "/lcars themes")
	if len(f.h.echoes) == 0 || !strings.Contains(f.h.echoes[len(f.h.echoes)-1], "ops") || !strings.Contains(f.h.echoes[len(f.h.echoes)-1], "soft") {
		t.Fatalf("themes: %v", f.h.echoes)
	}
	f.rt.OnInput("w", "/lcars picard") // alias of bridge
	if f.find("create", "pB_sens") == nil {
		t.Fatal("/lcars picard did not open the bridge")
	}
	// the tour cycles through every theme every 12 seconds and /lcars stop ends it
	g := startLua(t)
	g.rt.OnInput("w", "/lcars tour")
	seen := map[string]bool{}
	for i := 0; i < 8; i++ {
		g.h.advance(12 * time.Second)
		for _, o := range g.ops {
			if o["op"] == "create" && o["id"] == "plate" {
				seen["romulan"] = true
			}
			if o["op"] == "create" && o["id"] == "topplate" {
				seen["klingon"] = true
			}
			if o["op"] == "create" && o["id"] == "pB_sens" {
				seen["bridge"] = true
			}
			if o["op"] == "create" && o["id"] == "gly1" {
				seen["ferengi"] = true
			}
			if o["op"] == "create" && o["id"] == "rv1" {
				seen["tos"] = true
			}
			if o["op"] == "create" && o["id"] == "glass1" {
				seen["soft"] = true
			}
		}
	}
	if len(seen) != 6 {
		t.Fatalf("the tour showed %v", seen)
	}
	g.rt.OnInput("w", "/lcars stop")
	n := len(g.ops)
	g.h.advance(30 * time.Second)
	if len(g.ops) != n {
		t.Fatal("the tour kept running after /lcars stop")
	}
	// a click ends the tour too
	h := startLua(t)
	h.rt.OnInput("w", "/lcars tour")
	h.hub.Event("lcars", "nav2", "click", 0, 0)
	n = len(h.ops)
	h.h.advance(13 * time.Second)
	for _, o := range h.ops[n:] {
		if o["op"] == "create" && o["id"] == "plate" {
			t.Fatal("the tour continued after a click")
		}
	}
	f.errors(t)
}

// Calm is a global setting: it applies to every theme (a scene property the renderer eases), survives theme switches and
// is remembered (squat.var) across a restart of the plugin.
func TestCalmAppliesToEveryThemeAndIsRemembered(t *testing.T) {
	f := startLua(t)
	f.rt.OnInput("w", "/lcars calm 60")
	f.rt.OnInput("w", "/lcars soft")
	calmOf := func() any {
		var c any
		for _, o := range f.ops {
			if o["op"] == "scene" {
				if v, ok := o["calm"]; ok {
					c = v
				}
			}
		}
		return c
	}
	if c := calmOf(); c != 0.6 {
		t.Fatalf("calm after /lcars calm 60 and a theme switch: %v", c)
	}
	f.rt.OnInput("w", "/lcars klingon")
	if c := calmOf(); c != 0.6 {
		t.Fatalf("calm lost on theme switch: %v", c)
	}
	f.rt.OnInput("w", "/lcars calm off")
	if c := calmOf(); c != 0.0 {
		t.Fatalf("calm off: %v", c)
	}
	f.rt.OnInput("w", "/lcars calm on")
	if c := calmOf(); c != 0.7 {
		t.Fatalf("calm on: %v", c)
	}
	// remembered: a new plugin instance reads the variable
	if err := f.rt.Exec("w", `if squat.var.get("lcars_calm") ~= 0.7 then error("not remembered") end`); err != nil {
		t.Fatal(err)
	}
	f.errors(t)
}

// two worlds, each with its own hub, scenes and state: /lcars in one leaves the other without a scene
func TestLcarsIsPerSession(t *testing.T) {
	cfg := t.TempDir()
	lib, err := Install(cfg)
	if err != nil {
		t.Fatal(err)
	}
	h := &luaHost{now: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), dir: cfg, hubs: map[string]*gfx.Hub{}}
	rt := lua.New(h, lua.Options{})
	t.Cleanup(rt.Close)
	h.rt = rt
	ops := map[string]*[]gfx.Op{}
	for _, w := range []string{"a", "b"} {
		w := w
		hub := gfx.New()
		hub.FlushDelay = -1
		hub.Dirs = []string{lib}
		o := &[]gfx.Op{}
		ops[w] = o
		hub.Emit = func(x []gfx.Op) { *o = append(*o, x...) }
		hub.Run = func(line string) error {
			if !rt.OnInput(w, line) {
				return fmt.Errorf("no alias took %q", line)
			}
			return nil
		}
		h.hubs[w] = hub
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
	has := func(w, id string) bool {
		for _, o := range h.hubs[w].Snapshot() {
			if o["op"] == "create" && o["id"] == id {
				return true
			}
		}
		return false
	}
	portH := func(w string) float64 {
		var v float64
		for _, o := range h.hubs[w].Snapshot() {
			if o["op"] == "create" && o["id"] == "textport" {
				v, _ = o["props"].(map[string]any)["h"].(float64)
			}
		}
		return v
	}
	rt.OnInput("a", "/lcars")
	if !has("a", "textport") {
		t.Fatal("a has no scene")
	}
	if len(h.hubs["b"].Scenes()) != 0 || len(*ops["b"]) != 0 {
		t.Fatalf("b got a scene: %v", h.hubs["b"].Scenes())
	}
	// b picks its own theme and expands its LOG; a keeps its own
	rt.OnInput("b", "/lcars klingon")
	rt.OnInput("b", "/lcars log")
	h.advance(2 * time.Second)
	rt.OnInput("a", "/lcars romulan")
	h.advance(2 * time.Second)
	if portH("b") < 500 {
		t.Fatalf("b's LOG is not expanded: %v", portH("b"))
	}
	if portH("a") >= 500 || portH("a") == 0 {
		t.Fatalf("a's LOG followed b: %v", portH("a"))
	}
	// switching back and forth: nothing is shared, a click in a changes only a
	if err := h.hubs["a"].Event("lcars", "logbtn", "click", 1, 1); err != nil {
		t.Fatal(err)
	}
	h.advance(2 * time.Second)
	if portH("a") < 500 || portH("b") < 500 {
		t.Fatalf("a=%v b=%v", portH("a"), portH("b"))
	}
	if err := h.hubs["b"].Event("lcars", "logbtn", "click", 1, 1); err != nil {
		t.Fatal(err)
	}
	h.advance(2 * time.Second)
	if portH("b") >= 500 || portH("a") < 500 {
		t.Fatalf("a=%v b=%v after collapsing b", portH("a"), portH("b"))
	}
	// the b scene was built with the klingon palette, a's with romulan: the two hubs hold different colours
	colours := func(w string) string {
		b, _ := json.Marshal(h.hubs[w].Snapshot())
		return string(b)
	}
	if colours("a") == colours("b") {
		t.Fatal("the two sessions drew the same scene")
	}
	// closing a's window reaches a only
	if err := h.hubs["a"].Event("lcars", "#scene", "close", 0, 0); err != nil {
		t.Fatal(err)
	}
	rt.OnInput("a", "/lcars")
	if !has("a", "textport") || !has("b", "textport") {
		t.Fatal("a reopen disturbed a session")
	}
	for _, l := range h.logs {
		if strings.Contains(l, "error") {
			t.Errorf("log: %s", l)
		}
	}
}

// The consoles speak the game's own commands: every button sends the real command in this session (only while connected,
// and shows it first), and the game's output feeds the panels back.
func TestOpsConsolesSendRealCommandsAndParseTheGamesOutput(t *testing.T) {
	f := startLua(t)
	f.rt.OnInput("w", "/lcars")
	click := func(id string) {
		t.Helper()
		if err := f.hub.Event("lcars", id, "click", 5, 5); err != nil {
			t.Fatal(err)
		}
	}
	has := func(lines []string, want string) bool {
		for _, l := range lines {
			if l == want {
				return true
			}
		}
		return false
	}
	f.rt.OnInput("w", "/lcars dc")
	// pick team 3, click the port nacelle: dmg assign 3=Port_Nacelle goes to the game, shown first
	click("dcts3")
	click("dcsz2")
	if !has(f.h.sent, "dmg assign 3=Port_Nacelle") {
		t.Fatalf("sent %v", f.h.sent)
	}
	if !has(f.h.echoes, "lcars> dmg assign 3=Port_Nacelle") {
		t.Fatalf("not echoed: %v", f.h.echoes)
	}
	// the answer of the game comes back as output lines and updates the display
	for _, l := range []string{"Damage Statistics", "Port_Nacelle [=================---] <91.5/100.0>", "Starboard_Nacelle [=================---] <86.4/100.0>", "Hull Status [====] <875.00/875.00>",
		"T#  Crew  Assignment", "1   10   Hull", "2   10   Hull", "3   10   Port_Nacelle", "4   10   Hull", "5   10   Hull"} {
		f.rt.OnLine("w", proto.Line{V: 1, T: "line", Kind: "game", Spans: []proto.Span{{S: l}}}, true)
	}
	vars := map[string]any{}
	for _, o := range f.ops {
		if o["op"] == "vars" {
			for k, v := range o["vars"].(map[string]any) {
				vars[k] = v
			}
		}
	}
	if vars["sh_dm_port"] != 91.5 || vars["dc_a3"] != "Port_Nacelle" || vars["dc_a1"] != "Hull" {
		t.Fatalf("parsed vars: port=%v a3=%v a1=%v", vars["sh_dm_port"], vars["dc_a3"], vars["dc_a1"])
	}
	// without a team picked the click sends nothing and asks for one
	f.h.sent = nil
	click("dcts3") // deselect
	click("dcsz1")
	if len(f.h.sent) != 0 {
		t.Fatalf("sent without a team: %v", f.h.sent)
	}
	// the power model
	f.rt.OnInput("w", "/lcars power")
	click("pgls3") // fuel group: opens it and asks the game
	click("pgdpr3")
	if !has(f.h.sent, "pg fuel") || !has(f.h.sent, "power fuel=50%") {
		t.Fatalf("sent %v", f.h.sent)
	}
	// operations
	f.rt.OnInput("w", "/lcars operations")
	click("opsb2")
	click("opsb3")
	click("trcen")
	for _, want := range []string{"hatch", "dd open", "tractor engage"} {
		if !has(f.h.sent, want) {
			t.Errorf("missing %q in %v", want, f.h.sent)
		}
	}
	// the "not available" reply becomes a hint, not an error
	f.h.echoes = nil
	f.rt.OnLine("w", proto.Line{V: 1, T: "line", Kind: "game", Spans: []proto.Span{{S: "That function is not available from this console"}}}, true)
	if len(f.h.echoes) == 0 || !strings.Contains(f.h.echoes[0], "man opera") {
		t.Fatalf("no hint: %v", f.h.echoes)
	}
	// not connected: the command is shown, nothing is sent, and the player is told
	f.h.offline = true
	f.h.sent, f.h.echoes = nil, nil
	click("opsb2")
	if len(f.h.sent) != 0 || len(f.h.echoes) < 2 || !strings.Contains(f.h.echoes[len(f.h.echoes)-1], "not connected") {
		t.Fatalf("offline: sent=%v echoes=%v", f.h.sent, f.h.echoes)
	}
	f.errors(t)
}

// The joystick belongs to the consoles that fly or aim the ship.
func TestJoystickOnlyWhereTheShipIsFlown(t *testing.T) {
	f := startLua(t)
	f.rt.OnInput("w", "/lcars")
	vis := func() bool {
		v := true
		for _, o := range f.ops {
			if (o["op"] == "set" || o["op"] == "create") && o["id"] == "joy" {
				if p, ok := o["props"].(map[string]any); ok {
					if b, ok := p["visible"].(bool); ok {
						v = b
					}
				}
			}
		}
		return v
	}
	for con, want := range map[string]bool{"ship": false, "op": false, "eng": false, "tac": true, "sens": true} {
		f.rt.OnInput("w", "/lcars "+con)
		if vis() != want {
			t.Errorf("joystick visible on %s = %v, want %v", con, vis(), want)
		}
	}
}

// ---- geometry: what is drawn must not cover what is used ------------------------------------------------------------
// For every theme and console: decorative layers (particle emitters, ornament and frame paths and the like) never overlap a
// button, a clickable object or a text, and buttons never overlap each other. Boxes are conservative (a path counts as the
// box of its points); text width is estimated from the length and size, so the check finds real collisions, not hairlines.
type gbox struct {
	id, kind       string
	x0, y0, x1, y1 float64
}

func (b gbox) hit(o gbox) bool {
	w := math.Min(b.x1, o.x1) - math.Max(b.x0, o.x0)
	h := math.Min(b.y1, o.y1) - math.Max(b.y0, o.y0)
	return w > 3 && h > 3
}

func num(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	}
	return 0
}

// pathPoints samples an SVG-style path (absolute M, L, C, S) into points along the curve.
func pathPoints(d string) [][2]float64 {
	tok := regexp.MustCompile(`[MLCSZ]|-?[0-9]*\.?[0-9]+`).FindAllString(d, -1)
	var pts [][2]float64
	var cx, cy, lx, ly float64 // current point, last control point
	i := 0
	nextN := func() float64 { v, _ := strconv.ParseFloat(tok[i], 64); i++; return v }
	cmd := ""
	for i < len(tok) {
		if strings.ContainsAny(tok[i], "MLCSZ") {
			cmd = tok[i]
			i++
			continue
		}
		switch cmd {
		case "M", "L":
			cx, cy = nextN(), nextN()
			lx, ly = cx, cy
			pts = append(pts, [2]float64{cx, cy})
		case "C", "S":
			var x1, y1 float64
			if cmd == "C" {
				x1, y1 = nextN(), nextN()
			} else {
				x1, y1 = 2*cx-lx, 2*cy-ly
			}
			x2, y2, x, y := nextN(), nextN(), nextN(), nextN()
			for k := 1; k <= 20; k++ {
				u := float64(k) / 20
				a, b, c, e := (1-u)*(1-u)*(1-u), 3*(1-u)*(1-u)*u, 3*(1-u)*u*u, u*u*u
				pts = append(pts, [2]float64{a*cx + b*x1 + c*x2 + e*x, a*cy + b*y1 + c*y2 + e*y})
			}
			lx, ly, cx, cy = x2, y2, x, y
		default:
			i++
		}
	}
	return pts
}

func sceneBoxes(ops []gfx.Op) (decor, inter, texts []gbox) {
	type node struct {
		op     gfx.Op
		props  map[string]any
		parent string
	}
	nodes := map[string]*node{}
	var order []string
	handlers := map[string]bool{}
	for _, o := range ops {
		id, _ := o["id"].(string)
		switch o["op"] {
		case "create":
			p, _ := o["props"].(map[string]any)
			c := map[string]any{}
			for k, v := range p {
				c[k] = v
			}
			par, _ := o["parent"].(string)
			nodes[id] = &node{op: o, props: c, parent: par}
			order = append(order, id)
		case "set":
			if n := nodes[id]; n != nil {
				p, _ := o["props"].(map[string]any)
				for k, v := range p {
					n.props[k] = v
				}
			}
		case "on":
			if evs, ok := o["events"].([]any); ok {
				for _, e := range evs {
					if e == "click" {
						handlers[id] = true
					}
				}
			}
		}
	}
	visible := func(id string) bool {
		for cur := id; cur != ""; cur = nodes[cur].parent {
			n := nodes[cur]
			if v, ok := n.props["visible"].(bool); ok && !v {
				return false
			}
			if num(n.props["opacity"]) == 0 && n.props["opacity"] != nil {
				return false
			}
		}
		return true
	}
	origin := func(id string) (float64, float64, *[4]float64) { // absolute position of the node's parent, and the nearest clip in absolute terms
		ax, ay := 0.0, 0.0
		var clip *[4]float64
		var chain []string
		for cur := nodes[id].parent; cur != ""; cur = nodes[cur].parent {
			chain = append(chain, cur)
		}
		for i := len(chain) - 1; i >= 0; i-- {
			n := nodes[chain[i]]
			ax += num(n.props["x"])
			ay += num(n.props["y"])
			var c []float64
			switch v := n.props["clip"].(type) {
			case []any:
				for _, e := range v {
					c = append(c, num(e))
				}
			case []float64:
				c = v
			case []int:
				for _, e := range v {
					c = append(c, float64(e))
				}
			}
			if len(c) == 4 {
				cl := [4]float64{ax + c[0], ay + c[1], ax + c[0] + c[2], ay + c[1] + c[3]}
				clip = &cl
			}
		}
		return ax, ay, clip
	}
	for _, id := range order {
		n := nodes[id]
		typ, _ := n.op["type"].(string)
		if typ == "group" || id == "textport" || id == "portframe" || id == "alert_edge" || !visible(id) {
			continue
		}
		ax, ay, clip := origin(id)
		p := n.props
		x, y := num(p["x"]), num(p["y"])
		var b gbox
		b.id = id
		switch typ {
		case "rect", "button", "image", "shader", "graph", "elbow", "starfield", "planet", "radar":
			w, h := num(p["w"]), num(p["h"])
			if typ == "planet" || typ == "radar" {
				w, h = 2*num(p["r"]), 2*num(p["r"])
				x, y = x-w/2, y-h/2
			}
			b.x0, b.y0, b.x1, b.y1 = ax+x, ay+y, ax+x+w, ay+y+h
		case "circle", "arc":
			r := num(p["r"])
			if typ == "arc" {
				r = num(p["r1"])
			}
			b.x0, b.y0, b.x1, b.y1 = ax+x-r, ay+y-r, ax+x+r, ay+y+r
		case "ellipse":
			b.x0, b.y0, b.x1, b.y1 = ax+x-num(p["rx"]), ay+y-num(p["ry"]), ax+x+num(p["rx"]), ay+y+num(p["ry"])
		case "emitter":
			if num(p["rate"]) == 0 {
				continue // a burst emitter (a weapon flash the player fires) draws nothing until it is told to
			}
			r := math.Max(num(p["radius"]), 0) + num(p["speedMax"])*num(p["lifeMax"])
			b.x0, b.y0, b.x1, b.y1 = ax+x-r, ay+y-r, ax+x+r, ay+y+r
		case "path", "polyline", "polygon", "line":
			var xs, ys []float64
			if d, ok := p["d"].(string); ok {
				pp := pathPoints(d)
				for k := 0; k+1 < len(pp); k++ { // one box per piece of the curve: a swoop is not a rectangle
					piece := gbox{id: id, kind: "decor", x0: math.Min(pp[k][0], pp[k+1][0]) + ax + x - 2, x1: math.Max(pp[k][0], pp[k+1][0]) + ax + x + 2,
						y0: math.Min(pp[k][1], pp[k+1][1]) + ay + y - 2, y1: math.Max(pp[k][1], pp[k+1][1]) + ay + y + 2}
					decor = append(decor, piece)
				}
				continue
			}
			if pts, ok := p["points"].([]any); ok {
				for i := 0; i+1 < len(pts); i += 2 {
					xs, ys = append(xs, num(pts[i])), append(ys, num(pts[i+1]))
				}
			}
			if typ == "line" {
				xs, ys = []float64{num(p["x1"]), num(p["x2"])}, []float64{num(p["y1"]), num(p["y2"])}
			}
			if len(xs) == 0 {
				continue
			}
			b.x0, b.y0, b.x1, b.y1 = xs[0], ys[0], xs[0], ys[0]
			for i := range xs {
				b.x0, b.x1 = math.Min(b.x0, xs[i]), math.Max(b.x1, xs[i])
				b.y0, b.y1 = math.Min(b.y0, ys[i]), math.Max(b.y1, ys[i])
			}
			if typ != "line" {
				b.x0, b.x1, b.y0, b.y1 = b.x0+ax+x, b.x1+ax+x, b.y0+ay+y, b.y1+ay+y
			}
		case "text":
			s, _ := p["text"].(string)
			plain := regexp.MustCompile(`\{[^}]*\}`).ReplaceAllString(s, "00000")
			size := num(p["size"])
			face, _ := p["font"].(string)
			k := map[string]float64{"Orbitron": 0.68, "Cinzel": 0.58, "Antonio": 0.36, "Rajdhani": 0.44}[face]
			if k == 0 {
				k = 0.5
			}
			w := float64(len([]rune(plain))) * size * k
			al, _ := p["align"].(string)
			x0 := ax + x
			if al == "center" {
				x0 -= w / 2
			} else if al == "right" {
				x0 -= w
			}
			b.x0, b.y0, b.x1, b.y1 = x0, ay+y-size*0.4, x0+w, ay+y+size*0.4
		default:
			continue
		}
		if clip != nil {
			b.x0, b.y0 = math.Max(b.x0, clip[0]), math.Max(b.y0, clip[1])
			b.x1, b.y1 = math.Min(b.x1, clip[2]), math.Min(b.y1, clip[3])
			if b.x1 <= b.x0 || b.y1 <= b.y0 {
				continue
			}
		}
		interactive := typ == "button" || handlers[id] || p["hit"] == true || id == "joybase"
		isDecor := typ == "emitter" || typ == "path" || typ == "polyline" || strings.HasPrefix(id, "orn") || strings.HasPrefix(id, "fil") || strings.HasPrefix(id, "gly")
		switch {
		case isDecor:
			b.kind = "decor"
			decor = append(decor, b)
		case interactive && typ != "text":
			b.kind = "widget"
			inter = append(inter, b)
		case typ == "text":
			b.kind = "text"
			texts = append(texts, b)
			if interactive {
				inter = append(inter, b)
			}
		}
	}
	return
}

func TestDecorationNeverCoversWidgetsOrText(t *testing.T) {
	for _, theme := range allThemes {
		for _, con := range []string{"sens", "eng", "tac", "ship", "op"} {
			f := startLua(t)
			f.rt.OnInput("w", "/lcars "+theme)
			f.rt.OnInput("w", "/lcars "+con)
			f.h.advance(time.Second) // the console that was shown first hides after its fade
			decor, inter, texts := sceneBoxes(f.hub.Snapshot())
			if len(inter) == 0 || len(texts) == 0 {
				t.Fatalf("%s/%s: nothing to check (%d widgets, %d texts)", theme, con, len(inter), len(texts))
			}
			for _, d := range decor {
				for _, w := range inter {
					if d.hit(w) {
						t.Errorf("%s/%s: decoration %s covers widget %s", theme, con, d.id, w.id)
					}
				}
				for _, x := range texts {
					if d.hit(x) {
						t.Errorf("%s/%s: decoration %s covers text %s", theme, con, d.id, x.id)
					}
				}
			}
			for i, a := range inter {
				for _, b := range inter[i+1:] {
					if a.kind == "widget" && b.kind == "widget" && a.hit(b) && !strings.HasPrefix(a.id, "joy") && !strings.HasPrefix(b.id, "joy") {
						t.Errorf("%s/%s: widget %s overlaps widget %s", theme, con, a.id, b.id)
					}
				}
			}
			// texts of the joystick (always the same place) never collide with a console's own texts or widgets
			for _, j := range texts {
				if !strings.HasPrefix(j.id, "joy") {
					continue
				}
				for _, x := range append(append([]gbox{}, texts...), inter...) {
					if !strings.HasPrefix(x.id, "joy") && j.hit(x) {
						t.Errorf("%s/%s: the joystick label %s collides with %s", theme, con, j.id, x.id)
					}
				}
			}
		}
	}
}
