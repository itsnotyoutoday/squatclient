package gfx

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type rec struct {
	ops    []Op
	echo   []string
	ran    []string
	notice []string
}

func newHub(t *testing.T) (*Hub, *rec) {
	t.Helper()
	h := New()
	h.FlushDelay = -1
	r := &rec{}
	h.Emit = func(ops []Op) { r.ops = append(r.ops, ops...) }
	h.Echo = func(l string) { r.echo = append(r.echo, l) }
	h.Notice = func(lv, tx string) { r.notice = append(r.notice, lv+": "+tx) }
	h.Run = func(l string) error { r.ran = append(r.ran, l); return nil }
	return h, r
}

func (r *rec) last() Op { return r.ops[len(r.ops)-1] }

func mustExec(t *testing.T, h *Hub, cmd, line string) {
	t.Helper()
	if err := h.Exec(cmd, line); err != nil {
		t.Fatalf("/%s %s: %v", cmd, line, err)
	}
}

func TestArgsQuotingAndKeywords(t *testing.T) {
	a, err := ParseArgs(`btn 10 20 "HELLO WORLD" fill=#ff9900 text="a b" r=8,8,0,0`)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a.Pos, []string{"btn", "10", "20", "HELLO WORLD"}) {
		t.Fatalf("pos %v", a.Pos)
	}
	if a.Kw["fill"] != "#ff9900" || a.Kw["text"] != "a b" || a.Kw["r"] != "8,8,0,0" {
		t.Fatalf("kw %v", a.Kw)
	}
	if _, err := ParseArgs(`a "oops`); err == nil {
		t.Fatal("unterminated quote not reported")
	}
}

func TestValueConversion(t *testing.T) {
	for _, c := range []struct {
		k, v string
		want any
	}{
		{"x", "12.5", 12.5}, {"text", "12", "12"}, {"visible", "false", false}, {"r", "8,8,0,0", []float64{8, 8, 0, 0}},
		{"fill", "#fff", "#fff"}, {"fill", "=lc_core*2", "=lc_core*2"}, {"points", "[1,2,3]", []any{1.0, 2.0, 3.0}},
	} {
		got, err := value(c.k, c.v)
		if err != nil || !reflect.DeepEqual(got, c.want) {
			t.Errorf("value(%s,%s)=%#v,%v want %#v", c.k, c.v, got, err, c.want)
		}
	}
	g, err := value("fill", "lin(90;#f00,rgb(1,2,3)@0.4,#00f)")
	if err != nil {
		t.Fatal(err)
	}
	m := g.(map[string]any)
	st := m["stops"].([][]any)
	if m["type"] != "linear" || m["angle"] != 90.0 || len(st) != 3 || st[1][1] != "rgb(1,2,3)" || st[1][0] != 0.4 {
		t.Fatalf("gradient %v", m)
	}
	if _, err := value("fill", "lin(90;#f00)"); err == nil {
		t.Fatal("one-stop gradient accepted")
	}
}

func TestCreateSetDeleteAndMirror(t *testing.T) {
	h, r := newHub(t)
	mustExec(t, h, "gfx", "open lcars w=1280 h=720 bg=#000 bloom=0.8")
	mustExec(t, h, "gfx", `rrect hdr 0 0 300 40 r=20,20,0,0 fill=#ff9900 glow=0.5 shadow.blur=6`)
	op := r.last()
	if op["op"] != "create" || op["type"] != "rect" || op["id"] != "hdr" || op["scene"] != "lcars" {
		t.Fatalf("op %v", op)
	}
	p := op["props"].(map[string]any)
	if p["w"] != 300.0 || p["fill"] != "#ff9900" || !reflect.DeepEqual(p["r"], []float64{20, 20, 0, 0}) {
		t.Fatalf("props %v", p)
	}
	if p["shadow"].(map[string]any)["blur"] != 6.0 {
		t.Fatalf("shadow %v", p["shadow"])
	}
	mustExec(t, h, "gfx", "text lbl 10 12 HELLO THERE size=18")
	if got := r.last()["props"].(map[string]any)["text"]; got != "HELLO THERE" {
		t.Fatalf("text %v", got)
	}
	mustExec(t, h, "gfx", "set hdr alpha=0.5 shadow.dx=2")
	n := h.st.scenes["lcars"].nodes["hdr"]
	if n.props["opacity"] != 0.5 || n.props["shadow"].(map[string]any)["blur"] != 6.0 || n.props["shadow"].(map[string]any)["dx"] != 2.0 {
		t.Fatalf("merge %v", n.props)
	}
	if err := h.Exec("gfx", "set nope x=1"); err == nil || !strings.Contains(err.Error(), "no object") {
		t.Fatalf("missing object: %v", err)
	}
	mustExec(t, h, "gfx", "group g1")
	mustExec(t, h, "gfx", "circle c1 5 5 3 parent=g1")
	mustExec(t, h, "gfx", "del g1")
	if len(h.st.scenes["lcars"].nodes) != 2 {
		t.Fatalf("subtree not removed: %v", h.st.scenes["lcars"].ids())
	}
}

func TestAnimTracksAndLoops(t *testing.T) {
	h, r := newHub(t)
	mustExec(t, h, "gfx", "open s")
	mustExec(t, h, "gfx", "rect a 0 0 10 10")
	mustExec(t, h, "gfx", "anim a x=0..100 opacity=0.5 dur=2 ease=inOutQuad loop=inf yoyo name=pulse")
	op := r.last()
	tr := op["tracks"].(map[string]any)
	if op["op"] != "tween" || op["loop"] != -1 || op["yoyo"] != true || op["dur"] != 2.0 || op["id"] != "pulse" {
		t.Fatalf("op %v", op)
	}
	if tr["x"].(map[string]any)["from"] != 0.0 || tr["x"].(map[string]any)["to"] != 100.0 || tr["opacity"].(map[string]any)["to"] != 0.5 {
		t.Fatalf("tracks %v", tr)
	}
	// a looping tween survives in the snapshot, a finite one does not
	mustExec(t, h, "gfx", "anim a x=5 dur=1")
	snap := h.Snapshot()
	n := 0
	for _, o := range snap {
		if o["op"] == "tween" {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("snapshot tweens %d", n)
	}
	mustExec(t, h, "gfx", "stop pulse")
	for _, o := range h.Snapshot() {
		if o["op"] == "tween" {
			t.Fatal("stopped loop still in snapshot")
		}
	}
	if err := h.Exec("gfx", "anim a dur=1"); err == nil {
		t.Fatal("anim without tracks accepted")
	}
}

func TestTimeline(t *testing.T) {
	h, r := newHub(t)
	mustExec(t, h, "gfx", "open s")
	mustExec(t, h, "gfx", "rect a 0 0 10 10")
	mustExec(t, h, "gfx", "timeline intro loop=2")
	mustExec(t, h, "gfx", "at intro 0.5 anim a x=100 dur=1")
	mustExec(t, h, "gfx", "at intro 2 set a fill=#f00")
	op := r.last()
	steps := op["steps"].([]Op)
	if op["op"] != "timeline" || len(steps) != 2 || steps[0]["at"] != 0.5 || steps[1]["do"].(Op)["op"] != "set" || op["loop"] != 2.0 {
		t.Fatalf("timeline %v", op)
	}
	if err := h.Exec("gfx", "at nope 1 set a x=1"); err == nil {
		t.Fatal("step on a missing timeline accepted")
	}
}

func TestBindVarsAndDedup(t *testing.T) {
	h, r := newHub(t)
	mustExec(t, h, "gfx", "open s")
	mustExec(t, h, "gfx", "text t 0 0 X")
	mustExec(t, h, "gfx", "bind t text STARDATE {lc_sd|%.1f}")
	op := r.last()
	if op["expr"] != "STARDATE {lc_sd|%.1f}" || op["prop"] != "text" {
		t.Fatalf("bind %v", op)
	}
	mustExec(t, h, "gfx", "_v lc_sd 47634.4")
	mustExec(t, h, "gfx", "_v lc_sd 47634.4") // unchanged: no second op
	mustExec(t, h, "gfx", "_v lc_name  SHUTTLE 12")
	h.Flush()
	var vars []Op
	for _, o := range r.ops {
		if o["op"] == "vars" {
			vars = append(vars, o)
		}
	}
	if len(vars) != 2 { // the repeated value produced nothing
		t.Fatalf("vars ops %v", vars)
	}
	if vars[0]["vars"].(map[string]any)["lc_sd"] != 47634.4 || vars[1]["vars"].(map[string]any)["lc_name"] != "SHUTTLE 12" {
		t.Fatalf("vars %v", vars)
	}
}

func TestEventsRunTheAttachedCommand(t *testing.T) {
	h, r := newHub(t)
	mustExec(t, h, "gfx", "open s")
	mustExec(t, h, "gfx", "button b1 0 0 100 30 SENSORS")
	mustExec(t, h, "gfx", "on b1 click /lcars sens $id at $x,$y")
	if op := r.last(); op["op"] != "on" || !reflect.DeepEqual(op["events"], []string{"click"}) {
		t.Fatalf("on op %v", op)
	}
	if err := h.Event("s", "b1", "click", 12.7, 3); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(r.ran, []string{"/lcars sens b1 at 12,3"}) {
		t.Fatalf("ran %v", r.ran)
	}
	_ = h.Event("s", "b1", "enter", 0, 0) // no handler: nothing runs
	if len(r.ran) != 1 {
		t.Fatal("event without handler ran something")
	}
	if err := h.Exec("gfx", "on b1 smell /x"); err == nil {
		t.Fatal("bad event accepted")
	}
	mustExec(t, h, "gfx", "button b1.bg_dummy 0 0 1 1 X") // dotted ids of composites resolve through the parent
	mustExec(t, h, "gfx", "state b1.bg hover fill=#fff dur=0.1")
}

func TestSnapshotRebuildsScene(t *testing.T) {
	h, _ := newHub(t)
	mustExec(t, h, "gfx", "open s w=800 h=600")
	mustExec(t, h, "gfx", "group g")
	mustExec(t, h, "gfx", "rect r 0 0 5 5 parent=g")
	mustExec(t, h, "gfx", "bind r w =lc_x*2")
	mustExec(t, h, "gfx", "_v lc_x 3")
	mustExec(t, h, "canvas", "new cv 10 2")
	mustExec(t, h, "canvas", "disc cv 5 2 3 #ff0000")
	ops := h.Snapshot()
	var kinds []string
	for _, o := range ops {
		kinds = append(kinds, o["op"].(string))
	}
	want := []string{"scene", "vars", "create", "create", "bind", "scene", "vars", "create", "draw"}
	if !reflect.DeepEqual(kinds, want) {
		t.Fatalf("snapshot ops %v want %v", kinds, want)
	}
	if ops[0]["w"] != 800.0 || ops[3]["parent"] != "g" {
		t.Fatalf("snapshot content %v", ops[:4])
	}
	// the batch is valid JSON for the window
	if _, err := json.Marshal(ops); err != nil {
		t.Fatal(err)
	}
}

func TestCanvasFamilyFollowsTheDocumentedGrammar(t *testing.T) {
	h, r := newHub(t)
	mustExec(t, h, "canvas", "new hdr 120 4 #000000")
	op := r.last()
	p := op["props"].(map[string]any)
	if op["type"] != "pixelcanvas" || p["w"] != 120.0 || p["h"] != 8.0 { // 4 cells = 8 pixels
		t.Fatalf("new %v", op)
	}
	for _, c := range []string{
		"px hdr 1 2 #ff9900", "line hdr 0 0 10 10 #fff t=1.5", "rect hdr 0 0 5 5 red", "fill hdr 16 4 4 4 #ff9900",
		"rrect hdr 0 0 16 8 8 #ff9900 corners=tl,bl", "circle hdr 4 4 2 #fff t=2", "disc hdr 20 8 4 #000000 a=0.5",
		"ellipse hdr 5 5 3 2 #fff", "arc hdr 12 34 0 22 300 80 #123470 a=0.9", "poly hdr #2a5fb0 1 2 3 4 5 6 7 8",
		"glow hdr 4 4 6 #5ad1ff a=0.9", "grad hdr 0 0 10 4 #f00 #00f v", "stars hdr 0 0 100 28 90 7 t=0.5",
		"text hdr 18 0 #000000 bold=1 U.S.S.  ENDEAVOUR   NCC-1701-F", "clear hdr", "clear hdr #102030",
	} {
		mustExec(t, h, "canvas", c)
	}
	// text keeps its spacing
	var txt Op
	for _, o := range r.ops {
		if o["cmd"] == "text" {
			txt = o
		}
	}
	if txt["text"] != "U.S.S.  ENDEAVOUR   NCC-1701-F" || txt["bold"] != true {
		t.Fatalf("text %v", txt)
	}
	for _, c := range []string{"px nope 1 2 red", "px hdr 1 red", "px hdr 1 2 notacolor", "arc hdr 1 2 3 4 5 #fff", "frob hdr", "new x 0 4", "poly hdr red 1 2 3 4", "rect hdr 0 0 5 5 red a=2"} {
		if err := h.Exec("canvas", c); err == nil {
			t.Errorf("/canvas %s should fail", c)
		}
	}
	// the clear resets the journal that rebuilds the canvas
	n := 0
	for _, o := range h.Snapshot() {
		if o["op"] == "draw" {
			n++
		}
	}
	if n != 1 { // only the last clear remains
		t.Fatalf("journal after clear: %d", n)
	}
	// canvases start hidden until shown
	if p["visible"] != false {
		t.Fatal("canvas should start hidden")
	}
	mustExec(t, h, "canvas", "show hdr 10 20 2")
	if sp := r.last()["props"].(map[string]any); sp["visible"] != true || sp["scale"] != 2.0 {
		t.Fatalf("show %v", sp)
	}
}

func TestLoadAndDump(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.gfx"), []byte("; comment\n/gfx open z\n/gfx rect q 1 2 3 4 fill=red\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	h, _ := newHub(t)
	h.Dirs = []string{dir}
	mustExec(t, h, "gfx", "load a.gfx")
	if _, ok := h.st.scenes["z"].nodes["q"]; !ok {
		t.Fatal("load did not create q")
	}
	out := filepath.Join(dir, "d.json")
	mustExec(t, h, "gfx", "dump "+out)
	h2, r2 := newHub(t)
	mustExec(t, h2, "gfx", "load "+out) // a dump is a loadable stream
	if len(r2.ops) < 2 {
		t.Fatalf("dump reload produced %v", r2.ops)
	}
	if err := h.Exec("gfx", "load missing.gfx"); err == nil {
		t.Fatal("missing file accepted")
	}
}

func TestBatchingDeliversOnceAndMergesVars(t *testing.T) {
	h := New()
	h.FlushDelay = 5 * 1e6 // 5ms
	got := make(chan []Op, 4)
	h.Emit = func(ops []Op) { got <- ops }
	_ = h.Exec("gfx", "open s")
	_ = h.Exec("gfx", "rect a 0 0 1 1")
	_ = h.Exec("gfx", "var x 1")
	_ = h.Exec("gfx", "var x 2")
	batch := <-got
	if len(batch) != 3 || batch[2]["op"] != "vars" || batch[2]["vars"].(map[string]any)["x"] != 2.0 {
		t.Fatalf("batch %v", batch)
	}
}

func TestApplyRawOpsLikeARemoteClient(t *testing.T) {
	h, r := newHub(t)
	h.Apply([]Op{
		{"op": "scene", "scene": "r", "open": true},
		{"op": "create", "scene": "r", "id": "a", "type": "circle", "props": map[string]any{"r": 4.0}},
		{"op": "set", "scene": "r", "id": "a", "props": map[string]any{"x": 3.0}},
	})
	if len(r.ops) != 3 || h.st.scenes["r"].nodes["a"].props["x"] != 3.0 {
		t.Fatalf("apply %v", r.ops)
	}
}

func TestWindowCloseEventUpdatesTheMirrorAndRunsTheHandler(t *testing.T) {
	h, r := newHub(t)
	mustExec(t, h, "gfx", "open s")
	mustExec(t, h, "gfx", "on #scene close /echo closed $scene")
	if err := h.Event("s", "#scene", "close", 0, 0); err != nil {
		t.Fatal(err)
	}
	if len(r.ran) != 1 || r.ran[0] != "/echo closed s" {
		t.Fatalf("ran %v", r.ran)
	}
	for _, o := range h.Snapshot() {
		if o["op"] == "scene" && o["open"] == true {
			t.Fatalf("a scene the window closed would reopen from the snapshot: %v", o)
		}
	}
}
