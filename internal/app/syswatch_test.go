package app

import (
	"testing"
	"time"
)

func TestSysWatcher(t *testing.T) {
	w := &sysWatcher{}
	t0 := time.Unix(1000, 0)
	if r := w.step(t0, "en0=10.0.0.2"); r != "" {
		t.Fatalf("the first look is not a change: %q", r)
	}
	if r := w.step(t0.Add(2*time.Second), "en0=10.0.0.2"); r != "" {
		t.Fatalf("nothing changed: %q", r)
	}
	if r := w.step(t0.Add(4*time.Second), "en0=10.0.0.9"); r != "network" {
		t.Fatalf("a new address is a network change: %q", r)
	}
	if r := w.step(t0.Add(6*time.Second), "en0=10.0.0.9"); r != "" {
		t.Fatalf("settled again: %q", r)
	}
	if r := w.step(t0.Add(6*time.Second+time.Hour), "en0=10.0.0.9"); r != "resume" {
		t.Fatalf("an hour-late tick is a wake from sleep: %q", r)
	}
	if r := w.step(t0.Add(8*time.Second+time.Hour), ""); r != "" {
		t.Fatalf("going offline is nothing to retry yet: %q", r)
	}
	if r := w.step(t0.Add(10*time.Second+time.Hour), "en0=10.0.0.9"); r != "network" {
		t.Fatalf("the network coming back (even with the same address) is a change: %q", r)
	}
	if r := w.step(t0.Add(12*time.Second+time.Hour), "en0=10.0.0.9"); r != "" {
		t.Fatalf("and then it is settled: %q", r)
	}
}

func TestCmcpProtos(t *testing.T) {
	if got := cmcpProtos(); len(got) != 1 || got[0] != 2 {
		t.Fatalf("a new build speaks only CMCP 2: %v", got)
	}
	t.Setenv("SQUATCLIENT_CMCP_PROTO", "1")
	if got := cmcpProtos(); len(got) != 1 || got[0] != 1 {
		t.Fatalf("v1 only: %v", got)
	}
}
