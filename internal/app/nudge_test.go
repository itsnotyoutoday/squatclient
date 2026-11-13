package app

import "testing"

func TestAutoReconnectSquattersSettingIsAppliedAndDefaultsOn(t *testing.T) {
	f := newFixture(t)
	if !f.cfg.Settings().AutoReconnectSquatters {
		t.Fatal("default should be on")
	}
	if !f.svc.eng.AutoReconnectSquatters() {
		t.Fatal("engine should start with automatic reconnect on")
	}
	st := f.cfg.Settings()
	st.AutoReconnectSquatters = false
	if err := f.svc.SaveSettings(st); err != nil {
		t.Fatal(err)
	}
	if f.svc.eng.AutoReconnectSquatters() {
		t.Fatal("turning the setting off must reach the engine")
	}
	if n := f.svc.NudgeSquatters(); n != 0 {
		t.Fatalf("nudge with it off should do nothing, did %d", n)
	}
	st.AutoReconnectSquatters = true
	if err := f.svc.SaveSettings(st); err != nil {
		t.Fatal(err)
	}
	if !f.svc.eng.AutoReconnectSquatters() {
		t.Fatal("turning it back on must reach the engine")
	}
}
