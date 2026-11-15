package app

import (
	"testing"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/testutil/fakemush"
	"github.com/itsnotyoutoday/squatclient/internal/config"
)

// echoesOf counts the echo lines of text in a session's scrollback.
func (f *fixture) echoesOf(id, text string) int {
	f.t.Helper()
	page, err := f.svc.Scrollback(id, ScrollbackOpts{Limit: 200})
	if err != nil {
		f.t.Fatal(err)
	}
	n := 0
	for _, l := range page {
		if l.Kind == "echo" && l.Plain() == text {
			n++
		}
	}
	return n
}

// Local echo is a setting: the global one in Settings, a per-world override in the world, and the world's override wins; changing either applies
// to the open sessions too.
func TestLocalEchoSettingGlobalAndPerWorld(t *testing.T) {
	f := newFixture(t)
	srv := fakemush.New(t)
	w, err := f.svc.SaveWorld(config.World{Name: "Test", Host: srv.Host(), Port: srv.Port()})
	if err != nil {
		t.Fatal(err)
	}
	si, err := f.svc.Connect(ConnectTarget{WorldID: w.ID})
	if err != nil {
		t.Fatal(err)
	}
	f.waitConnected(si.ID)
	say := func(text string) int {
		if err := f.svc.Input(si.ID, text); err != nil {
			t.Fatal(err)
		}
		srv.ExpectLine(text)
		time.Sleep(150 * time.Millisecond)
		return f.echoesOf(si.ID, text)
	}
	if n := say("one"); n != 0 {
		t.Fatalf("default: local echo off, %d echoes", n)
	}
	cur := f.cfg.Settings()
	cur.LocalEcho = true
	if err := f.svc.SaveSettings(cur); err != nil {
		t.Fatal(err)
	}
	if n := say("one again"); n != 1 {
		t.Fatalf("global on applies to the open session: %d echoes", n)
	}
	cur.LocalEcho = false
	if err := f.svc.SaveSettings(cur); err != nil {
		t.Fatal(err)
	}
	if n := say("two"); n != 0 {
		t.Fatalf("global off applies to the open session: %d echoes", n)
	}
	w.LocalEcho = "on"
	if _, err := f.svc.SaveWorld(w); err != nil {
		t.Fatal(err)
	}
	if n := say("three"); n != 1 {
		t.Fatalf("the world's own 'on' beats the global off: %d echoes", n)
	}
	w.LocalEcho = ""
	if _, err := f.svc.SaveWorld(w); err != nil {
		t.Fatal(err)
	}
	if n := say("four"); n != 0 {
		t.Fatalf("the world follows the global setting again (off): %d echoes", n)
	}
	w.LocalEcho = "sideways"
	if _, err := f.svc.SaveWorld(w); err == nil {
		t.Fatal("a bad per-world value must be refused")
	}
}
