package dlog

import (
	"archive/zip"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func newLog(t *testing.T, mut func(*Config)) (*Logger, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "diagnostics")
	cfg := Config{Dir: dir, Enabled: true, Flush: 20 * time.Millisecond}
	if mut != nil {
		mut(&cfg)
	}
	l := Open(cfg)
	t.Cleanup(l.Close)
	return l, dir
}

func TestRedactionRealisticLines(t *testing.T) {
	secrets := map[string]string{
		`dbg s2: -> connect alice ember-tide-91`:                              "ember-tide-91",
		`dbg s2: -> create "Bob Smith" cobalt-fern-52`:                        "cobalt-fern-52",
		`sent: CONNECT alice hunter2`:                                         "hunter2",
		`/pair K7Q9-ZZ41`:                                                     "K7Q9-ZZ41",
		`squatter: pair_code=ABCD-EFGH ok`:                                    "ABCD-EFGH",
		`pairing code: "WXYZ-1234"`:                                           "WXYZ-1234",
		`Authorization: Bearer abcdef123456secret`:                            "abcdef123456secret",
		`header authorization=Basic dXNlcjpwYXNz`:                             "dXNlcjpwYXNz",
		`{"name":"x","password":"s3cr3t!","host":"h"}`:                        "s3cr3t!",
		`{"login":{"template":"connect %u mypass"},"host":"h"}`:               "mypass",
		`/addworld -Tdiku Foo alice mypw2 example.org 4201`:                   "mypw2",
		`/world Foo alice mypw3`:                                              "mypw3",
		`dial https://user:topsecret@example.org/x`:                           "topsecret",
		`token=0123456789abcdefABCDEFghij0123456789abcdefABCDEF_xyz`:          "0123456789abcdefABCDEF",
		`key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnopqrstuvwxyz`: "eyJhbGciOiJIUzI1NiIsInR5cCI6",
		`autologin "connect me pw-in-quotes"`:                                 "pw-in-quotes",
		`/squatter pair 9H3K-77QA`:                                            "9H3K-77QA",
	}
	for in, secret := range secrets {
		out, n := Redact(in)
		if strings.Contains(out, secret) || n == 0 {
			t.Errorf("not redacted (%d): %q -> %q", n, in, out)
		}
	}
	// harmless text and content hashes stay readable
	keep := []string{
		"pack: sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 fetched from cdn.example.org",
		"mute: session s2 is now audible (global=false)",
		"sound: Sound.Play impulse_loop volume=80 -> web received",
	}
	for _, in := range keep {
		if out, n := Redact(in); out != in || n != 0 {
			t.Errorf("harmless line changed: %q -> %q", in, out)
		}
	}
}

func TestModeMatrixAndPersistence(t *testing.T) {
	cases := []struct {
		m    Mode
		p    Prefs
		want bool
	}{
		{Always, Prefs{}, true}, {Always, Prefs{Chosen: true, Enabled: false}, false}, {Always, Prefs{Chosen: true, Enabled: true}, true},
		{OptIn, Prefs{}, false}, {OptIn, Prefs{Chosen: true, Enabled: true}, true}, {OptIn, Prefs{Chosen: true, Enabled: false}, false},
		{Off, Prefs{}, false}, {Off, Prefs{Chosen: true, Enabled: true}, false},
	}
	for _, c := range cases {
		if got := Effective(c.m, c.p); got != c.want {
			t.Errorf("%s %+v = %v", c.m, c.p, got)
		}
	}
	if ParseMode("ALWAYS") != Always || ParseMode("off") != Off || ParseMode("optin") != OptIn || ParseMode("junk") != OptIn {
		t.Fatal("ParseMode")
	}
	p := filepath.Join(t.TempDir(), "diagnostics.json")
	if got := LoadPrefs(p); got.Chosen {
		t.Fatal("missing file must be never chosen")
	}
	if err := SavePrefs(p, Prefs{Chosen: true, Enabled: false}); err != nil {
		t.Fatal(err)
	}
	if got := LoadPrefs(p); !got.Chosen || got.Enabled {
		t.Fatalf("not persisted: %+v", got)
	}
	st, _ := os.Stat(p)
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("perm %v", st.Mode())
	}
}

func TestWritesRedactedLinesWithTags(t *testing.T) {
	l, dir := newLog(t, nil)
	l.Log("net", "s2", "Nexus", "dbg s2: -> connect alice ember-tide-91")
	l.Flush()
	b, err := os.ReadFile(filepath.Join(dir, l.Session(), "current.log"))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	if strings.Contains(s, "ember-tide-91") || !strings.Contains(s, "[net]") || !strings.Contains(s, `sid=s2`) || !strings.Contains(s, `tab="Nexus"`) {
		t.Fatalf("line: %q", s)
	}
	st, _ := os.Stat(filepath.Join(dir, l.Session(), "current.log"))
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("perm %v", st.Mode())
	}
}

func TestRolloverKeepsEverythingAndNoCap(t *testing.T) {
	l, dir := newLog(t, func(c *Config) { c.SegmentBytes = 4 << 10; c.BudgetBytes = 100 << 20 })
	for i := 0; i < 2000; i++ { // far more than the old 300-line cap
		l.Logf("sound", "s1", "", "line %04d %s", i, strings.Repeat("x", 40))
	}
	l.Flush()
	segs, _ := filepath.Glob(filepath.Join(dir, l.Session(), "*.log.gz"))
	if len(segs) < 5 {
		t.Fatalf("expected several gzip segments, got %d", len(segs))
	}
	lines, err := l.Tail(5000, "line ")
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 2000 || !strings.Contains(lines[0], "line 0000") || !strings.Contains(lines[1999], "line 1999") {
		t.Fatalf("lines lost across segments: %d", len(lines))
	}
}

func TestRetentionCurrentAndPreviousOnly(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "diagnostics")
	var ids []string
	for i := 1; i <= 4; i++ {
		id := fmt.Sprintf("2026010%d-000000", i)
		ids = append(ids, id)
		l := Open(Config{Dir: dir, Enabled: true, Session: id, Flush: 10 * time.Millisecond})
		l.Log("session", "", "", "hello "+id)
		l.Close()
	}
	ents, _ := os.ReadDir(dir)
	var got []string
	for _, e := range ents {
		got = append(got, e.Name())
	}
	if len(got) != 2 || got[0] != ids[2] || got[1] != ids[3] {
		t.Fatalf("kept %v", got)
	}
	// the previous session's open file (a crash leaves current.log) was sealed into a segment
	if gz, _ := filepath.Glob(filepath.Join(dir, ids[2], "*.log.gz")); len(gz) != 1 {
		t.Fatalf("previous session not sealed: %v", gz)
	}
}

func TestBudgetDropsPreviousFirst(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "diagnostics")
	prev := Open(Config{Dir: dir, Enabled: true, Session: "20260101-000000", SegmentBytes: 2 << 10, Flush: 10 * time.Millisecond})
	for i := 0; i < 400; i++ {
		prev.Logf("net", "", "", "%d %s", i, noise(60))
	}
	prev.Close()
	prevBefore := len(segments(filepath.Join(dir, "20260101-000000")))
	cur := Open(Config{Dir: dir, Enabled: true, Session: "20260102-000000", SegmentBytes: 2 << 10, BudgetBytes: 12 << 10, Flush: 10 * time.Millisecond})
	defer cur.Close()
	for i := 0; i < 600; i++ {
		cur.Logf("net", "", "", "%d %s", i, noise(60))
	}
	cur.Flush()
	prevAfter := len(segments(filepath.Join(dir, "20260101-000000")))
	if prevAfter >= prevBefore {
		t.Fatalf("previous session was not trimmed first: %d -> %d", prevBefore, prevAfter)
	}
	var total int64
	for _, id := range cur.sessionIDs() {
		total += dirSize(filepath.Join(dir, id))
	}
	if total > 12<<10+4<<10 { // budget plus one open segment
		t.Fatalf("over budget: %d", total)
	}
}

// noise is incompressible text (the segments are gzip files: repeated letters would shrink to nothing)
func noise(n int) string {
	b := make([]byte, n/2)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func TestLoggingNeverBlocks(t *testing.T) {
	l, _ := newLog(t, func(c *Config) { c.Queue = 8 })
	done := make(chan struct{})
	go func() {
		var wg sync.WaitGroup
		for g := 0; g < 8; g++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := 0; i < 1000; i++ {
					l.Log("net", "s", "", strings.Repeat("y", 200))
				}
			}()
		}
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("Log blocked")
	}
	var nilLog *Logger
	nilLog.Log("x", "", "", "nothing") // a nil logger (mode off) is a no-op
	if nilLog.Enabled() {
		t.Fatal("nil logger enabled")
	}
}

func TestDisabledWritesNothingAndToggles(t *testing.T) {
	l, dir := newLog(t, func(c *Config) { c.Enabled = false })
	l.Log("net", "", "", "ignored")
	if _, err := os.Stat(dir); err == nil {
		t.Fatal("a disabled logger created files")
	}
	l.SetEnabled(true)
	l.Log("net", "", "", "kept")
	l.SetEnabled(false)
	l.Log("net", "", "", "ignored again")
	lines, _ := l.Tail(10, "")
	if len(lines) != 1 || !strings.Contains(lines[0], "kept") {
		t.Fatalf("%v", lines)
	}
}

func TestClear(t *testing.T) {
	l, dir := newLog(t, nil)
	l.Log("net", "", "", "before")
	l.Flush()
	if err := l.Clear(); err != nil {
		t.Fatal(err)
	}
	l.Flush()
	lines, _ := l.Tail(100, "")
	for _, s := range lines {
		if strings.Contains(s, "before") {
			t.Fatal("clear kept old lines")
		}
	}
	if ents, _ := os.ReadDir(dir); len(ents) != 1 {
		t.Fatalf("expected one fresh session, have %d", len(ents))
	}
}

func TestZipHasNoSecretsAndIsNamedRight(t *testing.T) {
	l, dir := newLog(t, nil)
	l.Log("net", "s1", "W", "dbg s1: -> connect alice ember-tide-91")
	l.Log("settings", "", "", `password="topsecret" login ok`)
	l.Flush()
	// a line written by an older build, straight into the file with a secret in it, must also be cleaned in the zip
	cf := filepath.Join(dir, l.Session(), "current.log")
	f, _ := os.OpenFile(cf, os.O_APPEND|os.O_WRONLY, 0o600)
	_, _ = f.WriteString("old build: /pair ZZZZ-9999\n")
	_ = f.Close()
	dest := filepath.Join(t.TempDir(), ZipName("abc123-dirty 2026", time.Date(2026, 11, 15, 0, 0, 0, 0, time.UTC)))
	if filepath.Base(dest) != "squatclient-diagnostics-abc123-dirty-2026-2026-11-15.zip" {
		t.Fatalf("name %s", filepath.Base(dest))
	}
	res, err := l.BuildZip(dest, ZipOptions{Note: "my password is hunter22 sorry", System: "build abc\ntoken=ABCDEF1234"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Size == 0 || len(res.Files) < 4 {
		t.Fatalf("%+v", res)
	}
	zr, err := zip.OpenReader(dest)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	all := ""
	names := ""
	for _, zf := range zr.File {
		r, _ := zf.Open()
		b, _ := io.ReadAll(r)
		r.Close()
		all += string(b)
		names += zf.Name + " "
	}
	for _, secret := range []string{"ember-tide-91", "topsecret", "ZZZZ-9999", "hunter22", "ABCDEF1234"} {
		if strings.Contains(all, secret) {
			t.Errorf("secret %q in the zip", secret)
		}
	}
	if !strings.Contains(names, "README.txt") || !strings.Contains(names, "system.txt") || !strings.Contains(names, "note.txt") || !strings.Contains(names, "current.log") {
		t.Fatalf("zip content: %s", names)
	}
	if st, _ := os.Stat(dest); st.Mode().Perm() != 0o600 {
		t.Fatalf("perm %v", st.Mode())
	}
}

func TestZipCurrentOnly(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "diagnostics")
	p := Open(Config{Dir: dir, Enabled: true, Session: "20260101-000000", Flush: 10 * time.Millisecond})
	p.Log("net", "", "", "from the previous session")
	p.Close()
	l := Open(Config{Dir: dir, Enabled: true, Session: "20260102-000000", Flush: 10 * time.Millisecond})
	defer l.Close()
	l.Log("net", "", "", "from this session")
	count := func(only bool) string {
		dest := filepath.Join(t.TempDir(), "x.zip")
		if _, err := l.BuildZip(dest, ZipOptions{CurrentOnly: only}); err != nil {
			t.Fatal(err)
		}
		zr, _ := zip.OpenReader(dest)
		defer zr.Close()
		var names []string
		for _, f := range zr.File {
			names = append(names, f.Name)
		}
		return strings.Join(names, ",")
	}
	if both := count(false); !strings.Contains(both, "20260101-000000/") || !strings.Contains(both, "20260102-000000/") {
		t.Fatalf("both: %s", both)
	}
	if one := count(true); strings.Contains(one, "20260101-000000/") {
		t.Fatalf("current only: %s", one)
	}
}

func TestStatusReportsSizesAndRedactions(t *testing.T) {
	l, _ := newLog(t, nil)
	l.Log("net", "", "", "connect a b")
	st := l.Status()
	if !st.Enabled || len(st.Sessions) != 1 || !st.Sessions[0].Current || st.Sessions[0].Bytes == 0 {
		t.Fatalf("%+v", st)
	}
	time.Sleep(60 * time.Millisecond)
	l.Flush()
	if st = l.Status(); st.Sessions[0].Redactions < 1 {
		t.Fatalf("redactions not recorded: %+v", st)
	}
}
