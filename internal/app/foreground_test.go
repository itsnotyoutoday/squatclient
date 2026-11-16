package app

import (
	"testing"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/testutil/fakemush"
	"github.com/itsnotyoutoday/squatclient/internal/config"
)

// A connection the user starts becomes the active tab; one that is asked not to take the focus (the startup auto-connect) leaves it alone.
func TestANewConnectionBecomesTheActiveTab(t *testing.T) {
	f := newFixture(t)
	a, b, c := fakemush.New(t), fakemush.New(t), fakemush.New(t)
	wa, _ := f.svc.SaveWorld(config.World{Name: "Alpha", Host: a.Host(), Port: a.Port()})
	wb, _ := f.svc.SaveWorld(config.World{Name: "Beta", Host: b.Host(), Port: b.Port()})
	wc, _ := f.svc.SaveWorld(config.World{Name: "Gamma", Host: c.Host(), Port: c.Port()})
	sa, err := f.svc.Connect(ConnectTarget{WorldID: wa.ID})
	if err != nil {
		t.Fatal(err)
	}
	if got := f.svc.eng.Foreground(); got != sa.ID {
		t.Fatalf("the first connection is active: %q want %q", got, sa.ID)
	}
	sb, err := f.svc.Connect(ConnectTarget{WorldID: wb.ID})
	if err != nil {
		t.Fatal(err)
	}
	if got := f.svc.eng.Foreground(); got != sb.ID {
		t.Fatalf("a connection the user starts becomes the active tab: %q want %q (the first one stayed in front)", got, sb.ID)
	}
	// the window only learns through the event, so it must be emitted for the world just connected
	// the window only learns through the event, so it must be emitted for the world just connected
	lastFg := func() string {
		out := ""
		for _, e := range f.events("foreground") {
			if m, ok := e.Payload.(map[string]string); ok {
				out = m["session"]
			}
		}
		return out
	}
	f.until("the window is told which tab to show", func() bool { return lastFg() == sb.ID })
	if _, err := f.svc.Connect(ConnectTarget{WorldID: wc.ID, NoFocus: true}); err != nil {
		t.Fatal(err)
	}
	if got := f.svc.eng.Foreground(); got != sb.ID {
		t.Fatalf("NoFocus leaves the active tab alone: %q want %q", got, sb.ID)
	}
}
