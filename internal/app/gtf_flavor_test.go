package app

import (
	"errors"
	"net"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/testutil/tftest"

	"github.com/itsnotyoutoday/squatclient/internal/config"
	"github.com/itsnotyoutoday/squatclient/internal/secrets"
)

// "gtf" in the add-a-squatter dialog is a tf-squatterd record with flavor "gtf": the app then
// neither mirrors worlds into it nor offers automation takeover (gtf has no world.put and always
// runs its own triggers). The protocol itself is tested against the real gtf in
// gtf_integration_test.go (GTF_BIN); here the bridge simulator stands in for the wire.
func TestGTFFlavorIsStoredAndChangesBehaviour(t *testing.T) {
	sim := tftest.Start(t)
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	code := sim.PairCode(t, "admin")
	pr, err := f.svc.PairSquatter("127.0.0.1", sim.Port, "My gtf", code, config.FlavorGTF)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.ConfirmSquatter(pr.ID, true); err != nil {
		t.Fatal(err)
	}
	st := f.cfg.Squatters()
	if len(st) != 1 || st[0].Kind != config.KindTFSquatterd || st[0].Flavor != config.FlavorGTF || !st[0].IsGTF() {
		t.Fatalf("stored: %+v", st)
	}
	views, _ := f.svc.ListSquatters()
	if views[0].Flavor != config.FlavorGTF {
		t.Fatalf("the UI does not get the flavor: %+v", views[0])
	}
	if err := f.svc.SetSquatterAutomation(pr.ID, "client"); err == nil || !strings.Contains(err.Error(), "gtf") {
		t.Fatalf("automation choice for gtf: %v", err)
	}
	// saving a world routed through gtf mirrors nothing (the simulator would record a world.put)
	before := sim.Fake.Count("WORLD_PUT")
	if _, err := f.svc.SaveWorld(config.World{Name: "w", Host: "127.0.0.1", Port: 4000, Via: pr.ID}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond) // the mirror, if there were one, runs in the background
	if n := sim.Fake.Count("WORLD_PUT"); n != before {
		t.Fatalf("a world was mirrored into gtf (%d world.put)", n-before)
	}
}

func TestGTFPairingHintsNameGtfCommands(t *testing.T) {
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	if _, err := f.svc.PairSquatter("127.0.0.1", 1, "x", "", config.FlavorGTF); err == nil || !strings.Contains(err.Error(), "/pair") {
		t.Fatalf("missing code hint: %v", err)
	}
	_, err := f.svc.PairSquatter("127.0.0.1", 1, "x", "AAAA-BBBB", config.FlavorGTF)
	if err == nil || !strings.Contains(err.Error(), "squatter=on") {
		t.Fatalf("unreachable hint: %v", err)
	}
}

// A refused connection to a gtf on another machine says why: gtf's squatter listens on 127.0.0.1 only by default. Loopback hosts and other errors keep
// the generic hint.
func TestGTFRefusedRemoteHintNamesSquatterBind(t *testing.T) {
	refused := &net.OpError{Op: "dial", Net: "tcp", Err: &os.SyscallError{Syscall: "connect", Err: syscall.ECONNREFUSED}}
	err := squatterUnreachable("100.101.102.103", 4400, config.FlavorGTF, config.KindSquatterd, refused)
	for _, want := range []string{"gtf listens only on 127.0.0.1 by default", "/squatter bind 100.101.102.103", "/squatter to check the address it bound", "ssh tunnel"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("missing %q in: %v", want, err)
		}
	}
	for name, e := range map[string]error{
		"loopback refused":  squatterUnreachable("127.0.0.1", 4400, config.FlavorGTF, config.KindSquatterd, refused),
		"localhost refused": squatterUnreachable("localhost", 4400, config.FlavorGTF, config.KindSquatterd, refused),
		"remote timeout":    squatterUnreachable("100.101.102.103", 4400, config.FlavorGTF, config.KindSquatterd, errors.New("i/o timeout")),
		"remote squatterd":  squatterUnreachable("100.101.102.103", 4400, "", config.KindSquatterd, refused),
	} {
		if strings.Contains(e.Error(), "listens only on 127.0.0.1") {
			t.Fatalf("%s must keep the generic hint: %v", name, e)
		}
		if !strings.Contains(e.Error(), "port open?") {
			t.Fatalf("%s lost the generic hint: %v", name, e)
		}
	}
}
