package app

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/msdp"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/proto"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/testutil/tftest"

	"github.com/itsnotyoutoday/squatclient/internal/config"
	"github.com/itsnotyoutoday/squatclient/internal/secrets"
)

// pairTF pairs a TinyFugue squatter (a real tf-squatterd bridge in front of a
// fake TinyFugue) through the Service, exactly like the Squatters dialog does.
func pairTF(t *testing.T, f *fixture, sim *tftest.Sim, role string) string {
	t.Helper()
	code := sim.PairCode(t, role)
	pr, err := f.svc.PairSquatter("127.0.0.1", sim.Port, "Home TF", code, config.KindTFSquatterd)
	if err != nil || pr.Fingerprint != sim.Fingerprint || pr.ID == "" {
		t.Fatalf("pair: %+v %v (want fingerprint %s)", pr, err, sim.Fingerprint)
	}
	if err := f.svc.ConfirmSquatter(pr.ID, true); err != nil {
		t.Fatal(err)
	}
	return pr.ID
}

const tfSid = "w-alpha-1-1"

func tfSession(t *testing.T, f *fixture, sim *tftest.Sim, sq string) string {
	t.Helper()
	sim.Fake.AddSession(tfSid, "alpha", "alpha.example", "4201")
	id := sq + ":" + tfSid
	f.until("the TinyFugue session is listed", func() bool {
		for _, s := range f.svc.Engine().Sessions() {
			if s.ID == id && s.Attached >= 1 {
				return true
			}
		}
		return false
	})
	return id
}

func TestTFSquatterPairingStoresKindAndShowsRoleAndFeatures(t *testing.T) {
	sim := tftest.Start(t)
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	id := pairTF(t, f, sim, "admin")

	stored := f.cfg.Squatters()
	if len(stored) != 1 || stored[0].Kind != config.KindTFSquatterd || !stored[0].Paired || stored[0].ID != id {
		t.Fatalf("stored record: %+v", stored)
	}
	views, err := f.svc.ListSquatters()
	if err != nil || len(views) != 1 {
		t.Fatalf("views %v %v", views, err)
	}
	v := views[0]
	feat := strings.Join(v.Features, ",")
	if v.State != engine.SqConnected || v.Role != "admin" || v.Instance == "" || !strings.Contains(feat, "tfexec") || !strings.Contains(feat, "worldedit") {
		t.Fatalf("view: %+v", v)
	}
	raw, _ := json.Marshal(v)
	if !strings.Contains(string(raw), `"kind":"tf-squatterd"`) {
		t.Fatalf("the UI does not get the kind: %s", raw)
	}
}

func TestPairingAPlainSquatterdRecordAgainstTinyFugueIsRefused(t *testing.T) {
	sim := tftest.Start(t)
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	code := sim.PairCode(t, "admin")
	// the user picked "squatterd" in the dialog but the address is a TinyFugue bridge
	pr, err := f.svc.PairSquatter("127.0.0.1", sim.Port, "x", code, "") // empty kind = squatterd
	if err != nil {
		t.Fatal(err) // the TLS probe cannot tell the kinds apart
	}
	err = f.svc.ConfirmSquatter(pr.ID, true)
	if err == nil || !strings.Contains(err.Error(), "TinyFugue") {
		t.Fatalf("err = %v, want the wrong-kind explanation", err)
	}
	if len(f.cfg.Squatters()) != 0 {
		t.Fatalf("a refused squatter was stored: %+v", f.cfg.Squatters())
	}
	// and the pairing code was not used up by the refused attempt
	if _, err := f.svc.PairSquatter("127.0.0.1", sim.Port, "x", code, config.KindTFSquatterd); err != nil {
		t.Fatal(err)
	}
}

func TestTFSquatterHintsNameTheRightCommand(t *testing.T) {
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	_, err := f.svc.PairSquatter("127.0.0.1", 1, "x", "", config.KindTFSquatterd)
	if err == nil || !strings.Contains(err.Error(), "/squat pair") {
		t.Fatalf("TF hint: %v", err)
	}
	_, err = f.svc.PairSquatter("127.0.0.1", 1, "x", "", "")
	if err == nil || !strings.Contains(err.Error(), "squatterd pair") {
		t.Fatalf("squatterd hint: %v", err)
	}
}

func TestTFControlEventsAndSessionInfo(t *testing.T) {
	sim := tftest.Start(t)
	sim.Fake.Ask = true
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	sq := pairTF(t, f, sim, "admin")
	sid := tfSession(t, f, sim, sq)

	done := make(chan error, 1)
	go func() { done <- f.svc.SetControl(sid, "input", "remote") }()
	f.until("control-pending reaches the UI", func() bool { return len(f.events("control-pending")) == 1 })
	var p engine.ControlPending
	_ = json.Unmarshal([]byte(f.events("control-pending")[0].JSON), &p)
	if p.Session != sid || p.Axis != "input" || p.Mode != "remote" {
		t.Fatalf("control-pending payload: %+v", p)
	}
	sim.Fake.Answer(true)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	f.until("the session event carries the new control state", func() bool {
		for _, e := range f.events("session") {
			if strings.Contains(e.JSON, `"input":"remote"`) && strings.Contains(e.JSON, sid) {
				return true
			}
		}
		return false
	})
	sessions, _ := f.svc.ListSessions()
	if len(sessions) != 1 || sessions[0].TF == nil || sessions[0].TF.Input != "remote" || sessions[0].TF.World != "alpha" {
		t.Fatalf("sessions: %+v", sessions)
	}
}

func TestTFWorldsThroughTheService(t *testing.T) {
	sim := tftest.Start(t)
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	sq := pairTF(t, f, sim, "admin")
	err := f.svc.PutTFWorld(sq, TFWorldPut{TFWorld: proto.TFWorld{Name: "newmud", Host: "mud.example", Port: "4000", Type: "tiny", Char: "bob"}, Password: "pw", Save: true})
	if err != nil {
		t.Fatal(err)
	}
	ws, err := f.svc.ListTFWorlds(sq)
	raw, _ := json.Marshal(ws)
	if err != nil || len(ws) != 1 || ws[0].Name != "newmud" || !ws[0].PassSet || strings.Contains(string(raw), "\"pw\"") {
		t.Fatalf("worlds %v %s", err, raw)
	}
	// our own change is the reply to the call; only other devices' edits raise tf-worlds
	// connect from the record: nothing but the name leaves this app (TinyFugue logs in itself)
	si, err := f.svc.ConnectTFWorld(sq, "newmud")
	if err != nil || si.TF == nil || si.TF.World != "newmud" {
		t.Fatalf("connect: %v %+v", err, si)
	}
	for _, m := range sim.Fake.SendTexts() {
		t.Fatalf("the client sent text %q although TinyFugue logs in itself", m)
	}
	if err := f.svc.DeleteTFWorld(sq, "newmud"); err != nil {
		t.Fatal(err)
	}
	if ws, _ := f.svc.ListTFWorlds(sq); len(ws) != 0 {
		t.Fatalf("world still there: %+v", ws)
	}
	if _, err := f.svc.ConnectTFWorld(sq, "  "); err == nil {
		t.Fatal("an empty world name was accepted")
	}
}

func TestTFExecGmcpMsdpAndData(t *testing.T) {
	sim := tftest.Start(t)
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	sq := pairTF(t, f, sim, "admin")
	sid := tfSession(t, f, sim, sq)

	res, err := f.svc.TFExec(sq, "/echo hi")
	if err != nil || !res.OK || len(res.Out) != 1 || res.Out[0] != "ran: /echo hi" {
		t.Fatalf("exec: %v %+v", err, res)
	}
	sim.Fake.Send("GMCP", tfSid, "Char.Vitals", `{"hp":5}`)
	p, _ := msdpEncode(map[string]any{"HEALTH": "77"})
	sim.Fake.Send("MSDP", tfSid, p)
	f.until("gmcp and msdp events reach the UI", func() bool { return len(f.events("gmcp")) == 1 && len(f.events("msdp")) == 1 })
	if m := f.events("msdp")[0].JSON; !strings.Contains(m, `"HEALTH":"77"`) || !strings.Contains(m, sid) {
		t.Fatalf("msdp payload: %s", m)
	}
	if err := f.svc.SendGmcp(sid, "Core.Hello", `{"client":"squat"}`); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.SendGmcp(sid, "Core.Hello", `{not json`); err == nil {
		t.Fatal("invalid GMCP JSON was accepted")
	}
	if err := f.svc.SendMsdp(sid, `{"REPORT":["HEALTH"]}`); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.SendMsdp(sid, `{}`); err == nil {
		t.Fatal("an empty MSDP request was accepted")
	}
	d, err := f.svc.GetSessionData(sid)
	if err != nil || d.Msdp["HEALTH"] != "77" || !strings.Contains(string(d.Gmcp["Char.Vitals"]), "5") {
		t.Fatalf("data: %v %+v", err, d)
	}
}

func TestTFAutomationPreferenceIsPersistedAndApplied(t *testing.T) {
	sim := tftest.Start(t)
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	sq := pairTF(t, f, sim, "admin")
	sid := tfSession(t, f, sim, sq)
	if err := f.svc.SetSquatterAutomation(sq, "client"); err != nil {
		t.Fatal(err)
	}
	if got := f.cfg.Squatters()[0].Automation; got != "client" {
		t.Fatalf("stored automation = %q", got)
	}
	f.until("TinyFugue handed automation to this client", func() bool {
		ss, _ := f.svc.ListSessions()
		return len(ss) == 1 && ss[0].ID == sid && ss[0].TF != nil && ss[0].TF.Automation == "client"
	})
	if err := f.svc.SetSquatterAutomation(sq, "nonsense"); err == nil {
		t.Fatal("a bad mode was accepted")
	}
	if err := f.svc.SetSquatterAutomation("nope", "tf"); err == nil {
		t.Fatal("an unknown squatter was accepted")
	}
}

func TestShowGaggedSettingReachesTheEngine(t *testing.T) {
	sim := tftest.Start(t)
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	sq := pairTF(t, f, sim, "admin")
	sid := tfSession(t, f, sim, sq)
	sim.Fake.Line(tfSid, "g", "g", "game", "hidden by default")
	sim.Fake.Line(tfSid, "g", "", "game", "marker one")
	f.until("marker one", func() bool { return hasLine(f, sid, "marker one") })
	if hasLine(f, sid, "hidden by default") {
		t.Fatal("a gagged line was shown by default")
	}
	st := f.cfg.Settings()
	st.ShowGagged = true
	if err := f.svc.SaveSettings(st); err != nil {
		t.Fatal(err)
	}
	sim.Fake.Line(tfSid, "g", "g", "game", "shown after the setting")
	f.until("the gagged line is shown once the user asks", func() bool { return hasLine(f, sid, "shown after the setting") })
}

func hasLine(f *fixture, sid, sub string) bool {
	for _, e := range f.events("line") {
		var l proto.Line
		if json.Unmarshal([]byte(e.JSON), &l) == nil && l.Session == sid && strings.Contains(l.Plain(), sub) {
			return true
		}
	}
	return false
}

func msdpEncode(vars map[string]any) (string, error) {
	p, err := msdp.Encode(msdp.FromMap(vars))
	return string(p), err
}

func TestTFScriptsThroughTheService(t *testing.T) {
	sim := tftest.Start(t)
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	sq := pairTF(t, f, sim, "admin")
	r, err := f.svc.PutTFScript(sq, "mine.tf", `/def -t"*x*" mine = /echo x`+"\n", true)
	if err != nil || !r.Stored || !r.Loaded {
		t.Fatalf("put: %v %+v", err, r)
	}
	ls, err := f.svc.ListTFScripts(sq)
	if err != nil || len(ls) != 1 || ls[0].Name != "mine.tf" {
		t.Fatalf("list: %v %+v", err, ls)
	}
	if err := f.svc.DeleteTFScript(sq, "mine.tf"); err != nil {
		t.Fatal(err)
	}
	sim.Fake.ScriptsOn = false
	if _, err := f.svc.PutTFScript(sq, "no.tf", "x", false); err == nil || !strings.Contains(err.Error(), "off") {
		t.Fatalf("refusal must say why: %v", err)
	}
	pv := pairTF(t, f, sim, "operator")
	if _, err := f.svc.PutTFScript(pv, "op.tf", "x", false); err == nil {
		t.Fatal("an operator uploaded a script")
	}
}
