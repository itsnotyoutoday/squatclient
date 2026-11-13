package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/testutil/fakemush"

	"github.com/itsnotyoutoday/squatclient/internal/config"
	"github.com/itsnotyoutoday/squatclient/internal/secrets"
)

func newHist(t *testing.T, max int) (*historyStore, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "history")
	return newHistoryStore(dir, func() int { return max }), dir
}

func texts(p HistoryPage) []string {
	var out []string
	for _, e := range p.Entries {
		out = append(out, e.Text)
	}
	return out
}

func TestHistoryRoundTripNewestFirstAndMultiline(t *testing.T) {
	h, dir := newHist(t, 100)
	for _, s := range []string{"look", "north", "&F obj=a\nb\nc", "south"} {
		if ok, err := h.record("w-1", s); !ok || err != nil {
			t.Fatalf("record %q: %v %v", s, ok, err)
		}
	}
	p, err := h.query("w-1", "", HistoryOpts{})
	if err != nil || p.Total != 4 {
		t.Fatal(err, p)
	}
	if got := strings.Join(texts(p), "|"); got != "south|&F obj=a\nb\nc|north|look" {
		t.Fatalf("order/multiline: %q", got)
	}
	// a fresh store on the same dir (an app restart) sees the same data and keeps ids increasing
	h2 := newHistoryStore(dir, func() int { return 100 })
	p2, _ := h2.query("w-1", "", HistoryOpts{})
	if strings.Join(texts(p2), "|") != strings.Join(texts(p), "|") {
		t.Fatal("reload differs")
	}
	h2.record("w-1", "east")
	p3, _ := h2.query("w-1", "", HistoryOpts{Limit: 1})
	if p3.Entries[0].Text != "east" || p3.Entries[0].ID <= p2.Entries[0].ID || p3.Total != 5 {
		t.Fatalf("%+v", p3)
	}
	if p3.Entries[0].TS == 0 {
		t.Fatal("no timestamp")
	}
}

func TestHistoryDedupeBlankAndOversize(t *testing.T) {
	h, _ := newHist(t, 100)
	h.record("k", "a")
	if ok, _ := h.record("k", "a"); ok {
		t.Fatal("consecutive duplicate stored")
	}
	if ok, _ := h.record("k", "  \n\t"); ok {
		t.Fatal("blank stored")
	}
	h.record("k", "b")
	if ok, _ := h.record("k", "a"); !ok {
		t.Fatal("non-consecutive repeat must be stored")
	}
	if _, err := h.record("k", strings.Repeat("x", maxHistoryText+1)); err == nil {
		t.Fatal("oversize accepted")
	}
	p, _ := h.query("k", "", HistoryOpts{})
	if p.Total != 3 {
		t.Fatalf("total %d", p.Total)
	}
}

func TestHistoryCapDropsOldestInMemoryAndOnDisk(t *testing.T) {
	h, dir := newHist(t, 100)
	for i := 0; i < 300; i++ {
		h.record("k", fmt.Sprintf("cmd %d", i))
	}
	p, _ := h.query("k", "", HistoryOpts{})
	if p.Total != 100 || p.Entries[0].Text != "cmd 299" || p.Entries[99].Text != "cmd 200" {
		t.Fatalf("cap: total %d first %q last %q", p.Total, p.Entries[0].Text, p.Entries[len(p.Entries)-1].Text)
	}
	// the file is compacted (never more than cap + 25% + 1 lines) and reloads to the cap
	b, _ := os.ReadFile(filepath.Join(dir, historyFile("k")))
	if n := strings.Count(string(b), "\n"); n > 126 {
		t.Fatalf("file not compacted: %d lines", n)
	}
	h2 := newHistoryStore(dir, func() int { return 50 }) // lowering the cap trims on load
	p2, _ := h2.query("k", "", HistoryOpts{})
	if p2.Total != 50 || p2.Entries[0].Text != "cmd 299" {
		t.Fatalf("reload cap: %d", p2.Total)
	}
}

func TestHistoryDeleteClearAndAtomicity(t *testing.T) {
	h, dir := newHist(t, 100)
	for _, s := range []string{"a", "b", "c"} {
		h.record("k", s)
	}
	p, _ := h.query("k", "b", HistoryOpts{})
	if err := h.remove("k", p.Entries[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := h.remove("k", 9999); err != nil {
		t.Fatal("deleting a missing id must be a no-op:", err)
	}
	h2 := newHistoryStore(dir, func() int { return 100 })
	if q, _ := h2.query("k", "", HistoryOpts{}); strings.Join(texts(q), "") != "ca" {
		t.Fatalf("after delete: %v", texts(q))
	}
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		if strings.Contains(e.Name(), ".tmp-") {
			t.Fatalf("temp file left behind: %s", e.Name())
		}
		if info, _ := e.Info(); info.Mode().Perm() != 0o600 {
			t.Fatalf("history file mode %v", info.Mode().Perm())
		}
	}
	if err := h.clear("k"); err != nil {
		t.Fatal(err)
	}
	if q, _ := h.query("k", "", HistoryOpts{}); q.Total != 0 || len(q.Entries) != 0 {
		t.Fatal("not cleared")
	}
	if _, err := os.Stat(filepath.Join(dir, historyFile("k"))); !os.IsNotExist(err) {
		t.Fatal("file survives clear")
	}
	h.record("k", "again") // usable after clear
	if q, _ := h.query("k", "", HistoryOpts{}); q.Total != 1 {
		t.Fatal("record after clear")
	}
}

func TestHistoryTornAndCorruptLinesSkipped(t *testing.T) {
	h, dir := newHist(t, 100)
	h.record("k", "good1")
	h.record("k", "good2")
	f, _ := os.OpenFile(filepath.Join(dir, historyFile("k")), os.O_APPEND|os.O_WRONLY, 0o600)
	f.WriteString("not json\n{\"id\":99,\"ts\":1,\"te") // torn final write
	f.Close()
	h2 := newHistoryStore(dir, func() int { return 100 })
	p, err := h2.query("k", "", HistoryOpts{})
	if err != nil || p.Total != 2 {
		t.Fatalf("%v %+v", err, p)
	}
}

func TestHistoryConcurrentRecord(t *testing.T) {
	h, dir := newHist(t, 5000)
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 100; i++ {
				if _, err := h.record("k", fmt.Sprintf("g%d-%d", g, i)); err != nil {
					t.Error(err)
				}
				if i%25 == 0 {
					h.query("k", "g1", HistoryOpts{})
				}
			}
		}(g)
	}
	wg.Wait()
	p, _ := h.query("k", "", HistoryOpts{})
	if p.Total != 800 {
		t.Fatalf("total %d", p.Total)
	}
	seen := map[uint64]bool{}
	for _, e := range p.Entries {
		if seen[e.ID] {
			t.Fatalf("duplicate id %d", e.ID)
		}
		seen[e.ID] = true
	}
	h2 := newHistoryStore(dir, func() int { return 5000 })
	if q, _ := h2.query("k", "", HistoryOpts{}); q.Total != 800 {
		t.Fatalf("persisted %d (lines interleaved?)", q.Total)
	}
}

func TestHistorySearchModes(t *testing.T) {
	h, _ := newHist(t, 100)
	for _, s := range []string{"Look here", "look there", "say Hello", "@set me=A\n  b"} {
		h.record("k", s)
	}
	n := func(q string, o HistoryOpts) int {
		p, err := h.query("k", q, o)
		if err != nil {
			t.Fatal(err)
		}
		return p.Total
	}
	if n("look", HistoryOpts{}) != 2 || n("look", HistoryOpts{CaseSensitive: true}) != 1 {
		t.Fatal("substring / case")
	}
	if n("^(look|say)", HistoryOpts{Regex: true}) != 3 || n("^look", HistoryOpts{Regex: true, CaseSensitive: true}) != 1 {
		t.Fatal("regex")
	}
	if n("a\n  b", HistoryOpts{}) != 1 {
		t.Fatal("multiline substring")
	}
	if _, err := h.query("k", "(", HistoryOpts{Regex: true}); err == nil {
		t.Fatal("bad regex must report an error")
	}
	p, _ := h.query("k", "look", HistoryOpts{Limit: 1, Offset: 1})
	if len(p.Entries) != 1 || p.Entries[0].Text != "Look here" || p.Total != 2 {
		t.Fatalf("paging %+v", p)
	}
	if p, _ := h.query("k", "look", HistoryOpts{Offset: 5}); len(p.Entries) != 0 || p.Total != 2 {
		t.Fatal("offset past end")
	}
}

func TestHistorySearch20kPerformance(t *testing.T) {
	h, _ := newHist(t, 20000)
	l := &historyList{path: filepath.Join(h.dir, historyFile("k"))}
	for i := 0; i < 20000; i++ {
		l.entries = append(l.entries, HistoryEntry{ID: uint64(i), TS: int64(i), Text: fmt.Sprintf("@set obj%d=[add(%d,1)] the quick brown fox", i, i)})
	}
	h.lists["k"] = l
	for _, c := range []struct {
		q string
		o HistoryOpts
	}{{"obj1999", HistoryOpts{}}, {"BROWN", HistoryOpts{}}, {`obj\d+9\b`, HistoryOpts{Regex: true}}, {"fox", HistoryOpts{CaseSensitive: true, Limit: 100}}} {
		start := time.Now()
		p, err := h.query("k", c.q, c.o)
		if err != nil || p.Total == 0 {
			t.Fatalf("%q: %v %d", c.q, err, p.Total)
		}
		if d := time.Since(start); d > 3*time.Second {
			t.Fatalf("%q took %v over 20k entries", c.q, d)
		}
	}
}

func TestHistoryFileNamesAreSafeAndDistinct(t *testing.T) {
	for _, k := range []string{"w-abc123", "h-mush.example.com:4201", "../../etc/passwd", "h-[::1]:4000", ""} {
		f := historyFile(k)
		if strings.ContainsAny(f, `/\:`) || strings.HasPrefix(f, ".") || !strings.HasSuffix(f, ".ndjson") {
			t.Fatalf("unsafe name %q for %q", f, k)
		}
	}
	if historyFile("a/b") == historyFile("a_b") {
		t.Fatal("sanitised names must not collide")
	}
}

// ---- Service level ------------------------------------------------------------

func TestServiceHistoryPerWorldSharedAcrossSessions(t *testing.T) {
	f := newFixture(t)
	srv := fakemush.New(t)
	w, _ := f.svc.SaveWorld(config.World{Name: "T", Host: srv.Host(), Port: srv.Port()})
	s1, err := f.svc.Connect(ConnectTarget{WorldID: w.ID})
	if err != nil {
		t.Fatal(err)
	}
	f.waitConnected(s1.ID)
	if err := f.svc.RecordHistory(s1.ID, "look\nnorth"); err != nil {
		t.Fatal(err)
	}
	// a second session of the same world sees it; an ad-hoc session to the same host does not
	s2, _ := f.svc.Connect(ConnectTarget{WorldID: w.ID})
	f.waitConnected(s2.ID)
	p, err := f.svc.History(s2.ID, "", HistoryOpts{})
	if err != nil || p.Total != 1 || p.Entries[0].Text != "look\nnorth" {
		t.Fatalf("%v %+v", err, p)
	}
	s3, _ := f.svc.Connect(ConnectTarget{Host: srv.Host(), Port: srv.Port()})
	f.waitConnected(s3.ID)
	if p, _ := f.svc.History(s3.ID, "", HistoryOpts{}); p.Total != 0 {
		t.Fatal("ad-hoc session must have its own host:port history")
	}
	f.svc.RecordHistory(s3.ID, "adhoc")
	if p, _ := f.svc.History(s3.ID, "adhoc", HistoryOpts{}); p.Total != 1 {
		t.Fatal("ad-hoc record")
	}
	if err := f.svc.DeleteHistory(s2.ID, p.Entries[0].ID); err != nil {
		t.Fatal(err)
	}
	if p, _ := f.svc.History(s1.ID, "", HistoryOpts{}); p.Total != 0 {
		t.Fatalf("delete via the other session: %+v", p)
	}
	f.svc.RecordHistory(s1.ID, "x")
	if err := f.svc.ClearHistory(s1.ID); err != nil {
		t.Fatal(err)
	}
	if p, _ := f.svc.History(s2.ID, "", HistoryOpts{}); p.Total != 0 {
		t.Fatal("clear")
	}
	if _, err := f.svc.History("ghost", "", HistoryOpts{}); err == nil {
		t.Fatal("unknown session must error")
	}
}

func TestServiceNeverStoresSecretsOrPasswordEcho(t *testing.T) {
	f := newFixture(t)
	srv := fakemush.New(t)
	si, err := f.svc.Connect(ConnectTarget{Host: srv.Host(), Port: srv.Port()})
	if err != nil {
		t.Fatal(err)
	}
	f.waitConnected(si.ID)
	for _, secret := range []string{"connect bob hunter2", "@password old=hunter2", "say hi\nconnect \"A B\" hunter2\nsay bye", "  CO bob hunter2"} {
		if err := f.svc.RecordHistory(si.ID, secret); err != nil {
			t.Fatal(err)
		}
	}
	f.svc.RecordHistory(si.ID, "connect guest") // no password: stored
	// server echo off (password prompt): nothing typed is stored
	srv.Will(fakemush.OptEcho)
	f.until("remote echo", func() bool { s, _ := f.svc.eng.Session(si.ID); return s.RemoteEcho })
	f.svc.RecordHistory(si.ID, "mysecretpassword")
	p, _ := f.svc.History(si.ID, "", HistoryOpts{})
	if p.Total != 1 || p.Entries[0].Text != "connect guest" {
		t.Fatalf("stored: %+v", p)
	}
	filepath.Walk(f.dir, func(path string, info os.FileInfo, _ error) error {
		if info != nil && !info.IsDir() {
			if b, _ := os.ReadFile(path); strings.Contains(string(b), "hunter2") || strings.Contains(string(b), "mysecretpassword") {
				t.Fatalf("secret on disk in %s", path)
			}
		}
		return nil
	})
}

func TestSettingsCommandWindowClampAndDefaults(t *testing.T) {
	f := newFixture(t)
	st, _ := f.svc.GetSettings()
	if !st.SoftcodeJoin || !st.StripBlankLines || st.SendLineDelayMs != 0 || st.HistoryMax != 20000 || st.InputHeight != 0 || st.EditorHeight != 240 {
		t.Fatalf("defaults %+v", st)
	}
	st.InputHeight, st.EditorHeight, st.SendLineDelayMs, st.HistoryMax = 99999, -5, 999999, 3
	if err := f.svc.SaveSettings(st); err != nil {
		t.Fatal(err)
	}
	got, _ := f.svc.GetSettings()
	if got.InputHeight != config.MaxInputHeight || got.EditorHeight != 0 || got.SendLineDelayMs != config.MaxSendLineDelayMs || got.HistoryMax != config.MinHistoryMax {
		t.Fatalf("clamp %+v", got)
	}
}

func TestServiceRestartKeepsHistoryAndCapFollowsSetting(t *testing.T) {
	dir := t.TempDir()
	sec := secrets.NewMemory()
	srv := fakemush.New(t)
	f := newFixtureAt(t, dir, sec)
	w, _ := f.svc.SaveWorld(config.World{Name: "T", Host: srv.Host(), Port: srv.Port()})
	s1, err := f.svc.Connect(ConnectTarget{WorldID: w.ID})
	if err != nil {
		t.Fatal(err)
	}
	f.waitConnected(s1.ID)
	for i := 0; i < 150; i++ {
		f.svc.RecordHistory(s1.ID, fmt.Sprintf("cmd %d", i))
	}
	f.svc.RecordHistory(s1.ID, "block\n  two")
	f.svc.Shutdown()

	// "restart": a new service on the same config dir; a new session of the same world sees it all
	f2 := newFixtureAt(t, dir, sec)
	s2, err := f2.svc.Connect(ConnectTarget{WorldID: w.ID})
	if err != nil {
		t.Fatal(err)
	}
	f2.waitConnected(s2.ID)
	p, _ := f2.svc.History(s2.ID, "", HistoryOpts{})
	if p.Total != 151 || p.Entries[0].Text != "block\n  two" || p.Entries[150].Text != "cmd 0" {
		t.Fatalf("after restart: total %d", p.Total)
	}
	// lowering the setting takes effect on the next write: oldest entries are dropped first
	st, _ := f2.svc.GetSettings()
	st.HistoryMax = 100
	if err := f2.svc.SaveSettings(st); err != nil {
		t.Fatal(err)
	}
	f2.svc.RecordHistory(s2.ID, "newest")
	p, _ = f2.svc.History(s2.ID, "", HistoryOpts{})
	if p.Total != 100 || p.Entries[0].Text != "newest" || p.Entries[99].Text != "cmd 52" {
		t.Fatalf("cap after setting change: total %d last %q", p.Total, p.Entries[len(p.Entries)-1].Text)
	}
	// and persisted capped across another restart
	f2.svc.Shutdown()
	f3 := newFixtureAt(t, dir, sec)
	s3, _ := f3.svc.Connect(ConnectTarget{WorldID: w.ID})
	f3.waitConnected(s3.ID)
	if p, _ := f3.svc.History(s3.ID, "", HistoryOpts{}); p.Total != 100 {
		t.Fatalf("restart after cap: %d", p.Total)
	}
	// clamping: 0 is not allowed, upper bound is 1,000,000
	st, _ = f3.svc.GetSettings()
	st.HistoryMax = 0
	f3.svc.SaveSettings(st)
	if g, _ := f3.svc.GetSettings(); g.HistoryMax != 100 {
		t.Fatalf("0 -> %d", g.HistoryMax)
	}
	st.HistoryMax = 5_000_000
	f3.svc.SaveSettings(st)
	if g, _ := f3.svc.GetSettings(); g.HistoryMax != 1_000_000 {
		t.Fatalf("max -> %d", g.HistoryMax)
	}
}
