package app

import (
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/proto"

	"github.com/itsnotyoutoday/squatclient/internal/config"
)

// TF_LIVE=<file> runs the Service against a REAL TinyFugue with tf-squatterd and a
// private CobraMUSH, started by the daemon repo's harness:
//
//	cd squatClientDaemon && go run ./scripts/tfharness --serve /tmp/tflive.json --tf-bin ... --tf-lib ... --evennia ''
//	cd squatClient && TF_LIVE=/tmp/tflive.json go test ./internal/app -run TestLiveTinyFugue -v
//
// Without TF_LIVE the test is skipped.
type liveInfo struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	AdminCode string `json:"adminCode"`
	CobraPort int    `json:"cobraPort"`
}

func (f *fixture) liveUntil(what string, d time.Duration, pred func() bool) {
	f.t.Helper()
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		if pred() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	f.t.Fatalf("timeout waiting for %s", what)
}

func (f *fixture) hasText(sub string) bool {
	for _, e := range f.events("line") {
		if strings.Contains(e.JSON, sub) {
			return true
		}
	}
	return false
}

func TestLiveTinyFugue(t *testing.T) {
	path := os.Getenv("TF_LIVE")
	if path == "" {
		t.Skip("TF_LIVE not set (see the comment above this test)")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var li liveInfo
	if err := json.Unmarshal(raw, &li); err != nil || li.CobraPort == 0 {
		t.Fatalf("bad live file %s: %v", raw, err)
	}
	f := newFixture(t)
	if c := os.Getenv("TF_LIVE_CODE"); c != "" {
		li.AdminCode = c // the code in the file is single use
	}

	// ---- pair like the dialog does (real TLS, fingerprint pinned)
	pr, err := f.svc.PairSquatter(li.Host, li.Port, "Live TF", li.AdminCode, config.KindTFSquatterd)
	if err != nil || pr.Fingerprint == "" {
		t.Fatalf("pair: %+v %v", pr, err)
	}
	if err := f.svc.ConfirmSquatter(pr.ID, true); err != nil {
		t.Fatal(err)
	}
	sq := pr.ID
	views, _ := f.svc.ListSquatters()
	if len(views) != 1 || views[0].Role != "admin" || views[0].Instance == "" || len(views[0].Features) == 0 {
		t.Fatalf("squatter view: %+v", views)
	}
	t.Logf("paired: role=%s features=%v", views[0].Role, views[0].Features)

	wname := "live" + strconv.FormatInt(time.Now().UnixNano()%1000000, 10) // TinyFugue allows one connection per world name

	// ---- a world in TinyFugue, then connect by record (TinyFugue logs in itself: no login line from here)
	if err := f.svc.PutTFWorld(sq, TFWorldPut{TFWorld: proto.TFWorld{Name: wname, Host: "127.0.0.1", Port: itoa(li.CobraPort), Type: os.Getenv("TF_LIVE_TYPE")}}); err != nil {
		t.Fatal(err)
	}
	ws, err := f.svc.ListTFWorlds(sq)
	if err != nil || len(ws) == 0 {
		t.Fatalf("worlds %v %v", ws, err)
	}
	si, err := f.svc.ConnectTFWorld(sq, wname)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = f.svc.eng.Disconnect(si.ID)
	})
	f.liveUntil("the game session connects", 20*time.Second, func() bool {
		cur, e := f.svc.eng.Session(si.ID)
		return e == nil && cur.State == proto.StateConnected
	})
	if si.TF == nil || si.TF.World != wname {
		t.Fatalf("TF info missing: %+v", si)
	}

	// ---- TinyFugue holds the keyboard: typing from here is refused, honestly
	_ = f.svc.Input(si.ID, "look-should-not-arrive")
	f.liveUntil("the user is told TinyFugue has the keyboard", 5*time.Second, func() bool { return f.hasLineFor(si.ID, "has the keyboard") })

	// ---- take over, log in (secret path), type, see the game answer
	if err := f.svc.ControlPreset(si.ID, "full"); err != nil {
		t.Fatal(err)
	}
	cur, _ := f.svc.eng.Session(si.ID)
	t.Logf("right after the preset: %+v", cur.TF)
	f.liveUntil("takeover state (input remote, automation client)", 5*time.Second, func() bool {
		cur, _ = f.svc.eng.Session(si.ID)
		return cur.TF != nil && cur.TF.Input == "remote" && cur.TF.Automation == "client"
	})
	if err := f.svc.Input(si.ID, "connect #1 potrzebie"); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Input(si.ID, "think live-marker-1"); err != nil {
		t.Fatal(err)
	}
	f.liveUntil("the game's answer comes back", 15*time.Second, func() bool { return f.hasText("live-marker-1") })

	// ---- run a TinyFugue command (admin)
	res, err := f.svc.TFExec(sq, "/version")
	if err != nil || !res.OK || len(res.Out) == 0 {
		t.Fatalf("exec: %v %+v", err, res)
	}
	t.Logf("tf /version: %v", res.Out)

	// ---- give it back: viewer again, and typing is refused again
	if err := f.svc.ControlPreset(si.ID, "viewer"); err != nil {
		t.Fatal(err)
	}
	_ = f.svc.Input(si.ID, "look-should-not-arrive-2")
	time.Sleep(500 * time.Millisecond)
	if f.hasText("should-not-arrive") && f.hasLineFor(si.ID, "should-not-arrive-2") && !f.hasLineFor(si.ID, "has the keyboard") {
		t.Fatal("typing after the hand-back was not refused")
	}
	// our own hand-back is not announced as a loss
	for _, e := range f.events("notice") {
		if strings.Contains(e.JSON, "took the keyboard back") || strings.Contains(e.JSON, "now run in") {
			t.Fatalf("own change announced as a loss: %s", e.JSON)
		}
	}

	// ---- a world from SquatClient's own list, through TinyFugue: plain host:port + login line from here
	w, err := f.svc.SaveWorld(config.World{Name: "Cobra via TF", Host: "127.0.0.1", Port: li.CobraPort, Via: sq,
		Login: &config.Login{Template: "connect {name} {password}", CharName: "#1"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.SetWorldPassword(w.ID, "potrzebie"); err != nil {
		t.Fatal(err)
	}
	si2, err := f.svc.Connect(ConnectTarget{WorldID: w.ID})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if t.Failed() {
			for _, e := range f.events("line") {
				if strings.Contains(e.JSON, si2.ID) {
					t.Logf("LINE %.300s", e.JSON)
				}
			}
			for _, e := range f.events("notice") {
				t.Logf("NOTICE %s", e.JSON)
			}
		}
	}()
	f.liveUntil("the client's login line reached the game (logged in as #1)", 20*time.Second, func() bool {
		return f.hasLineFor(si2.ID, "Last connect was")
	})
}

func (f *fixture) hasLineFor(session, sub string) bool {
	for _, e := range f.events("line") {
		if strings.Contains(e.JSON, session) && strings.Contains(e.JSON, sub) {
			return true
		}
	}
	return false
}
