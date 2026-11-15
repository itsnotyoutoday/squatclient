package app

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/itsnotyoutoday/cmcp/go/msg"
	"github.com/itsnotyoutoday/squatclient/internal/config"
	"github.com/itsnotyoutoday/squatclient/internal/secrets"
)

func TestDiagModeAlwaysIsOnAndHasAHeader(t *testing.T) {
	f := newFixture(t)
	if !f.svc.DiagInfo().Enabled || !f.svc.DiagInfo().Available {
		t.Fatalf("always mode must log from the first start: %+v", f.svc.DiagInfo())
	}
	txt := f.diagText()
	for _, want := range []string{"env: build=\"test-build\"", "diagnosticsMode=always", "settings at start:", "sound path check:", "[snapshot]"} {
		if !strings.Contains(txt, want) {
			t.Errorf("header/snapshot lacks %q\n%s", want, txt)
		}
	}
}

func TestDiagModeMatrixAndPersistence(t *testing.T) {
	// opt-in: off until the user turns it on; the choice persists across a restart
	dir := t.TempDir()
	sec := secrets.NewMemory()
	f := newFixtureMode(t, dir, sec, "optin")
	if f.svc.DiagInfo().Enabled {
		t.Fatal("opt-in must start off")
	}
	f.svc.dlog("ui", "", "must not be written")
	if err := f.svc.DiagSetEnabled(true); err != nil {
		t.Fatal(err)
	}
	f.svc.Shutdown()
	f2 := newFixtureMode(t, dir, sec, "optin")
	if !f2.svc.DiagInfo().Enabled {
		t.Fatal("opt-in choice did not persist")
	}
	if strings.Contains(f2.diagText(), "must not be written") {
		t.Fatal("a line was written while logging was off")
	}
	// always: the user turns it off once; it stays off after a restart, and the log says so
	dir2 := t.TempDir()
	a := newFixtureMode(t, dir2, sec, "always")
	if err := a.svc.DiagSetEnabled(false); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(a.diagText(), "turned OFF by the user") {
		t.Fatal("turning it off must be the last line of the log")
	}
	a.svc.Shutdown()
	b := newFixtureMode(t, dir2, sec, "always")
	if b.svc.DiagInfo().Enabled {
		t.Fatal("a user's off must persist in always mode")
	}
	// off: compiled out
	c := newFixtureMode(t, t.TempDir(), sec, "off")
	if c.svc.DiagInfo().Available || c.svc.DiagInfo().Enabled {
		t.Fatal("off mode must be unavailable")
	}
	c.svc.dlog("ui", "", "x")
	if err := c.svc.DiagSetEnabled(true); err == nil {
		t.Fatal("off mode must refuse to turn on")
	}
	if _, err := os.Stat(filepath.Join(c.cfg.Dir(), "diagnostics")); err == nil {
		t.Fatal("off mode created a diagnostics folder")
	}
}

func TestDiagClearAndStatus(t *testing.T) {
	f := newFixture(t)
	f.svc.dlog("ui", "", "to be cleared")
	st := f.svc.DiagStatus()
	if len(st.Log.Sessions) != 1 || st.Log.Sessions[0].Bytes == 0 || !st.Info.Enabled {
		t.Fatalf("%+v", st)
	}
	if err := f.svc.DiagClear(); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(f.diagText(), "to be cleared") {
		t.Fatal("clear kept the old lines")
	}
	if !f.svc.DiagInfo().Enabled {
		t.Fatal("clear must not switch logging off")
	}
}

// The mute / tab-switch sequence leaves its trace: both worlds, who was in front, what each click did.
func TestDiagTimelineOfAMuteAndTabSequence(t *testing.T) {
	f := newFixture(t)
	wa, _ := f.svc.SaveWorld(config.World{Name: "Alpha", Host: "127.0.0.1", Port: 1})
	wb, _ := f.svc.SaveWorld(config.World{Name: "Beta", Host: "127.0.0.1", Port: 2})
	_ = wa
	_ = wb
	if err := f.svc.Foreground("s1"); err == nil {
		_ = err
	}
	if err := f.svc.SetWorldSoundMuted("s1", true); err != nil {
		_ = err
	}
	f.svc.playSound("s1", &msg.SoundPlay{Event: "hail_incoming"})
	cur := f.cfg.Settings()
	cur.SoundMuted = true
	if err := f.svc.SaveSettings(cur); err != nil {
		t.Fatal(err)
	}
	txt := f.diagText()
	for _, want := range []string{"world saved:", "name=\"Alpha\"", "tab switch: foreground", "ev=e1 wire Sound.Play", "changed soundMuted: false -> true"} {
		if !strings.Contains(txt, want) {
			t.Errorf("timeline lacks %q\n%s", want, txt)
		}
	}
}

func TestDiagSettingsChangeNeverLogsSecrets(t *testing.T) {
	f := newFixture(t)
	f.svc.logSettingsChange(map[string]any{"cmcpToken": "oldtoken1234", "scripts": "a"}, map[string]any{"cmcpToken": "newtoken5678", "scripts": "b"})
	f.svc.DiagLogLine("ui", "s1", "dbg s2: -> connect alice ember-tide-91")
	f.svc.DiagLogLine("error", "", `window.onerror: failed {"password":"hunter2"}`)
	txt := f.diagText()
	for _, secret := range []string{"oldtoken1234", "newtoken5678", "ember-tide-91", "hunter2"} {
		if strings.Contains(txt, secret) {
			t.Errorf("%q leaked into the log", secret)
		}
	}
	if !strings.Contains(txt, "changed scripts: a -> b") {
		t.Fatalf("a plain change is missing:\n%s", txt)
	}
}

func TestDiagZipHasNoSecretsAndIsReadable(t *testing.T) {
	f := newFixture(t)
	f.svc.dlog("net", "s1", "dbg s1: -> connect alice cobalt-fern-52")
	dest := filepath.Join(t.TempDir(), "x.zip")
	res, err := f.svc.DiagBuildZip(DiagZipOptions{Note: "my password is hunter22", Dest: dest})
	if err != nil {
		t.Fatal(err)
	}
	if res.Size == 0 {
		t.Fatal("empty zip")
	}
	zr, err := zip.OpenReader(dest)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	all := ""
	for _, zf := range zr.File {
		r, _ := zf.Open()
		b, _ := io.ReadAll(r)
		r.Close()
		all += string(b)
	}
	for _, secret := range []string{"cobalt-fern-52", "hunter22"} {
		if strings.Contains(all, secret) {
			t.Errorf("%q in the zip", secret)
		}
	}
	if !strings.Contains(all, "build: test-build") {
		t.Fatal("system.txt lacks the build stamp")
	}
	// the delete action only touches files named like our zips
	if err := f.svc.DiagDeleteZip(dest); err == nil {
		t.Fatal("deleted a file that is not named like a diagnostics zip")
	}
	good := filepath.Join(t.TempDir(), "squatclient-diagnostics-x-2026-01-01.zip")
	_ = os.WriteFile(good, []byte("z"), 0o600)
	if err := f.svc.DiagDeleteZip(good); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(good); err == nil {
		t.Fatal("zip not deleted")
	}
}

func TestDiagDefaultZipNameAndUniqueness(t *testing.T) {
	d := t.TempDir()
	p := filepath.Join(d, "a.zip")
	_ = os.WriteFile(p, nil, 0o600)
	if got := uniquePath(p); filepath.Base(got) != "a-2.zip" {
		t.Fatalf("%s", got)
	}
}

func TestClassify(t *testing.T) {
	cases := []struct{ in, layer, sid, text string }{
		{"dbg s2: <- Cobra.Console {}", "cmcp", "s2", "<- Cobra.Console {}"},
		{"dbg s2: player: close requested", "ui", "s2", "player: close requested"},
		{"pack s1: wanted sound x", "packs", "s1", "wanted sound x"},
		{"ctx s1: the connection ended", "cmcp", "s1", "ctx: the connection ended"},
		{"stream s1: <- Space.Contacts count=3", "cmcp", "s1", "stream <- Space.Contacts count=3"},
		{"mute: session s1 is now world", "sound", "", "mute: session s1 is now world"},
		{"settings: x", "settings", "", "settings: x"},
	}
	for _, c := range cases {
		l, s, x := classify(c.in)
		if l != c.layer || s != c.sid || x != c.text {
			t.Errorf("%q -> %s %s %q", c.in, l, s, x)
		}
	}
}

func TestLoggingNeverBlocksTheService(t *testing.T) {
	f := newFixture(t)
	done := make(chan struct{})
	go func() {
		for i := 0; i < 50000; i++ {
			f.svc.dlog("net", "s1", "line %d", i)
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("dlog blocked the caller")
	}
}
