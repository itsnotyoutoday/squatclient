package app

import (
	"strings"
	"testing"
	"time"
)

// The console is reachable through the service: its start-up lines, and commands typed into it.
func TestConsoleThroughTheService(t *testing.T) {
	f := newFixture(t)
	lines := f.svc.ConsoleLines(0)
	if len(lines) == 0 || !strings.Contains(lines[0].Plain(), "SquatClient") {
		t.Fatalf("the console starts with a banner: %v", lines)
	}
	if err := f.svc.ConsoleInput("/echo typed in the console"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(150 * time.Millisecond)
	found := false
	for _, l := range f.svc.ConsoleLines(lines[len(lines)-1].Seq) {
		if strings.Contains(l.Plain(), "typed in the console") {
			found = true
		}
	}
	if !found {
		t.Fatalf("the command's output is in the console: %v", f.svc.ConsoleLines(0))
	}
	if evs := f.events("console"); len(evs) == 0 {
		t.Fatal("console lines are emitted as `console` events")
	}
}
