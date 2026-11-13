package app

import (
	"bytes"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/testutil/fakemush"
)

// propsGame answers the details softcode for one object (#123) and the
// @set / @tel commands, with canned data.
type propsGame struct {
	mu    sync.Mutex
	log   []string
	flags []string
	loc   string
	stop  chan struct{}
	wg    sync.WaitGroup
}

func startPropsGame(t *testing.T, srv *fakemush.Server) *propsGame {
	g := &propsGame{flags: []string{"DARK"}, loc: "#10", stop: make(chan struct{})}
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
				if j := bytes.LastIndexByte(line, 0xf0); j >= 0 {
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

func (g *propsGame) commands() []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return append([]string(nil), g.log...)
}

func (g *propsGame) answer(cmd string) []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.log = append(g.log, cmd)
	switch {
	case strings.HasPrefix(cmd, "think "):
		arg := cmd[6:]
		tag, _, _ := strings.Cut(arg, ":")
		switch {
		case strings.Contains(arg, "-H:[num(#999)]"):
			return []string{tag + ":#-1 NO MATCH" + strings.Repeat("^|^#-1 NO MATCH", 9)}
		case strings.Contains(arg, "-H:"):
			return []string{tag + ":#123^|^Widget^|^THING^|^#45^|^#-1^|^#-1^|^" + g.loc + "^|^#10^|^7^|^1"}
		case strings.Contains(arg, "-N:"):
			return []string{tag + ":Nveid^|^#-1 NO MATCH^|^#-1 NO MATCH^|^Lobby^|^Lobby"}
		case strings.Contains(arg, "-T:"):
			return []string{tag + ":#-1 FUNCTION (CTIME) NOT FOUND^|^#-1 FUNCTION (CREATED) NOT FOUND^|^#-1 FUNCTION (MTIME) NOT FOUND"}
		case strings.Contains(arg, "-F:"):
			return []string{tag + ":" + strings.Join(g.flags, " ") + "^|^D"}
		case strings.Contains(arg, "-P:"):
			return []string{tag + ":^|^"}
		case strings.Contains(arg, "-K:"):
			return []string{tag + ":Basic~:~#45"}
		case strings.Contains(arg, "-C:"), strings.Contains(arg, "-X:"):
			return []string{tag + ":"}
		}
		return []string{arg}
	case strings.HasPrefix(cmd, "@set #123="):
		f := cmd[len("@set #123="):]
		if f == "WIZARD" {
			return []string{"Permission denied."}
		}
		if strings.HasPrefix(f, "!") {
			var n []string
			for _, x := range g.flags {
				if x != f[1:] {
					n = append(n, x)
				}
			}
			g.flags = n
			return []string{"Flag reset."}
		}
		g.flags = append(g.flags, f)
		return []string{"Flag set."}
	case strings.HasPrefix(cmd, "examine"):
		return []string{"\x1b[1mWidget\x1b[0m", "Owner: Nveid"}
	case strings.HasPrefix(cmd, "@tel #123="):
		g.loc = cmd[len("@tel #123="):]
		return []string{"Teleported."}
	}
	return nil
}

func TestEditPropsBindings(t *testing.T) {
	f := newFixture(t)
	srv := fakemush.New(t)
	si, err := f.svc.Connect(ConnectTarget{Host: srv.Host(), Port: srv.Port()})
	if err != nil {
		t.Fatal(err)
	}
	f.waitConnected(si.ID)
	g := startPropsGame(t, srv)

	d := f.svc.EditDetails(si.ID, "#123")
	if !d.Ok || d.Details.Name != "Widget" || d.Details.Type != "thing" || d.Details.Location != "#10" ||
		d.Details.Pennies == nil || *d.Details.Pennies != 7 || len(d.Details.Flags) != 1 || len(d.Details.Locks) != 1 ||
		d.Details.Locks[0].Expr != "#45" || d.Details.Names["#45"] != "Nveid" || d.Details.Names["#10"] != "Lobby" || d.Details.Created != "" || d.Details.Contents == nil || d.Details.Powers == nil {
		t.Fatalf("details: %+v", d)
	}
	if d = f.svc.EditDetails(si.ID, "#999"); d.Ok || d.Code != "no_such_object" || d.Details.Flags == nil {
		t.Fatalf("missing: %+v", d)
	}
	if d = f.svc.EditDetails("ghost", "#123"); d.Ok || d.Code != "no_session" {
		t.Fatalf("no session: %+v", d)
	}
	r := f.svc.EditSetFlag(si.ID, "#123", "VISUAL", true)
	if !r.Ok || r.Reply != "Flag set." || len(r.Details.Flags) != 2 {
		t.Fatalf("set flag: %+v", r)
	}
	r = f.svc.EditSetFlag(si.ID, "#123", "VISUAL", false)
	if !r.Ok || len(r.Details.Flags) != 1 {
		t.Fatalf("unset: %+v", r)
	}
	// refused: the exact reply and the unchanged state come back
	r = f.svc.EditSetFlag(si.ID, "#123", "WIZARD", true)
	if r.Ok || r.Code != "permission" || r.Reply != "Permission denied." || len(r.Details.Flags) != 1 {
		t.Fatalf("refused: %+v", r)
	}
	if r = f.svc.EditMove(si.ID, "#123", "#11"); !r.Ok || r.Details.Location != "#11" {
		t.Fatalf("move: %+v", r)
	}
	if r = f.svc.EditMove(si.ID, "#123", "x;y"); r.Ok || r.Code != "invalid" {
		t.Fatalf("invalid: %+v", r)
	}
	if r = f.svc.EditSetFlag(si.ID, "#123", "A B", true); r.Ok || r.Code != "invalid" {
		t.Fatalf("invalid flag: %+v", r)
	}
	if s := f.svc.EditSearchRooms(si.ID, "a;b"); s.Ok || s.Code != "invalid" || s.Items == nil {
		t.Fatalf("search invalid: %+v", s)
	}
	ex := f.svc.EditExamine(si.ID, "#123", "all")
	if !ex.Ok || len(ex.Lines) != 2 || ex.Lines[0][0].S != "Widget" || !ex.Lines[0][0].B {
		t.Fatalf("examine: %+v", ex)
	}
	if ex = f.svc.EditExamine(si.ID, "#123", "x;y"); ex.Ok || ex.Code != "invalid" {
		t.Fatalf("examine invalid: %+v", ex)
	}
	if r := f.svc.EditDeleteAttr(si.ID, "#123", "A/B"); r.Ok || r.Code != "invalid" {
		t.Fatalf("delete invalid: %+v", r)
	}
	if r := f.svc.EditTestLock(si.ID, "#123", "Basic", "a;b"); r.Ok || r.Code != "invalid" || r.Result != "unknown" {
		t.Fatalf("testlock invalid: %+v", r)
	}
	for _, c := range g.commands() {
		if strings.Contains(c, ";y") || strings.Contains(c, "A B") {
			t.Fatalf("unsafe input reached the game: %q", c)
		}
	}
	// silent: no capture text, no game replies in the UI output, nothing typed
	for _, ev := range f.events("line") {
		if strings.Contains(ev.JSON, "SQUATCAP") || strings.Contains(ev.JSON, "Flag set") || strings.Contains(ev.JSON, "Permission denied") {
			t.Fatalf("details traffic in the UI output: %s", ev.JSON)
		}
	}
	if h, err := f.svc.History(si.ID, "", HistoryOpts{Limit: 50}); err == nil && len(h.Entries) != 0 {
		t.Fatalf("history entries: %+v", h.Entries)
	}
}
