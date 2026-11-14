package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

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

func tfWorldNames(f *fixture, sq string) map[string]proto.TFWorld {
	ws, _ := f.svc.ListTFWorlds(sq)
	m := map[string]proto.TFWorld{}
	for _, w := range ws {
		m[w.Name] = w
	}
	return m
}

func TestWorldsRoutedThroughTinyFugueAreMirroredBothWays(t *testing.T) {
	sim := tftest.Start(t)
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	sq := pairTF(t, f, sim, "admin")

	// saving here puts the record into TinyFugue, without credentials
	w, err := f.svc.SaveWorld(config.World{Name: "trek", Host: "trek.example", Port: 1701, Via: sq,
		Login: &config.Login{Template: "connect {name} {password}", CharName: "kirk"}})
	if err != nil {
		t.Fatal(err)
	}
	f.until("the record appears in TinyFugue", func() bool { return tfWorldNames(f, sq)["trek"].Host == "trek.example" })
	if r := tfWorldNames(f, sq)["trek"]; r.Port != "1701" || r.Char != "" || r.PassSet {
		t.Fatalf("record %+v (credentials must not be copied)", r)
	}

	// renaming here renames the record (not a second one)
	w.Name = "trek2"
	if _, err := f.svc.SaveWorld(w); err != nil {
		t.Fatal(err)
	}
	f.until("the record was renamed in TinyFugue", func() bool {
		m := tfWorldNames(f, sq)
		return m["trek2"].Name == "trek2" && m["trek"].Name == ""
	})

	// changing host or port here updates the record and keeps what TinyFugue has
	if err := f.svc.PutTFWorld(sq, TFWorldPut{TFWorld: proto.TFWorld{Name: "trek2", Host: "trek.example", Port: "1701", Type: "tiny", Char: "tfchar"}, Save: true}); err != nil {
		t.Fatal(err)
	}
	w.Port = 1702
	if _, err := f.svc.SaveWorld(w); err != nil {
		t.Fatal(err)
	}
	f.until("the port changed and TinyFugue's own character was kept", func() bool {
		r := tfWorldNames(f, sq)["trek2"]
		return r.Port == "1702" && r.Char == "tfchar" && r.Type == "tiny"
	})

	// renamed on TinyFugue's side: the world here follows
	if err := f.svc.eng.RenameTFWorld(sq, "trek2", "trek3", true); err != nil {
		t.Fatal(err)
	}
	f.until("the local world followed the rename", func() bool {
		ws, _ := f.svc.ListWorlds()
		return len(ws) == 1 && ws[0].Name == "trek3"
	})
	f.until("the UI is told the world list changed", func() bool { return len(f.events("worlds")) > 0 })

	// deleting here deletes the record
	if err := f.svc.DeleteWorld(w.ID); err != nil {
		t.Fatal(err)
	}
	f.until("the record was deleted in TinyFugue", func() bool { return tfWorldNames(f, sq)["trek3"].Name == "" })
}

func TestConnectingAMirroredWorldIsByRecordWithTheClientsLogin(t *testing.T) {
	sim := tftest.Start(t)
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	sq := pairTF(t, f, sim, "admin")
	w, err := f.svc.SaveWorld(config.World{Name: "login-test", Host: "h.example", Port: 4000, Via: sq,
		Login: &config.Login{Template: "connect {name} {password}", CharName: "bob"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.SetWorldPassword(w.ID, "hunter2"); err != nil {
		t.Fatal(err)
	}
	si, err := f.svc.Connect(ConnectTarget{WorldID: w.ID})
	if err != nil {
		t.Fatal(err)
	}
	if si.TF == nil || si.TF.World != "login-test" || si.Name != "login-test" {
		t.Fatalf("session %+v: the tab, the world and TinyFugue must carry one name", si)
	}
	f.liveUntil("the login line is sent by this app", 5*time.Second, func() bool {
		for _, s := range sim.Fake.SendTexts() {
			if s == "connect bob hunter2" {
				return true
			}
		}
		return false
	})
}

func TestRenamingATabRenamesTheWorldInTinyFugueAndHere(t *testing.T) {
	sim := tftest.Start(t)
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	sq := pairTF(t, f, sim, "admin")
	if _, err := f.svc.SaveWorld(config.World{Name: "tabworld", Host: "h.example", Port: 4000, Via: sq}); err != nil {
		t.Fatal(err)
	}
	f.until("mirrored", func() bool { return tfWorldNames(f, sq)["tabworld"].Name != "" })
	si, err := f.svc.ConnectTFWorld(sq, "tabworld")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.RenameTFSession(si.ID, "renamed-tab"); err != nil {
		t.Fatal(err)
	}
	f.until("the tab, TinyFugue's record and the local world all agree", func() bool {
		cur, _ := f.svc.eng.Session(si.ID)
		ws, _ := f.svc.ListWorlds()
		return cur.Name == "renamed-tab" && tfWorldNames(f, sq)["renamed-tab"].Name != "" && len(ws) == 1 && ws[0].Name == "renamed-tab"
	})
	if err := f.svc.RenameTFSession(si.ID, ""); err == nil {
		t.Fatal("an empty name was accepted")
	}
}

func TestRenamingAnAddressConnectionTurnsItIntoAWorldOnBothSides(t *testing.T) {
	sim := tftest.Start(t)
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	sq := pairTF(t, f, sim, "admin")
	si, err := f.svc.Connect(ConnectTarget{Host: "mud.example", Port: 4000, Via: sq})
	if err != nil || si.TF == nil || !strings.HasPrefix(si.TF.World, "(") {
		t.Fatalf("connect by address: %v %+v", err, si.TF)
	}
	if ws, _ := f.svc.ListWorlds(); len(ws) != 0 {
		t.Fatalf("worlds before: %+v", ws)
	}
	if err := f.svc.RenameTFSession(si.ID, "adopted"); err != nil {
		t.Fatal(err)
	}
	f.until("TinyFugue keeps it as a named world", func() bool {
		r := tfWorldNames(f, sq)["adopted"]
		return r.Name == "adopted" && !r.Temp && r.Host == "mud.example"
	})
	f.until("this app has the world too and the tab is linked to it", func() bool {
		ws, _ := f.svc.ListWorlds()
		cur, _ := f.svc.eng.Session(si.ID)
		return len(ws) == 1 && ws[0].Name == "adopted" && ws[0].Via == sq && ws[0].Host == "mud.example" && ws[0].Port == 4000 &&
			cur.Name == "adopted" && cur.WorldID == ws[0].ID
	})
}

func helperLoaded(sim *tftest.Sim) bool {
	for _, p := range sim.Fake.LoadedScripts() {
		if strings.HasSuffix(p, "/scripts/squatclient-hide.tf") {
			return true
		}
	}
	return false
}

func TestHelperScriptIsSentToTinyFugueByItselfWhenAnAdminConnects(t *testing.T) {
	sim := tftest.StartWith(t, tftest.DefaultFeatures+",scripts")
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	sq := pairTF(t, f, sim, "admin")
	f.liveUntil("the helper script is loaded in TinyFugue", 5*time.Second, func() bool { return helperLoaded(sim) })
	ls, err := f.svc.ListTFScripts(sq)
	if err != nil || len(ls) != 1 || ls[0].Name != "squatclient-hide.tf" {
		t.Fatalf("stored scripts: %v %+v", err, ls)
	}
	// what was sent is the gag script: it hides the query markers and refusals only while a query runs
	for _, want := range []string{"SQUATCAP-", "-ag", "sqcap_active"} {
		if !strings.Contains(hideScript, want) {
			t.Fatalf("the embedded script lacks %q", want)
		}
	}
}

func TestHelperScriptIsNotSentWhenItShouldNot(t *testing.T) {
	cases := []struct {
		name, features, role string
		setting              bool
	}{
		{"an operator device may not send scripts", tftest.DefaultFeatures + ",scripts", "operator", true},
		{"TinyFugue has script upload off", tftest.DefaultFeatures, "admin", true},
		{"the user turned it off", tftest.DefaultFeatures + ",scripts", "admin", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			sim := tftest.StartWith(t, c.features)
			f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
			st := f.cfg.Settings()
			st.TFHideQueries = c.setting
			if err := f.svc.SaveSettings(st); err != nil {
				t.Fatal(err)
			}
			pairTF(t, f, sim, c.role)
			time.Sleep(1200 * time.Millisecond)
			if helperLoaded(sim) {
				t.Fatal("the helper script was sent")
			}
			for _, e := range f.events("notice") {
				if strings.Contains(e.JSON, "script") {
					t.Fatalf("a refusal must be silent, got %s", e.JSON)
				}
			}
		})
	}
}

func TestHelperScriptIsSentAgainOnEveryNewConnection(t *testing.T) {
	sim := tftest.StartWith(t, tftest.DefaultFeatures+",scripts")
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	sq := pairTF(t, f, sim, "admin")
	f.liveUntil("first send", 5*time.Second, func() bool { return len(sim.Fake.LoadedScripts()) >= 1 })
	// TinyFugue restarted (its macros are gone) and the app reconnected
	if err := f.svc.eng.ReconnectSquatter(f.svc.ctx, sq); err != nil {
		t.Fatal(err)
	}
	f.liveUntil("sent again after the reconnect", 8*time.Second, func() bool { return len(sim.Fake.LoadedScripts()) >= 2 })
}
