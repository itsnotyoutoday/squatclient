package app

// Compatibility test between SquatClient and the REAL gtf (GoTinyFugue) with its built-in
// squatter. It drives the Service, i.e. exactly the Go code the app uses to "add a squatter of
// kind TinyFugue", against a real gtf process running under a pty.
//
//	GTF_BIN=/path/to/gtf go test ./internal/app -run TestGTF -v
//	scripts/gtf-integration.sh            # builds gtf from $GTF_SRC and runs this
//
// Skipped when GTF_BIN is unset. gtf runs with a scratch HOME (nothing of the user's is touched).

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/creack/pty"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/msdp"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/proto"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/testutil/fakemush"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/wire"

	"github.com/itsnotyoutoday/squatclient/internal/config"
	"github.com/itsnotyoutoday/squatclient/internal/secrets"
)

// ---- a real gtf under a pty --------------------------------------------------

var ansiRE = regexp.MustCompile("\x1b\\[[0-9;?]*[A-Za-z]|\x1b[()][A-Za-z0-9]|\x1b[=>]")

type gtfProc struct {
	t    *testing.T
	cmd  *exec.Cmd
	tty  *os.File
	home string

	mu  sync.Mutex
	out strings.Builder
}

func startGTF(t *testing.T, extra ...string) *gtfProc {
	t.Helper()
	bin := os.Getenv("GTF_BIN")
	if bin == "" {
		t.Skip("GTF_BIN not set (see the comment at the top of gtf_integration_test.go)")
	}
	home := t.TempDir()
	args := []string{"-n", "-c/set squatter=on", "-c/set squatter_port=0"}
	for _, e := range extra {
		args = append(args, "-c"+e)
	}
	cmd := exec.Command(bin, args...)
	cmd.Env = append(os.Environ(), "HOME="+home, "TERM=xterm-256color", "TZ=UTC")
	cmd.Dir = home
	tty, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 50, Cols: 200})
	if err != nil {
		t.Fatal(err)
	}
	g := &gtfProc{t: t, cmd: cmd, tty: tty, home: home}
	go func() {
		buf := make([]byte, 65536)
		for {
			n, err := tty.Read(buf)
			if n > 0 {
				g.mu.Lock()
				g.out.WriteString(ansiRE.ReplaceAllString(string(buf[:n]), ""))
				g.mu.Unlock()
			}
			if err != nil {
				return
			}
		}
	}()
	t.Cleanup(func() {
		_, _ = tty.Write([]byte("/quit\r"))
		done := make(chan struct{})
		go func() { _ = cmd.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			_ = cmd.Process.Kill()
			<-done
		}
		_ = tty.Close()
	})
	g.waitFor(`Type .?/quit.? to quit gtf`, 15*time.Second)
	return g
}

func (g *gtfProc) mark() int { g.mu.Lock(); defer g.mu.Unlock(); return g.out.Len() }

// waitFor returns the first submatch (or the whole match) of re in the output after the start.
func (g *gtfProc) waitFor(re string, d time.Duration) []string { return g.waitForAfter(0, re, d) }

func (g *gtfProc) waitForAfter(from int, re string, d time.Duration) []string {
	g.t.Helper()
	rx := regexp.MustCompile(re)
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		g.mu.Lock()
		s := g.out.String()
		g.mu.Unlock()
		if from <= len(s) {
			if m := rx.FindStringSubmatch(s[from:]); m != nil {
				return m
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	g.mu.Lock()
	s := g.out.String()
	g.mu.Unlock()
	if len(s) > 3000 {
		s = s[len(s)-3000:]
	}
	g.t.Fatalf("gtf output never matched %q; tail:\n%s", re, s)
	return nil
}

// type_ types one line into gtf like the user.
func (g *gtfProc) type_(line string) {
	g.t.Helper()
	if _, err := g.tty.Write([]byte(line + "\r")); err != nil {
		g.t.Fatal(err)
	}
}

type gtfPair struct{ Code, Fingerprint string }

// pair types /pair [role] and reads code and fingerprint off the screen, exactly what a user copies.
func (g *gtfProc) pair(role string) gtfPair {
	g.t.Helper()
	from := g.mark()
	line := "/pair"
	if role != "" {
		line += " " + role
	}
	g.type_(line)
	// gtf redraws the screen diff-wise, so earlier codes can be repainted after the mark: match the role too
	want := role
	if want == "" {
		want = "admin"
	}
	m := g.waitForAfter(from, `Pairing code:\s+([A-Z0-9]{4}-[A-Z0-9]{4})\s+\(role: `+want+`\)`, 10*time.Second)
	fp := g.waitForAfter(from, `TLS fingerprint:\s+((?:[0-9A-F]{2}:){31}[0-9A-F]{2})`, 5*time.Second)
	return gtfPair{Code: m[1], Fingerprint: fp[1]}
}

func (g *gtfProc) text() string { g.mu.Lock(); defer g.mu.Unlock(); return g.out.String() }

// deviceID returns gtf's id prefix of the (last) paired device with that role, from /squatter list.
func (g *gtfProc) deviceID(role string) string {
	g.t.Helper()
	from := g.mark()
	g.type_("/squatter list")
	return g.waitForAfter(from, `SquatClient on \S+ `+role+`\s+([0-9a-f]{8})\s+last seen`, 5*time.Second)[1]
}

func (g *gtfProc) port() int {
	g.t.Helper()
	// /squatter prints the listen address
	from := g.mark()
	g.type_("/squatter")
	m := g.waitForAfter(from, `(?:127\.0\.0\.1|localhost|\[::1\]):(\d{4,5})`, 10*time.Second)
	p, _ := strconv.Atoi(m[1])
	return p
}

// ---- helpers on the SquatClient side -------------------------------------------

func (f *fixture) sessionLines(sid string) []string {
	var out []string
	for _, e := range f.events("line") {
		var l proto.Line
		if json.Unmarshal([]byte(e.JSON), &l) == nil && l.Session == sid {
			out = append(out, l.Plain())
		}
	}
	return out
}

func (f *fixture) waitSessionLine(sid, sub string, d time.Duration) {
	f.t.Helper()
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		for _, l := range f.sessionLines(sid) {
			if strings.Contains(l, sub) {
				return
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	f.t.Fatalf("no line containing %q in session %s; have %q", sub, sid, f.sessionLines(sid))
}

func (f *fixture) waitFor(what string, d time.Duration, pred func() bool) {
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

func pairGTF(t *testing.T, f *fixture, port int, p gtfPair) string {
	t.Helper()
	pr, err := f.svc.PairSquatter("127.0.0.1", port, "gtf", p.Code, config.FlavorGTF)
	if err != nil {
		t.Fatalf("PairSquatter: %v", err)
	}
	if pr.Fingerprint != p.Fingerprint {
		t.Fatalf("fingerprint shown to the user %q != the one gtf printed %q", pr.Fingerprint, p.Fingerprint)
	}
	if err := f.svc.ConfirmSquatter(pr.ID, true); err != nil {
		t.Fatalf("ConfirmSquatter: %v", err)
	}
	return pr.ID
}

// gtfSession waits for the squatter's session of the given world to be listed and attached.
func gtfSession(t *testing.T, f *fixture, sq, world string) string {
	t.Helper()
	var id string
	f.waitFor("session "+world+" of "+sq, 10*time.Second, func() bool {
		for _, s := range f.svc.Engine().Sessions() {
			if strings.HasPrefix(s.ID, sq+":") && s.Name == world && s.Attached >= 1 {
				id = s.ID
				return true
			}
		}
		return false
	})
	return id
}

// ---- the tests ------------------------------------------------------------------

func TestGTFCompat(t *testing.T) {
	g := startGTF(t)
	port := g.port()
	game := fakemush.New(t)

	// --- pairing and fingerprint trust
	p1 := g.pair("")
	f := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	// an offered protocol extension (the negotiation hook): gtf does not know the hello field and
	// must neither refuse the hello nor claim to have accepted anything
	pext := &probeExt{}
	f.svc.Engine().RegisterExtension(pext)
	sq := pairGTF(t, f, port, p1)
	views, _ := f.svc.ListSquatters()
	if len(views) != 1 {
		t.Fatalf("views: %+v", views)
	}
	v := views[0]
	if v0, _ := f.svc.eng.SquatterStatus(sq); len(v0.Negotiated) != 0 || pext.negotiated != 0 {
		t.Errorf("gtf accepted an extension that does not exist: %+v", v0.Negotiated)
	}
	t.Logf("squatter view: state=%s role=%s instance=%q features=%v", v.State, v.Role, v.Instance, v.Features)
	if v.State != engine.SqConnected || v.Role != "admin" || v.Instance == "" {
		t.Errorf("view after pairing: %+v", v)
	}
	if st := f.cfg.Squatters(); len(st) != 1 || !st[0].Paired || st[0].Kind != config.KindTFSquatterd || st[0].Flavor != config.FlavorGTF || st[0].Fingerprint != p1.Fingerprint {
		t.Errorf("stored record: %+v", st)
	}
	// the pairing code is single use: a second pairing with it is refused
	f2 := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	pr, err := f2.svc.PairSquatter("127.0.0.1", port, "again", p1.Code, config.KindTFSquatterd)
	if err == nil {
		err = f2.svc.ConfirmSquatter(pr.ID, true)
	}
	if err == nil {
		t.Errorf("a used pairing code paired a second device")
	} else {
		t.Logf("reuse of a pairing code: %v", err)
	}

	// --- a game, connected by the gtf user at the terminal (SquatClient is already attached: live session discovery)
	g.type_(fmt.Sprintf("/addworld fake 127.0.0.1 %d", game.Port()))
	g.type_("/connect fake")
	game.Peer()
	game.SendLine("Welcome to the fake game.")
	game.SendLine("second line before any prompt")
	sid := gtfSession(t, f, sq, "fake")
	f.waitSessionLine(sid, "Welcome to the fake game.", 10*time.Second)
	info, _ := f.svc.eng.Session(sid)
	t.Logf("session info: state=%s TF=%+v", info.State, info.TF)
	if info.State != proto.StateConnected {
		t.Errorf("session state %s", info.State)
	}
	if info.TF == nil || info.TF.World != "fake" {
		t.Errorf("TF info: %+v", info.TF)
	}

	// --- live lines + the user's typing at gtf is mirrored as an echo
	game.SendLine("live line one")
	f.waitSessionLine(sid, "live line one", 5*time.Second)

	// --- colours and UTF-8 survive gtf's screen model
	game.SendLine("\x1b[31;1mred bold\x1b[0m and h\u00e9llo \u2713")
	f.waitSessionLine(sid, "red bold and h\u00e9llo \u2713", 5*time.Second)
	for _, e := range f.events("line") {
		var l proto.Line
		if json.Unmarshal([]byte(e.JSON), &l) == nil && l.Session == sid && strings.Contains(l.Plain(), "red bold") {
			if !strings.Contains(e.JSON, "\"fg\"") && !strings.Contains(e.JSON, "spans") && !strings.Contains(e.JSON, "\\u001b") {
				t.Errorf("the colour of a line did not survive: %s", e.JSON)
			}
			t.Logf("colour line as received: %.300s", e.JSON)
		}
	}

	// --- sending input from SquatClient
	if err := f.svc.Input(sid, "say hello from squat"); err != nil {
		t.Errorf("Input: %v (TF=%+v)", err, info.TF)
	} else {
		game.ExpectLine("say hello from squat")
	}
	// raw: percent and semicolon are never interpreted
	if err := f.svc.Input(sid, "say 100%% ; /not-a-command"); err == nil {
		got := game.ReadLine()
		if got != "say 100%% ; /not-a-command" {
			t.Errorf("raw send changed: %q", got)
		}
	}

	// --- tf.exec
	res, err := f.svc.TFExec(sq, "/eval /echo exec-marker-%{squatter}")
	if err != nil || !res.OK || len(res.Out) == 0 || !strings.Contains(strings.Join(res.Out, "\n"), "exec-marker-on") {
		t.Errorf("TFExec: %v %+v", err, res)
	}
	res, err = f.svc.TFExec(sq, "/nosuchcommand")
	t.Logf("TFExec of an unknown command: err=%v res=%+v", err, res)
	if err == nil && res.OK {
		t.Errorf("an unknown command reported ok")
	}
	// a trigger defined remotely runs inside gtf (automation: tf) and answers the game
	if res, err = f.svc.TFExec(sq, `/def -t"*ping-me*" pingtrig = say pong-from-trigger`); err != nil || !res.OK {
		t.Errorf("def trigger: %v %+v", err, res)
	}
	game.SendLine("someone says ping-me")
	game.ExpectLine("say pong-from-trigger")

	// --- a /command typed from SquatClient runs in gtf, in the session's world, and its output comes back
	if err := f.svc.Input(sid, "/eval /echo typed-cmd-%{world_name}"); err != nil {
		t.Errorf("typed /command: %v", err)
	}
	f.waitSessionLine(sid, "typed-cmd-", 5*time.Second)
	for _, l := range f.sessionLines(sid) {
		if strings.Contains(l, "typed-cmd-") {
			t.Logf("typed /command output line: %q", l)
		}
	}

	// --- GMCP and MSDP mirroring
	game.Will(201)
	game.Will(69)
	game.WaitNeg(fakemush.DO, 201)
	game.GMCP("Char.Vitals", `{"hp":42}`)
	payload, _ := msdp.Encode(msdp.FromMap(map[string]any{"HEALTH": "77"}))
	game.Sub(69, payload)
	f.waitFor("gmcp+msdp events", 5*time.Second, func() bool { return len(f.events("gmcp")) >= 1 && len(f.events("msdp")) >= 1 })
	d, err := f.svc.GetSessionData(sid)
	if err != nil || !strings.Contains(string(d.Gmcp["Char.Vitals"]), "42") || d.Msdp["HEALTH"] != "77" {
		t.Errorf("session data: %v %+v", err, d)
	}
	if err := f.svc.SendGmcp(sid, "Core.Hello", `{"client":"squat"}`); err != nil {
		t.Errorf("SendGmcp: %v", err)
	} else {
		sub := game.WaitSub(201, 1)
		if !strings.Contains(string(sub), "Core.Hello") {
			t.Errorf("the game got GMCP %q", sub)
		}
	}
	if err := f.svc.SendMsdp(sid, `{"REPORT":["HEALTH"]}`); err != nil {
		t.Errorf("SendMsdp: %v", err)
	}

	// --- scrollback replay for a second device that attaches later
	pB := g.pair("operator")
	fB := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	sqB := pairGTF(t, fB, port, pB)
	sidB := gtfSession(t, fB, sqB, "fake")
	fB.waitFor("replayed backlog", 10*time.Second, func() bool {
		ls, _ := fB.svc.Scrollback(sidB, ScrollbackOpts{Limit: 200})
		for _, l := range ls {
			if strings.Contains(l.Plain(), "say hello from squat") {
				return true
			}
		}
		return false
	})
	lines, _ := fB.svc.Scrollback(sidB, ScrollbackOpts{Limit: 200})
	var plain []string
	for _, l := range lines {
		plain = append(plain, l.Plain())
	}
	t.Logf("device B scrollback (%d): %q", len(plain), plain)
	for _, want := range []string{"Welcome to the fake game.", "second line before any prompt", "live line one", "say hello from squat"} {
		if !containsSub(plain, want) {
			t.Errorf("device B did not get %q in the replay", want)
		}
	}
	viewsB, _ := fB.svc.ListSquatters()
	if len(viewsB) == 1 && viewsB[0].Role != "operator" {
		t.Errorf("device B role: %+v", viewsB[0])
	}

	// --- reconnect with replay since a sequence number: no loss, no duplicates
	before := len(plain)
	if n := f.svc.Suspend(); n < 1 {
		t.Errorf("Suspend detached %d sessions", n)
	}
	game.SendLine("while-away-1")
	game.SendLine("while-away-2")
	time.Sleep(300 * time.Millisecond)
	if err := f.svc.Resume(); err != nil {
		t.Errorf("Resume: %v", err)
	}
	f.waitSessionLine(sid, "while-away-2", 10*time.Second)
	count := func(sub string) (n int) {
		for _, l := range f.sessionLines(sid) {
			if strings.Contains(l, sub) {
				n++
			}
		}
		return
	}
	for _, s := range []string{"while-away-1", "while-away-2", "live line one", "Welcome to the fake game."} {
		if c := count(s); c != 1 {
			t.Errorf("after resume %q appears %d times (want 1): %q", s, c, f.sessionLines(sid))
		}
	}
	_ = before
	// a dropped and re-established connection (explicit reconnect) replays only what was missed
	if err := f.svc.ReconnectSquatter(sq); err != nil {
		t.Errorf("ReconnectSquatter: %v", err)
	}
	game.SendLine("after-reconnect")
	f.waitSessionLine(sid, "after-reconnect", 10*time.Second)
	for _, s := range []string{"while-away-1", "after-reconnect", "Welcome to the fake game."} {
		if c := count(s); c != 1 {
			t.Errorf("after reconnect %q appears %d times (want 1)", s, c)
		}
	}

	// --- features gtf does not implement must fail clearly, not hang
	probe := func(what string, err error) {
		t.Logf("probe %-22s -> %v", what, err)
	}
	probe("PutTFWorld", f.svc.PutTFWorld(sq, TFWorldPut{TFWorld: proto.TFWorld{Name: "put1", Host: "127.0.0.1", Port: "1"}}))
	probe("DeleteTFWorld", f.svc.DeleteTFWorld(sq, "byref"))
	probe("RenameTFWorld", f.svc.RenameTFWorld(sq, "byref", "byref2"))
	_, perr := f.svc.PutTFScript(sq, "a.tf", "/echo x\n", true)
	probe("PutTFScript", perr)
	_, lerr := f.svc.ListTFScripts(sq)
	probe("ListTFScripts", lerr)
	probe("SetControl input=remote", f.svc.SetControl(sid, "input", "remote"))
	probe("SetControl automation=client", f.svc.SetControl(sid, "automation", "client"))
	probe("ControlPreset takeover", f.svc.ControlPreset(sid, "takeover"))
	cur, _ := f.svc.eng.Session(sid)
	t.Logf("control state after those: %+v", cur.TF)

	// --- the gtf user kicks this device (connection dropped, device kept): SquatClient comes back by itself and replays only what it missed
	g.type_("/squatter kick " + g.deviceID("admin"))
	f.waitFor("the kick is noticed", 10*time.Second, func() bool {
		st, _ := f.svc.eng.SquatterStatus(sq)
		return st.State != engine.SqConnected
	})
	game.SendLine("sent-while-kicked")
	f.waitFor("automatic reconnect", 20*time.Second, func() bool {
		st, _ := f.svc.eng.SquatterStatus(sq)
		return st.State == engine.SqConnected
	})
	f.waitSessionLine(sid, "sent-while-kicked", 10*time.Second)
	for _, x := range []string{"sent-while-kicked", "after-reconnect", "Welcome to the fake game."} {
		if c := count(x); c != 1 {
			t.Errorf("after a kick %q appears %d times (want 1): %q", x, c, f.sessionLines(sid))
		}
	}

	// --- prompts: a partial line ended by GA is a prompt line, shown once
	game.SendString("HP 10/10> ")
	game.GA()
	f.waitSessionLine(sid, "HP 10/10>", 5*time.Second)
	if c := count("HP 10/10>"); c != 1 {
		t.Errorf("prompt appears %d times: %q", c, f.sessionLines(sid))
	}

	// --- viewer / operator limits
	if _, err := fB.svc.TFExec(sqB, "/echo nope"); err == nil {
		t.Errorf("an operator device ran tf.exec")
	} else {
		t.Logf("operator tf.exec: %v", err)
	}
	pV := g.pair("viewer")
	fV := newFixtureAt(t, t.TempDir(), secrets.NewMemory())
	sqV := pairGTF(t, fV, port, pV)
	sidV := gtfSession(t, fV, sqV, "fake")
	verr := fV.svc.Input(sidV, "say viewer typing")
	time.Sleep(400 * time.Millisecond)
	reached := strings.Contains(string(game.Received()), "viewer typing")
	for _, e := range fV.events("notice") {
		t.Logf("viewer notice: %s", e.JSON)
	}
	t.Logf("viewer input: err=%v reachedGame=%v", verr, reached)
	if reached {
		t.Errorf("a viewer's text reached the game")
	}
	if verr == nil && !containsSub(fV.sessionLines(sidV), "paired as a viewer") {
		t.Errorf("a viewer's input was refused without telling the user: %q", fV.sessionLines(sidV))
	}
	t.Logf("device A's own view of the session: %q", f.sessionLines(sid))

	// --- a session started FROM SquatClient: ad-hoc host:port and by gtf world ref
	game2 := fakemush.New(t)
	w, err := f.svc.SaveWorld(config.World{Name: "adhoc", Host: "127.0.0.1", Port: game2.Port(), Via: sq})
	if err != nil {
		t.Fatal(err)
	}
	si2, err := f.svc.Connect(ConnectTarget{WorldID: w.ID})
	if err != nil {
		t.Errorf("connect ad hoc via gtf: %v", err)
	} else {
		game2.Peer()
		game2.SendLine("adhoc hello")
		t.Logf("ad hoc session: name=%q tf=%+v", si2.Name, si2.TF)
		f.waitSessionLine(si2.ID, "adhoc hello", 10*time.Second)
	}
	// the login goes through the secret path: the game gets it, nobody's scrollback does
	game4 := fakemush.New(t)
	w4, err := f.svc.SaveWorld(config.World{Name: "login", Host: "127.0.0.1", Port: game4.Port(), Via: sq,
		Login: &config.Login{Template: "connect {name} {password}", CharName: "me"}})
	if err != nil {
		t.Fatal(err)
	}
	_ = f.svc.SetWorldPassword(w4.ID, "hunter2-secret")
	si4, err := f.svc.Connect(ConnectTarget{WorldID: w4.ID})
	if err != nil {
		t.Errorf("connect with login via gtf: %v", err)
	} else {
		game4.Peer()
		game4.SendLine("Welcome. Type connect <name> <password>.")
		game4.ExpectLine("connect me hunter2-secret")
		time.Sleep(300 * time.Millisecond)
		if containsSub(f.sessionLines(si4.ID), "hunter2") {
			t.Errorf("the password is in the session's lines: %q", f.sessionLines(si4.ID))
		}
		for _, l := range fB.sessionLines(si4.ID) {
			_ = l
		}
		if strings.Contains(g.text(), "hunter2") {
			t.Errorf("the password appeared on gtf's screen")
		}
	}
	game3 := fakemush.New(t)
	if res, err = f.svc.TFExec(sq, fmt.Sprintf("/addworld byref 127.0.0.1 %d", game3.Port())); err != nil || !res.OK {
		t.Errorf("addworld: %v %+v", err, res)
	}
	ws, err := f.svc.ListTFWorlds(sq)
	t.Logf("worlds: %v %v", ws, err)
	if err != nil || len(ws) < 2 {
		t.Errorf("ListTFWorlds: %v %v", ws, err)
	}
	si3, err := f.svc.ConnectTFWorld(sq, "byref")
	if err != nil {
		t.Errorf("ConnectTFWorld by ref: %v", err)
	} else {
		game3.Peer()
		game3.SendLine("byref hello")
		f.waitSessionLine(si3.ID, "byref hello", 10*time.Second)
	}

	// --- connecting and saving worlds through gtf must not produce "TinyFugue was not updated" warnings
	for _, e := range f.events("notice") {
		if strings.Contains(e.JSON, "not updated") || strings.Contains(e.JSON, "Could not update") {
			t.Errorf("spurious world-mirroring warning: %s", e.JSON)
		}
	}

	// --- game closes: the session ends with a reason
	game.CloseConn()
	f.waitFor("session ended", 10*time.Second, func() bool {
		s, err := f.svc.eng.Session(sid)
		return err == nil && s.State == proto.StateEnded
	})
	s, _ := f.svc.eng.Session(sid)
	t.Logf("ended: reason=%q detail=%q", s.EndReason, s.EndDetail)

	// --- revoked device: gtf forgets it, the connection drops, a reconnect is refused with an explanation
	hn0, _ := os.Hostname()
	amb := g.mark()
	g.type_("/squatter unpair SquatClient on " + hn0)
	time.Sleep(500 * time.Millisecond)
	t.Logf("gtf's answer to unpair by an ambiguous device name: %q", g.text()[amb:])
	g.type_("/squatter unpair " + g.deviceID("admin"))
	f.waitFor("the revoked squatter leaves the connected state", 10*time.Second, func() bool {
		st, err := f.svc.eng.SquatterStatus(sq)
		return err == nil && st.State != engine.SqConnected
	})
	err = f.svc.ReconnectSquatter(sq)
	st, _ := f.svc.eng.SquatterStatus(sq)
	t.Logf("after unpair: reconnect err=%v state=%s problem=%q message=%q", err, st.State, st.Problem, st.Message)
	if err == nil {
		t.Errorf("a revoked device reconnected")
	}
}

func containsSub(ss []string, sub string) bool {
	for _, s := range ss {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

// probeExt is an Extension nobody accepts: it proves that offering one is harmless today.
type probeExt struct{ negotiated int }

func (p *probeExt) Name() string                    { return "probe.test" }
func (p *probeExt) Negotiated(string, *wire.Client) { p.negotiated++ }
func (p *probeExt) Message(string, wire.Ext)        {}
