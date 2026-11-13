package app

import (
	"strings"
	"testing"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/testutil/fakemush"
)

func TestEditWorkspaceBindings(t *testing.T) {
	f := newFixture(t)
	srv := fakemush.New(t)
	si, err := f.svc.Connect(ConnectTarget{Host: srv.Host(), Port: srv.Port()})
	if err != nil {
		t.Fatal(err)
	}
	f.waitConnected(si.ID)
	g := startEditGame(t, srv)
	g.mu.Lock()
	g.extra = func(arg string) []string {
		tag, body, _ := strings.Cut(arg, ":")
		switch {
		case strings.Contains(body, "[locate(me,Widget,*)]"):
			return []string{tag + ":#-1 NO MATCH^|^#123^|^#-1 NO MATCH^|^Widget"}
		case strings.Contains(body, "[locate(me,"):
			return []string{tag + ":#-1 NO MATCH^|^#-1 NO MATCH^|^#-1 NO MATCH^|^#-1 NO MATCH"}
		case strings.HasPrefix(body, "[controls(me,#123)]"):
			return []string{tag + ":1"}
		case strings.HasPrefix(body, "[controls("):
			return []string{tag + ":0"}
		case strings.HasPrefix(body, "[owner("):
			return []string{tag + ":#1^|^#45"}
		case strings.HasPrefix(body, "[flags(#123/DESC)]"):
			return []string{tag + ":+S^|^locked safe^|^#45"}
		case strings.HasPrefix(body, "[flags("):
			return []string{tag + ":#-1 NO SUCH ATTR^|^#-1 NO SUCH ATTR^|^#-1 NO SUCH ATTR"}
		}
		return nil
	}
	g.mu.Unlock()

	if r := f.svc.EditResolve(si.ID, "Widget"); !r.Ok || r.Dbref != "#123" || r.Name != "Widget" {
		t.Fatalf("resolve: %+v", r)
	}
	if r := f.svc.EditResolve(si.ID, "Nobody"); r.Ok || r.Code != "no_such_object" {
		t.Fatalf("resolve missing: %+v", r)
	}
	if r := f.svc.EditResolve(si.ID, "a;b"); r.Ok || r.Code != "invalid" {
		t.Fatalf("resolve invalid: %+v", r)
	}
	if r := f.svc.EditControls(si.ID, "#123"); !r.Ok || r.Controls != "true" {
		t.Fatalf("controls: %+v", r)
	}
	if r := f.svc.EditControls(si.ID, "#200"); !r.Ok || r.Controls != "false" {
		t.Fatalf("controls: %+v", r)
	}
	if r := f.svc.EditControls("ghost", "#200"); r.Ok || r.Code != "no_session" || r.Controls != "unknown" {
		t.Fatalf("controls no session: %+v", r)
	}
	if r := f.svc.EditAttrInfo(si.ID, "#123", "DESC"); !r.Ok || !r.Known || r.Writable != "false" || r.Owner != "#45" {
		t.Fatalf("attrinfo: %+v", r)
	}
	if r := f.svc.EditAttrInfo(si.ID, "#123", "OTHER"); !r.Ok || r.Known || r.Writable != "unknown" {
		t.Fatalf("attrinfo unknown: %+v", r)
	}
	if r := f.svc.EditAttrInfo(si.ID, "#123", "A/B"); r.Ok || r.Code != "invalid" {
		t.Fatalf("attrinfo invalid: %+v", r)
	}
	for _, c := range g.commands() {
		if strings.Contains(c, ";b") || strings.Contains(c, "A/B") {
			t.Fatalf("unsafe input reached the game: %q", c)
		}
	}
	for _, ev := range f.events("line") {
		if strings.Contains(ev.JSON, "SQUATCAP") {
			t.Fatalf("capture text in UI output: %s", ev.JSON)
		}
	}
}
