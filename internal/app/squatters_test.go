package app

import (
	"bytes"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/proto"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/testutil/fakemush"

	"github.com/itsnotyoutoday/squatclient/internal/config"
	"github.com/itsnotyoutoday/squatclient/internal/secrets"
)

// realSquatterd builds and runs the REAL squatterd binary on a free port.
type realSquatterd struct {
	t    *testing.T
	bin  string
	dir  string
	port int
	fp   string
}

var builtBin string

func buildSquatterd(t *testing.T) string {
	t.Helper()
	if builtBin != "" {
		return builtBin
	}
	dir, err := os.MkdirTemp("", "squatterd-bin")
	if err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(dir, "squatterd")
	out, err := exec.Command("go", "build", "-o", bin, "github.com/itsnotyoutoday/squatClientDaemon/cmd/squatterd").CombinedOutput()
	if err != nil {
		t.Fatalf("building squatterd: %v\n%s", err, out)
	}
	builtBin = bin
	return bin
}

func startSquatterd(t *testing.T) *realSquatterd {
	t.Helper()
	bin := buildSquatterd(t)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	d := &realSquatterd{t: t, bin: bin, dir: t.TempDir(), port: port}
	cmd := exec.Command(bin, "serve", "--data-dir", d.dir, "--bind", "127.0.0.1", "--port", strconv.Itoa(port))
	var stderr bytes.Buffer
	cmd.Stderr, cmd.Stdout = &stderr, &stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Signal(os.Interrupt)
		done := make(chan struct{})
		go func() { _ = cmd.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			_ = cmd.Process.Kill()
			<-done
		}
	})
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if c, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), 200*time.Millisecond); err == nil {
			c.Close()
			return d
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("squatterd did not start: %s", stderr.String())
	return nil
}

var codeRe = regexp.MustCompile(`Pairing code:\s+(\S+)`)
var fpRe = regexp.MustCompile(`TLS fingerprint:\s+(\S+)`)

// pairCode runs `squatterd pair` and returns the code (and records the fingerprint it prints).
func (d *realSquatterd) pairCode() string {
	d.t.Helper()
	out, err := exec.Command(d.bin, "pair", "--data-dir", d.dir).CombinedOutput()
	if err != nil {
		d.t.Fatalf("squatterd pair: %v\n%s", err, out)
	}
	m := codeRe.FindSubmatch(out)
	f := fpRe.FindSubmatch(out)
	if m == nil || f == nil {
		d.t.Fatalf("cannot parse pair output:\n%s", out)
	}
	d.fp = string(f[1])
	return string(m[1])
}

func fileContains(t *testing.T, root, needle string) []string {
	t.Helper()
	var hits []string
	_ = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			if b, e := os.ReadFile(p); e == nil && strings.Contains(string(b), needle) {
				hits = append(hits, p)
			}
		}
		return nil
	})
	return hits
}

func TestSquatterPairViaRealDaemonAndReattach(t *testing.T) {
	d := startSquatterd(t)
	game := fakemush.New(t, fakemush.WithGreeting("Welcome\r\n"))
	dir := t.TempDir()
	sec := secrets.NewMemory()
	f := newFixtureAt(t, dir, sec)

	code := d.pairCode()
	// trust on first use: the first step must not use up the code
	pr, err := f.svc.PairSquatter("127.0.0.1", d.port, "Home", code, "")
	if err != nil || pr.Fingerprint != d.fp || pr.ID == "" {
		t.Fatalf("pair: %+v %v (want %s)", pr, err, d.fp)
	}
	if l, _ := f.svc.ListSquatters(); len(l) != 0 {
		t.Fatalf("squatter stored before the user confirmed: %+v", l)
	}
	if err := f.svc.ConfirmSquatter(pr.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.ConfirmSquatter(pr.ID, true); err == nil {
		t.Fatal("a rejected pairing must be gone")
	}
	pr, err = f.svc.PairSquatter("127.0.0.1", d.port, "Home", code, "") // same code still valid
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.ConfirmSquatter(pr.ID, true); err != nil {
		t.Fatalf("confirm: %v", err)
	}
	list, _ := f.svc.ListSquatters()
	if len(list) != 1 || !list[0].Paired || list[0].Fingerprint != d.fp || list[0].State != engine.SqConnected {
		t.Fatalf("list: %+v", list)
	}
	// device key: in the keychain, never in a file; the pairing code is never stored
	if _, err := sec.Get(secrets.DeviceKey); err != nil {
		t.Fatalf("device key not in keychain: %v", err)
	}
	k, _ := sec.Get(secrets.DeviceKey)
	if h := fileContains(t, dir, k); len(h) != 0 {
		t.Fatalf("device key written to disk: %v", h)
	}
	if h := fileContains(t, dir, code); len(h) != 0 {
		t.Fatalf("pairing code written to disk: %v", h)
	}
	// the same code cannot pair twice (single use)
	if _, err := f.svc.PairSquatter("127.0.0.1", d.port, "again", code, ""); err != nil {
		t.Fatal(err) // the probe itself succeeds; confirming would fail at the daemon
	}

	// a world that goes through the squatter
	w, err := f.svc.SaveWorld(config.World{Name: "G", Host: game.Host(), Port: game.Port(), Via: list[0].ID,
		Login: &config.Login{Template: "connect {name} {password}", CharName: "bob"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.SetWorldPassword(w.ID, "s3cret"); err != nil {
		t.Fatal(err)
	}
	si, err := f.svc.Connect(ConnectTarget{WorldID: w.ID})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(si.ID, list[0].ID+":") || si.Via != list[0].ID {
		t.Fatalf("session %+v", si)
	}
	f.waitConnected(si.ID)
	game.ExpectLine("connect bob s3cret")
	f.waitLine("Welcome")
	game.SendLine("first")
	f.waitLine("first")
	sawSquatterEvt := false
	for _, e := range f.events("squatter") {
		if strings.Contains(e.JSON, `"state":"connected"`) {
			sawSquatterEvt = true
		}
	}
	if !sawSquatterEvt {
		t.Fatal("no squatter state event")
	}
	foundLink := false
	for _, e := range f.events("session") {
		if strings.Contains(e.JSON, `"link":"attached"`) && strings.Contains(e.JSON, `"via":"`+list[0].ID+`"`) {
			foundLink = true
		}
	}
	if !foundLink {
		t.Fatal("session events carry no via/link")
	}

	// ---- /suspend: detach, window minimise, Resume replays
	if n := f.svc.Suspend(); n != 1 {
		t.Fatalf("suspend detached %d", n)
	}
	f.until("window + suspend events", func() bool {
		f.mu.Lock()
		w := len(f.windows)
		f.mu.Unlock()
		return w == 1 && len(f.events("suspend")) == 1
	})
	game.SendLine("while suspended")
	time.Sleep(300 * time.Millisecond)
	if err := f.svc.Resume(); err != nil {
		t.Fatal(err)
	}
	f.waitLine("while suspended")

	// ---- the app closes; the daemon keeps the session; a restart reattaches
	f.svc.Shutdown()
	game.SendLine("while closed")
	time.Sleep(300 * time.Millisecond)
	f2 := newFixtureAt(t, dir, sec)
	f2.waitLine("while closed")
	f2.until("away event", func() bool { return len(f2.events("away")) > 0 })
	if a := f2.events("away")[0].JSON; !strings.Contains(a, "while") && !strings.Contains(a, `"unread"`) {
		t.Fatalf("away payload %s", a)
	}
	n := 0
	for _, e := range f2.events("line") {
		if strings.Contains(e.JSON, "while closed") {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("replayed line shown %d times", n)
	}
	l2, _ := f2.svc.ListSquatters()
	if len(l2) != 1 || l2[0].State != engine.SqConnected || l2[0].Sessions != 1 {
		t.Fatalf("after restart: %+v", l2)
	}
	// ended session surfaced with reason
	game.CloseConn()
	f2.until("ended", func() bool {
		ss, _ := f2.svc.ListSessions()
		return len(ss) == 1 && ss[0].State == proto.StateEnded && ss[0].EndReason == proto.EndRemoteClosed
	})

	// remove forgets locally
	if err := f2.svc.RemoveSquatter(list[0].ID); err != nil {
		t.Fatal(err)
	}
	if l, _ := f2.svc.ListSquatters(); len(l) != 0 {
		t.Fatal("not removed")
	}
	if ss, _ := f2.svc.ListSessions(); len(ss) != 0 {
		t.Fatalf("mirrored sessions remain: %+v", ss)
	}
}

func TestSquatterFingerprintMismatchRefusedOnStart(t *testing.T) {
	d := startSquatterd(t)
	dir := t.TempDir()
	sec := secrets.NewMemory()
	f := newFixtureAt(t, dir, sec)
	pr, err := f.svc.PairSquatter("127.0.0.1", d.port, "Home", d.pairCode(), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.ConfirmSquatter(pr.ID, true); err != nil {
		t.Fatal(err)
	}
	f.svc.Shutdown()
	// someone replaces the stored pin (or the server's certificate changed)
	cs, _ := config.Open(filepath.Join(dir, "cfg"))
	q := cs.Squatters()[0]
	q.Fingerprint = strings.Repeat("AB:", 31) + "AB"
	if _, err := cs.SaveSquatter(q); err != nil {
		t.Fatal(err)
	}
	f2 := newFixtureAt(t, dir, sec)
	f2.until("refused", func() bool {
		l, _ := f2.svc.ListSquatters()
		return len(l) == 1 && l[0].State == engine.SqRefused
	})
	l, _ := f2.svc.ListSquatters()
	if l[0].Problem != engine.ProblemFingerprint || !strings.Contains(l[0].Message, "Refusing") {
		t.Fatalf("%+v", l[0])
	}
	w, _ := f2.svc.SaveWorld(config.World{Name: "G", Host: "127.0.0.1", Port: 9, Via: l[0].ID})
	if _, err := f2.svc.Connect(ConnectTarget{WorldID: w.ID}); err == nil || !strings.Contains(err.Error(), "Refusing") {
		t.Fatalf("connect via refused squatter: %v", err)
	}
}

func TestSquatterUnreachableAtStartAndPairErrors(t *testing.T) {
	f := newFixture(t)
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	if _, err := f.svc.PairSquatter("127.0.0.1", port, "x", "AAAA-BBBB", ""); err == nil || !strings.Contains(err.Error(), "cannot reach") {
		t.Fatalf("pair to a closed port: %v", err)
	}
	if _, err := f.svc.PairSquatter("", 1, "x", "c", ""); err == nil {
		t.Fatal("empty host accepted")
	}
	if _, err := f.svc.PairSquatter("h", 1, "x", " ", ""); err == nil {
		t.Fatal("empty code accepted")
	}
	if err := f.svc.ConfirmSquatter("nope", true); err == nil {
		t.Fatal("unknown pending id accepted")
	}
	// keychain unavailable: no plaintext fallback, and the squatter is not stored
	d := startSquatterd(t)
	pr, err := f.svc.PairSquatter("127.0.0.1", d.port, "x", d.pairCode(), "")
	if err != nil {
		t.Fatal(err)
	}
	f.sec.Fail = true
	if err := f.svc.ConfirmSquatter(pr.ID, true); err == nil {
		t.Fatal("confirmed without a keychain")
	}
	if l, _ := f.svc.ListSquatters(); len(l) != 0 {
		t.Fatal("stored without a key")
	}
	f.sec.Fail = false
}
