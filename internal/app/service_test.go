package app

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/proto"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/testutil/fakemush"

	"github.com/itsnotyoutoday/squatclient/internal/config"
	"github.com/itsnotyoutoday/squatclient/internal/secrets"
)

type captured struct {
	Name    string
	Payload any
	JSON    string
}

type fixture struct {
	t    *testing.T
	svc  *Service
	sec  *secrets.Memory
	cfg  *config.Store
	dir  string
	mu   sync.Mutex
	evs  []captured
	quit chan struct{}

	windows []string
}

func newFixture(t *testing.T) *fixture { return newFixtureAt(t, t.TempDir(), secrets.NewMemory()) }

// newFixtureAt builds a service on an existing directory and keychain (to
// model an app restart).
func newFixtureAt(t *testing.T, dir string, sec *secrets.Memory) *fixture {
	t.Helper()
	cs, err := config.Open(filepath.Join(dir, "cfg"))
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{t: t, sec: sec, cfg: cs, dir: dir, quit: make(chan struct{}, 1)}
	svc, err := New(Options{
		Config: cs, Secrets: f.sec, OnQuit: func() { f.quit <- struct{}{} },
		OnWindow: func(a string) { f.mu.Lock(); f.windows = append(f.windows, a); f.mu.Unlock() },
		Emit: func(name string, p any) {
			b, _ := json.Marshal(p)
			f.mu.Lock()
			f.evs = append(f.evs, captured{name, p, string(b)})
			f.mu.Unlock()
		},
		Engine: engine.Options{ConfigDir: filepath.Join(dir, "scripts")},
	})
	if err != nil {
		t.Fatal(err)
	}
	f.svc = svc
	svc.Start()
	t.Cleanup(svc.Shutdown)
	return f
}

func (f *fixture) events(name string) []captured {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []captured
	for _, e := range f.evs {
		if e.Name == name {
			out = append(out, e)
		}
	}
	return out
}

func (f *fixture) until(what string, pred func() bool) {
	f.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if pred() {
			return
		}
		time.Sleep(3 * time.Millisecond)
	}
	f.t.Fatalf("timeout waiting for %s", what)
}

func (f *fixture) waitLine(sub string) {
	f.t.Helper()
	f.until("line "+sub, func() bool {
		for _, e := range f.events("line") {
			if strings.Contains(e.JSON, sub) {
				return true
			}
		}
		return false
	})
}

func (f *fixture) waitConnected(id string) {
	f.t.Helper()
	f.until("connected", func() bool {
		si, err := f.svc.eng.Session(id)
		return err == nil && si.State == proto.StateConnected
	})
}

func TestWorldCRUDAndPasswordNeverOnDisk(t *testing.T) {
	f := newFixture(t)
	w, err := f.svc.SaveWorld(config.World{Name: "Trek", Host: "h", Port: 1701, Login: &config.Login{Template: "connect {name} {password}", CharName: "kirk"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.SetWorldPassword(w.ID, "hunter2"); err != nil {
		t.Fatal(err)
	}
	ws, _ := f.svc.ListWorlds()
	if len(ws) != 1 || !ws[0].Login.HasPassword {
		t.Fatalf("hasPassword not set: %+v", ws)
	}
	filepath.Walk(f.dir, func(p string, info os.FileInfo, _ error) error {
		if info != nil && !info.IsDir() {
			if b, _ := os.ReadFile(p); strings.Contains(string(b), "hunter2") {
				t.Fatalf("password found on disk in %s", p)
			}
		}
		return nil
	})
	if err := f.svc.SetWorldPassword(w.ID, ""); err != nil {
		t.Fatal(err)
	}
	if ws, _ = f.svc.ListWorlds(); ws[0].Login.HasPassword {
		t.Fatal("hasPassword should clear")
	}
	if err := f.svc.SetWorldPassword("nope", "x"); err == nil {
		t.Fatal("unknown world must fail")
	}
	f.sec.Fail = true
	if err := f.svc.SetWorldPassword(w.ID, "x"); !errors.Is(err, secrets.ErrUnavailable) {
		t.Fatalf("want keychain error, got %v", err)
	}
	f.sec.Fail = false
	if err := f.svc.DeleteWorld(w.ID); err != nil {
		t.Fatal(err)
	}
}

func TestConnectWorldLoginUsesKeychain(t *testing.T) {
	f := newFixture(t)
	srv := fakemush.New(t, fakemush.WithGreeting("hi\r\n"))
	w, _ := f.svc.SaveWorld(config.World{Name: "T", Host: srv.Host(), Port: srv.Port(),
		Login: &config.Login{Template: "connect {name} {password}", CharName: "kirk", DelayMs: 20}})
	_ = f.svc.SetWorldPassword(w.ID, "hunter2")
	si, err := f.svc.Connect(ConnectTarget{WorldID: w.ID})
	if err != nil {
		t.Fatal(err)
	}
	if si.WorldID != w.ID || si.Via != "direct" || si.Name != "T" {
		t.Fatalf("bad info %+v", si)
	}
	srv.ExpectLine("connect kirk hunter2")
	f.waitLine("hi")
	for _, e := range f.events("line") {
		if strings.Contains(e.JSON, "hunter2") {
			t.Fatal("password leaked to UI")
		}
	}
	// keychain failure refuses to connect instead of sending an empty password
	f.sec.Fail = true
	if _, err := f.svc.Connect(ConnectTarget{WorldID: w.ID}); err == nil {
		t.Fatal("expected keychain error")
	}
}

func TestAdHocConnectAndValidation(t *testing.T) {
	f := newFixture(t)
	srv := fakemush.New(t)
	si, err := f.svc.Connect(ConnectTarget{Host: srv.Host(), Port: srv.Port()})
	if err != nil || si.WorldID != "" {
		t.Fatalf("%v %+v", err, si)
	}
	f.waitConnected(si.ID)
	if _, err := f.svc.Connect(ConnectTarget{Host: "", Port: 1}); err == nil {
		t.Fatal("empty host accepted")
	}
	if _, err := f.svc.Connect(ConnectTarget{WorldID: "ghost"}); err == nil {
		t.Fatal("unknown world accepted")
	}
}

func TestEventsInputScrollbackSearchAck(t *testing.T) {
	f := newFixture(t)
	srv := fakemush.New(t)
	si, _ := f.svc.Connect(ConnectTarget{Host: srv.Host(), Port: srv.Port()})
	f.waitConnected(si.ID)
	f.until("foreground event", func() bool { return len(f.events("foreground")) > 0 })
	if got := f.events("foreground")[0].JSON; got != `{"session":"`+si.ID+`"}` {
		t.Fatalf("foreground payload %s", got)
	}
	for i := 1; i <= 30; i++ {
		srv.SendLine("n" + itoa(i))
	}
	f.waitLine(`"n30"`)
	// lines arrive in seq order, each exactly once
	last := uint64(0)
	for _, e := range f.events("line") {
		l := e.Payload.(*proto.Line)
		if l.Seq <= last {
			t.Fatalf("out of order seq %d after %d", l.Seq, last)
		}
		last = l.Seq
	}
	if err := f.svc.Input(si.ID, "look"); err != nil {
		t.Fatal(err)
	}
	srv.ExpectLine("look")
	f.waitLine(`"echo"`)

	page, err := f.svc.Scrollback(si.ID, ScrollbackOpts{Limit: 10})
	if err != nil || len(page) != 10 {
		t.Fatalf("page %v %d", err, len(page))
	}
	older, _ := f.svc.Scrollback(si.ID, ScrollbackOpts{BeforeSeq: page[0].Seq, Limit: 10})
	if len(older) != 10 || older[9].Seq != page[0].Seq-1 {
		t.Fatal("paging broken")
	}
	hits, _ := f.svc.Search(si.ID, "n1", SearchOpts{})
	if len(hits) != 11 {
		t.Fatalf("hits=%d", len(hits))
	}
	if h, _ := f.svc.Search(si.ID, "zzzz", SearchOpts{}); h == nil {
		t.Fatal("empty search must be [] not null")
	}
	list, _ := f.svc.ListSessions()
	if len(list) != 1 || list[0].Unread < 30 {
		t.Fatalf("unread %+v", list)
	}
	_ = f.svc.Ack(si.ID, last)
	f.until("unread cleared via session event", func() bool {
		evs := f.events("session")
		return len(evs) > 0 && evs[len(evs)-1].Payload.(*engine.SessionInfo).Unread == 0
	})
	// sessions events are coalesced (far fewer than lines)
	if n := len(f.events("session")); n > 15 {
		t.Fatalf("session events not batched: %d", n)
	}
}

func TestDismissEmitsRemovedAndNeverResurrects(t *testing.T) {
	f := newFixture(t)
	srv := fakemush.New(t)
	si, _ := f.svc.Connect(ConnectTarget{Host: srv.Host(), Port: srv.Port()})
	f.waitConnected(si.ID)
	if err := f.svc.Disconnect(si.ID); err != nil {
		t.Fatal(err)
	}
	f.until("ended", func() bool {
		evs := f.events("session")
		return len(evs) > 0 && evs[len(evs)-1].Payload.(*engine.SessionInfo).State == proto.StateEnded
	})
	if err := f.svc.Dismiss(si.ID); err != nil {
		t.Fatal(err)
	}
	f.until("removed", func() bool { return len(f.events("session-removed")) == 1 })
	if got := f.events("session-removed")[0].JSON; got != `{"id":"`+si.ID+`"}` {
		t.Fatalf("payload %s", got)
	}
	f.mu.Lock()
	idx := -1
	for i, e := range f.evs {
		if e.Name == "session-removed" {
			idx = i
		}
	}
	for _, e := range f.evs[idx+1:] {
		if e.Name == "session" {
			t.Fatal("session event after removal would resurrect the tab")
		}
	}
	f.mu.Unlock()
	if l, _ := f.svc.ListSessions(); len(l) != 0 {
		t.Fatal("session still listed")
	}
}

func TestColoursByteExactThroughApp(t *testing.T) {
	f := newFixture(t)
	srv := fakemush.New(t)
	si, _ := f.svc.Connect(ConnectTarget{Host: srv.Host(), Port: srv.Port()})
	f.waitConnected(si.ID)
	srv.SendString("\x1b[38;5;196mred\x1b[0m \x1b[38;2;255;136;0mtc\x1b[0m \xc3\xa9\xe2\x9c\x93\r\n")
	f.waitLine(`"tc"`)
	want := `"spans":[{"s":"red","fg":196},{"s":" "},{"s":"tc","fg":"#ff8800"},{"s":" é✓"}]`
	for _, e := range f.events("line") {
		if strings.Contains(e.JSON, `"red"`) {
			if !strings.Contains(e.JSON, want) {
				t.Fatalf("event JSON\n got %s\nwant substring %s", e.JSON, want)
			}
			return
		}
	}
	t.Fatal("no colour line")
}

func TestSettingsAndQuit(t *testing.T) {
	f := newFixture(t)
	st, _ := f.svc.GetSettings()
	if st.Theme != "dark" || !st.Truecolor {
		t.Fatalf("%+v", st)
	}
	st.Theme = "light"
	st.ScreenReader = true
	if err := f.svc.SaveSettings(st); err != nil {
		t.Fatal(err)
	}
	st.ScrollbackLines = 1
	if f.svc.SaveSettings(st) == nil {
		t.Fatal("invalid settings accepted")
	}
	// /quit from a script reaches OnQuit
	srv := fakemush.New(t)
	si, _ := f.svc.Connect(ConnectTarget{Host: srv.Host(), Port: srv.Port()})
	f.waitConnected(si.ID)
	_ = f.svc.Input(si.ID, "/quit")
	select {
	case <-f.quit:
	case <-time.After(3 * time.Second):
		t.Fatal("quit not delivered")
	}
}

func TestShutdownClosesSessionsGracefully(t *testing.T) {
	f := newFixture(t)
	srv := fakemush.New(t)
	si, _ := f.svc.Connect(ConnectTarget{Host: srv.Host(), Port: srv.Port()})
	f.waitConnected(si.ID)
	done := make(chan struct{})
	go func() { f.svc.Shutdown(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown hung")
	}
	f.svc.Shutdown() // idempotent
}

func itoa(i int) string {
	b, _ := json.Marshal(i)
	return string(b)
}

func TestRenamingAnyConnectionKeepsWorldAndTabInAgreement(t *testing.T) {
	f := newFixture(t)
	srv := fakemush.New(t, fakemush.WithGreeting("hi\r\n"))
	w, _ := f.svc.SaveWorld(config.World{Name: "Old", Host: srv.Host(), Port: srv.Port()})
	si, err := f.svc.Connect(ConnectTarget{WorldID: w.ID})
	if err != nil {
		t.Fatal(err)
	}
	f.waitConnected(si.ID)

	// a saved world: the world and the open connection are renamed together
	if err := f.svc.RenameSession(si.ID, "New"); err != nil {
		t.Fatal(err)
	}
	ws, _ := f.svc.ListWorlds()
	cur, _ := f.svc.eng.Session(si.ID)
	if len(ws) != 1 || ws[0].Name != "New" || cur.Name != "New" {
		t.Fatalf("world %+v session %q", ws, cur.Name)
	}
	// editing the world's name (Worlds dialog) renames its open connection too
	ws[0].Name = "Newer"
	if _, err := f.svc.SaveWorld(ws[0]); err != nil {
		t.Fatal(err)
	}
	if cur, _ = f.svc.eng.Session(si.ID); cur.Name != "Newer" {
		t.Fatalf("the open connection kept the old name %q", cur.Name)
	}
	// a name another world has is refused
	if _, err := f.svc.SaveWorld(config.World{Name: "Other", Host: srv.Host(), Port: srv.Port()}); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.RenameSession(si.ID, "Other"); err == nil {
		t.Fatal("renamed onto an existing world")
	}
	if err := f.svc.RenameSession(si.ID, "  "); err == nil {
		t.Fatal("an empty name was accepted")
	}

	// a quick connect that is not a saved world: only the tab changes
	qi, err := f.svc.Connect(ConnectTarget{Host: srv.Host(), Port: srv.Port()})
	if err != nil {
		t.Fatal(err)
	}
	f.waitConnected(qi.ID)
	if err := f.svc.RenameSession(qi.ID, "just-a-tab"); err != nil {
		t.Fatal(err)
	}
	cur, _ = f.svc.eng.Session(qi.ID)
	ws, _ = f.svc.ListWorlds()
	if cur.Name != "just-a-tab" || len(ws) != 2 {
		t.Fatalf("tab %q, worlds %+v (a quick connect must not create a world)", cur.Name, ws)
	}
}
