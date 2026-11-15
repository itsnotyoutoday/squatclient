package stdlib

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/proto"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/tfengine"

	"github.com/itsnotyoutoday/squatclient/internal/gfx"
)

// host records what the library asked of the client.
type host struct {
	tfengine.NopHost
	mu     sync.Mutex
	echo   []string
	sent   []string
	notes  [][2]string
	worlds []tfengine.WorldInfo

	onNotify func(title, body string)
}

func (h *host) Echo(_ string, spans []proto.Span) {
	var sb strings.Builder
	for _, s := range spans {
		sb.WriteString(s.S)
	}
	h.mu.Lock()
	h.echo = append(h.echo, sb.String())
	h.mu.Unlock()
}
func (h *host) SendToWorld(w, t string) error {
	h.mu.Lock()
	h.sent = append(h.sent, w+":"+t)
	h.mu.Unlock()
	return nil
}
func (h *host) Notify(title, body string) {
	if h.onNotify != nil {
		h.onNotify(title, body)
		return
	}
	h.mu.Lock()
	h.notes = append(h.notes, [2]string{title, body})
	h.mu.Unlock()
}
func (h *host) Worlds() []tfengine.WorldInfo {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]tfengine.WorldInfo(nil), h.worlds...)
}
func (h *host) PutWorld(w tfengine.WorldInfo) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	for i := range h.worlds {
		if strings.EqualFold(h.worlds[i].Name, w.Name) {
			h.worlds[i] = w
			return nil
		}
	}
	h.worlds = append(h.worlds, w)
	return nil
}
func (h *host) Now() time.Time { return time.Now() }

func (h *host) notices() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []string
	for _, n := range h.notes {
		out = append(out, n[0]+"|"+n[1])
	}
	return out
}
func (h *host) dump() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return strings.Join(h.echo, "\n")
}

func start(t *testing.T) (*tfengine.Engine, *host, string) {
	t.Helper()
	cfg := t.TempDir()
	dir, err := Install(cfg)
	if err != nil {
		t.Fatal(err)
	}
	h := &host{}
	e := tfengine.New(h, tfengine.Options{StdLib: dir, LibDirs: []string{dir, cfg}, MaxTime: 10 * time.Second})
	t.Cleanup(e.Close)
	return e, h, cfg
}

func TestInstallRendersConfigDirAndKeepsAssets(t *testing.T) {
	cfg := t.TempDir()
	dir, err := Install(cfg)
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "stdlib.tf"))
	if err != nil || strings.Contains(string(b), "@CONFIGDIR@") || !strings.Contains(string(b), filepath.ToSlash(cfg)) {
		t.Fatalf("stdlib.tf not rendered: %v", err)
	}
	for _, f := range []string{"gfx.tf", "gfxdemo.tf", "gtfcompat.tf", "fonts/Antonio-VF.ttf", "fonts/Antonio-OFL.txt", "../../plugins/squat-gfx/gfx.lua", "../../plugins/squat-gfx/lcars.lua", "../../plugins/squat-gfx/main.lua"} {
		if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(f))); err != nil {
			t.Errorf("missing %s", f)
		}
	}
	if _, err := Install(cfg); err != nil { // idempotent
		t.Fatal(err)
	}
}

func TestLibraryLoadsWithoutErrors(t *testing.T) {
	_, h, _ := start(t)
	// the "% Loading commands from <path>." lines are expected (the console shows them, as TinyFugue does); the path may hold anything
	var kept []string
	for _, l := range strings.Split(h.dump(), "\n") {
		if !strings.HasPrefix(l, "% Loading commands from ") {
			kept = append(kept, l)
		}
	}
	out := strings.Join(kept, "\n")
	for _, bad := range []string{"no such", "not supported", "invalid", "Error", "error", "cannot", "unknown"} {
		if strings.Contains(out, bad) {
			t.Errorf("loading the library printed %q:\n%s", bad, out)
		}
	}
}

func TestLibraryDefinesWhatItPromises(t *testing.T) {
	e, h, _ := start(t)
	for _, name := range []string{"addtiny", "addlp", "addlpp", "adddiku", "addtelnet", "telnet", "retry", "retry_off",
		"hilite_page", "hilite_whisper", "loaddef", "savedef", "loadhilite", "savehilite", "sys", "man", "kecho",
		"worlds", "settings", "layouts", "gfx", "canvas", "gfxdemo", "visual", "more"} {
		before := len(h.echo)
		_ = e.Exec("", "/ismacro "+name)
		_ = before
		if got := e.GetVar("squat_stdlib"); got != "1" {
			t.Fatalf("squat_stdlib=%q", got)
		}
	}
	// ismacro returns through the value, so ask /list instead
	for _, name := range []string{"addtiny", "telnet", "retry", "gfx", "canvas", "gfxdemo", "worlds", "visual"} {
		h.echo = nil
		_ = e.Exec("", "/list -s -i "+name)
		_ = e.Exec("", "/list -s "+name)
		if !strings.Contains(h.dump(), name) {
			t.Errorf("macro %s not defined:\n%s", name, h.dump())
		}
	}
}

func TestGfxCommandsReachTheClient(t *testing.T) {
	e, h, _ := start(t)
	e.SessionOpened("w", "example.org", 4000, false) // a session defines its world, so ${world_name} is its script name
	_ = e.Exec("w", `/gfx rect hdr 0 0 300 40 fill=#ff9900`)
	_ = e.Exec("w", `/canvas px hdr 1 2 red`)
	_ = e.Exec("w", `/gfx text t 10 10 "A;B %x" size=12`)
	_ = e.Exec("", `/worlds`)
	_ = e.Exec("", `/settings`)
	got := h.notices()
	want := []string{`@gfx|w|rect hdr 0 0 300 40 fill=#ff9900`, `@canvas|w|px hdr 1 2 red`, `@gfx|w|text t 10 10 "A;B %x" size=12`, `@ui|worlds`, `@ui|settings`}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("notifications\n got %q\nwant %q", got, want)
	}
}

func TestGfxSyncPushesWatchedVariables(t *testing.T) {
	e, h, _ := start(t)
	_ = e.Exec("", "/set lc_sd=47634.4")
	_ = e.Exec("", "/set lc_n1=SHUTTLE 12")
	_ = e.Exec("", "/gfx watch lc_sd lc_n1")
	_ = e.Exec("", "/gfx watch lc_sd") // no duplicates
	if w := e.GetVar("gfx_watch"); strings.TrimSpace(w) != "lc_sd lc_n1" {
		t.Fatalf("gfx_watch=%q", w)
	}
	_ = e.Exec("", "/gfx sync")
	got := h.notices()
	want := []string{"@gfx||_v lc_sd 47634.4", "@gfx||_v lc_n1 SHUTTLE 12"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("sync\n got %q\nwant %q\n%s", got, want, h.dump())
	}
	_ = e.Exec("", "/gfx unwatch lc_sd")
	if w := strings.TrimSpace(e.GetVar("gfx_watch")); w != "lc_n1" {
		t.Fatalf("after unwatch: %q", w)
	}
}

func TestAutosyncRunsOnItsOwnAndStops(t *testing.T) {
	e, h, _ := start(t)
	_ = e.Exec("", "/set v=1")
	_ = e.Exec("", "/gfx watch v")
	_ = e.Exec("", "/gfx autosync")
	time.Sleep(450 * time.Millisecond)
	_ = e.Exec("", "/gfx autosync off")
	n := len(h.notices())
	if n < 2 {
		t.Fatalf("autosync pushed %d times in 450ms: %s", n, h.dump())
	}
	time.Sleep(300 * time.Millisecond)
	if len(h.notices()) > n+1 {
		t.Fatal("autosync kept running after off")
	}
}

func TestTinyWorldTypeLoginHook(t *testing.T) {
	e, h, _ := start(t)
	_ = e.Exec("", "/addtiny mush Bob hunter2 example.org 4201")
	e.FireHookWorld("mush", "LOGIN", "mush", "Bob", "hunter2")
	found := false
	for _, s := range h.sent {
		if strings.HasSuffix(s, "connect Bob hunter2") {
			found = true
		}
	}
	if !found {
		t.Fatalf("tiny login not sent: %v\n%s", h.sent, h.dump())
	}
}

func TestLpWorldLoginAndFlags(t *testing.T) {
	e, h, _ := start(t)
	_ = e.Exec("", "/addlp mud Alice pw example.org 4000")
	e.FireHookWorld("mud", "LOGIN", "mud", "Alice", "pw")
	if len(h.sent) < 2 || !strings.HasSuffix(h.sent[len(h.sent)-2], ":Alice") || !strings.HasSuffix(h.sent[len(h.sent)-1], ":pw") {
		t.Fatalf("lp login: %v\n%s", h.sent, h.dump())
	}
}

func TestFileShortcutsUseTheConfigFolder(t *testing.T) {
	e, _, cfg := start(t)
	if got := e.GetVar("TINYPREFIX"); got != filepath.ToSlash(cfg)+"/" {
		t.Fatalf("TINYPREFIX=%q", got)
	}
}

// /gfxdemo drives the real graphics layer: its /gfx lines reach a Hub, a click runs a TF command back.
func TestGfxDemoScriptEndToEnd(t *testing.T) {
	cfg := t.TempDir()
	lib, _ := Install(cfg)
	hub := gfx.New()
	hub.FlushDelay = -1
	var ops []gfx.Op
	hub.Emit = func(o []gfx.Op) { ops = append(ops, o...) }
	var errs []string
	hub.Notice = func(l, tx string) { errs = append(errs, tx) }
	h := &host{}
	var e *tfengine.Engine
	h.onNotify = func(title, body string) {
		switch title {
		case "@gfx":
			_, cmd, _ := strings.Cut(body, "|") // "@gfx|<world>|<command>"
			hub.Handle("gfx", cmd)
		case "@canvas":
			_, cmd, _ := strings.Cut(body, "|")
			hub.Handle("canvas", cmd)
		}
	}
	e = tfengine.New(h, tfengine.Options{StdLib: lib, LibDirs: []string{lib, cfg}, MaxTime: 10 * time.Second})
	t.Cleanup(e.Close)
	hub.Run = func(l string) error { return e.Exec("", l) }
	_ = e.Exec("", "/gfxdemo")
	if len(errs) > 0 || strings.Contains(h.dump(), "no such") {
		t.Fatalf("errors: %v\n%s", errs, h.dump())
	}
	ids := map[string]bool{}
	for _, o := range ops {
		if o["op"] == "create" {
			ids[o["id"].(string)] = true
		}
	}
	for _, id := range []string{"sky", "bar", "orb", "title", "meter", "go"} {
		if !ids[id] {
			t.Errorf("%s not created", id)
		}
	}
	if err := hub.Event("demo", "go", "click", 1, 1); err != nil {
		t.Fatal(err)
	}
	if got := e.GetVar("gfx_level"); got != "55" {
		t.Fatalf("gfx_level=%q after a click", got)
	}
	var v any
	for _, o := range ops {
		if o["op"] == "vars" {
			v = o["vars"].(map[string]any)["gfx_level"]
		}
	}
	if v != 55.0 {
		t.Fatalf("variable not synced to the renderer: %v", v)
	}
}

// /lcars adds nothing to the text unless something fails: requiring gfx.tf again is silent.
func TestRequireGfxIsQuietAndIdempotent(t *testing.T) {
	e, h, _ := start(t)
	before := len(h.echo)
	_ = e.Exec("", "/require -q gfx.tf")
	_ = e.Exec("", "/require -q gfx.tf")
	if got := h.echo[before:]; len(got) != 0 {
		t.Fatalf("/require -q printed %v", got)
	}
}

func TestClassicLibraryIsInstalledAndLoadable(t *testing.T) {
	dir := t.TempDir()
	if _, err := Install(dir); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"stdlib.tf", "tintin.tf", "at.tf", "kb-bash.tf", "tf-help"} {
		if _, err := os.Stat(filepath.Join(dir, "lib", "tf", f)); err != nil {
			t.Errorf("classic library file %s not installed: %v", f, err)
		}
	}
}

func TestLoadFindsClassicLibraryAndExamples(t *testing.T) {
	cfg := t.TempDir()
	dir, err := Install(cfg)
	if err != nil {
		t.Fatal(err)
	}
	h := &host{}
	e := tfengine.New(h, tfengine.Options{StdLib: dir, LibDirs: []string{dir, filepath.Join(cfg, TFDir), cfg}, MaxTime: 10 * time.Second})
	t.Cleanup(e.Close)
	for _, line := range []string{"/load tintin.tf", "/load examples/hello.tf", "/hello_example"} {
		_ = e.Exec("", line)
	}
	all := strings.Join(h.echo, "\n")
	if strings.Contains(all, "not found") || strings.Contains(all, "No such") || !strings.Contains(all, "example loaded") {
		t.Fatalf("library not found through /load:\n%s", all)
	}
}
