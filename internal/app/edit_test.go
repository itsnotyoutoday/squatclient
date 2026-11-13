package app

import (
	"bytes"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/testutil/fakemush"
)

// editGame answers the softcode the editor sends, with canned data, so the
// binding tests need no real MUSH. It records every command line.
type editGame struct {
	mu    sync.Mutex
	log   []string
	attrs map[string]string
	stop  chan struct{}
	wg    sync.WaitGroup
	// extra, when set, may answer a `think` argument before the built-in replies
	extra func(arg string) []string
}

func startEditGame(t *testing.T, srv *fakemush.Server) *editGame {
	g := &editGame{attrs: map[string]string{"DESC": "line1%rline2"}, stop: make(chan struct{})}
	p := srv.Peer()
	g.wg.Add(1)
	go func() {
		defer g.wg.Done()
		done := 0
		for {
			select {
			case <-g.stop:
				return
			case <-time.After(time.Millisecond):
			}
			raw := p.Received()
			for {
				i := bytes.IndexByte(raw[done:], '\n')
				if i < 0 {
					break
				}
				line := raw[done : done+i]
				done += i + 1
				if j := bytes.LastIndexByte(line, 0xf0); j >= 0 { // drop telnet bytes before the text
					line = line[j+1:]
				}
				for _, l := range g.answer(strings.TrimSuffix(string(line), "\r")) {
					p.SendLine(l)
				}
			}
		}
	}()
	t.Cleanup(func() { close(g.stop); g.wg.Wait() })
	return g
}

func (g *editGame) commands() []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return append([]string(nil), g.log...)
}

func (g *editGame) answer(cmd string) []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.log = append(g.log, cmd)
	switch {
	case strings.HasPrefix(cmd, "think "):
		arg := strings.TrimPrefix(cmd, "think ")
		if g.extra != nil {
			if out := g.extra(arg); out != nil {
				return out
			}
		}
		switch {
		case strings.Contains(arg, "-O:#999"), strings.Contains(arg, "(#999)"):
			return []string{strings.SplitN(arg, ":", 2)[0] + ":#-1 NO MATCH" + strings.Repeat("^|^#-1 NO MATCH", 5)}
		case strings.Contains(arg, "-O:"):
			return []string{strings.SplitN(arg, ":", 2)[0] + ":#123^|^Widget^|^#45^|^WD^|^THING^|^#10"}
		case strings.Contains(arg, "-L:"):
			return []string{strings.SplitN(arg, ":", 2)[0] + ":DESC"}
		case strings.Contains(arg, "-V:"):
			tag := strings.SplitN(arg, ":", 2)[0]
			name := arg[strings.Index(arg, "hasattr(#123,")+len("hasattr(#123,"):]
			name = strings.ToUpper(name[:strings.IndexByte(name, ')')])
			v, ok := g.attrs[name]
			if !ok {
				return []string{tag + ":0^|^"}
			}
			return []string{tag + ":1^|^" + v}
		}
		return []string{arg}
	case strings.HasPrefix(cmd, "&"):
		head, val, _ := strings.Cut(cmd[1:], "=")
		name, _, _ := strings.Cut(head, " ")
		g.attrs[strings.ToUpper(name)] = val
		return []string{"Set."}
	}
	return nil
}

func TestEditBindings(t *testing.T) {
	f := newFixture(t)
	srv := fakemush.New(t)
	si, err := f.svc.Connect(ConnectTarget{Host: srv.Host(), Port: srv.Port()})
	if err != nil {
		t.Fatal(err)
	}
	f.waitConnected(si.ID)
	g := startEditGame(t, srv)

	o := f.svc.EditFetchObject(si.ID, "#123")
	if !o.Ok || o.Dbref != "#123" || o.Name != "Widget" || o.Owner != "#45" || o.Type != "THING" || len(o.Attrs) != 1 || o.Attrs[0].Name != "DESC" {
		t.Fatalf("object: %+v", o)
	}
	a := f.svc.EditFetchAttr(si.ID, "#123", "DESC")
	if !a.Ok || !a.Exists || a.Value != "line1%rline2" || a.Editable != "line1\nline2" {
		t.Fatalf("attr: %+v", a)
	}
	if a = f.svc.EditFetchAttr(si.ID, "#123", "NOPE"); !a.Ok || a.Exists {
		t.Fatalf("missing attr: %+v", a)
	}
	// editor text with real newlines is stored with %r
	if r := f.svc.EditSaveAttr(si.ID, "#123", "DESC", "new one\nnew two"); !r.Ok {
		t.Fatalf("save: %+v", r)
	}
	g.mu.Lock()
	got := g.attrs["DESC"]
	g.mu.Unlock()
	if got != "new one%rnew two" {
		t.Fatalf("stored %q", got)
	}

	// error shapes: messages and codes, never a Go error
	if o = f.svc.EditFetchObject(si.ID, "#999"); o.Ok || o.Code != "no_such_object" || o.Error == "" || o.Attrs == nil {
		t.Fatalf("no such object: %+v", o)
	}
	if o = f.svc.EditFetchObject(si.ID, "a;b"); o.Ok || o.Code != "invalid" {
		t.Fatalf("invalid: %+v", o)
	}
	if r := f.svc.EditSaveAttr(si.ID, "#123", "DESC", "100%\nx"); r.Ok || r.Code != "unsafe_value" {
		t.Fatalf("ambiguous: %+v", r)
	}
	if r := f.svc.EditSaveAttr("ghost", "#123", "DESC", "x"); r.Ok || r.Code != "no_session" {
		t.Fatalf("no session: %+v", r)
	}
	for _, c := range g.commands() {
		if strings.Contains(c, ";b") {
			t.Fatalf("unsafe object reached the game: %q", c)
		}
	}
	// nothing of it shows up in the UI's output events
	for _, ev := range f.events("line") {
		if strings.Contains(ev.JSON, "SQUATCAP") {
			t.Fatalf("capture text in UI output: %s", ev.JSON)
		}
	}
}
