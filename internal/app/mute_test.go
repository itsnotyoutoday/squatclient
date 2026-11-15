package app

import (
	"path/filepath"
	"testing"

	"github.com/itsnotyoutoday/cmcp/go/msg"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/testutil/fakemush"

	"github.com/itsnotyoutoday/squatclient/internal/config"
)

// The effective mute is the global setting OR the world's: a muted session resolves and plays nothing, stops what loops, and resumes the loops
// that are still meant to play when unmuted; a saved world keeps its mute across restarts, a quick connect only for this connection.
func TestEffectiveMute(t *testing.T) {
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
	lib := filepath.Join(t.TempDir(), "lib") // a local sound folder whose map names the alert (no game sound pack in this test)
	writeFile(t, filepath.Join(lib, "a.mp3"), "x")
	writeFile(t, filepath.Join(lib, "b.mp3"), "x")
	writeFile(t, filepath.Join(lib, "era-maps", "tng.json"), `{"format":1,"id":"tng","events":{"red_alert":[{"file":"a.mp3","loop":true}],"phaser_fire":[{"file":"b.mp3"}]}}`)
	cur := f.cfg.Settings()
	cur.SoundFolder = lib
	if err := f.svc.SaveSettings(cur); err != nil {
		t.Fatal(err)
	}
	count := func() int { return len(f.events("cmcp-audio")) }
	play := &msg.SoundPlay{Event: "red_alert", Key: "alert", Loop: true}

	if got := f.svc.MuteState(si.ID); got != "" {
		t.Fatalf("audible by default: %q", got)
	}
	f.svc.playSound(si.ID, play)
	if count() != 1 {
		t.Fatalf("an audible session plays: %d events", count())
	}

	// the world's mute: stops everything now, nothing plays, the loop is remembered
	if err := f.svc.SetWorldSoundMuted(si.ID, true); err != nil {
		t.Fatal(err)
	}
	if got := f.svc.MuteState(si.ID); got != "world" {
		t.Fatalf("world mute: %q", got)
	}
	evs := f.events("cmcp-audio")
	if last := evs[len(evs)-1]; last.JSON == "" || last.Payload.(SoundMsg).Op != "stopall" {
		t.Fatalf("muting stops the looping sound: %+v", last)
	}
	before := count()
	f.svc.playSound(si.ID, &msg.SoundPlay{Event: "phaser_fire"})
	f.svc.playSound(si.ID, &msg.SoundPlay{Event: "red_alert", Key: "alert", Loop: true})
	if count() != before {
		t.Fatalf("a muted world plays nothing: %d -> %d", before, count())
	}
	if w2, _ := f.cfg.World(w.ID); !w2.SoundMuted {
		t.Fatal("the world's mute is persisted on the saved world")
	}

	// global mute wins and is reported as such
	st := f.cfg.Settings()
	st.SoundMuted = true
	if err := f.svc.SaveSettings(st); err != nil {
		t.Fatal(err)
	}
	if got := f.svc.MuteState(si.ID); got != "global" {
		t.Fatalf("global mute: %q", got)
	}

	// unmuting the world while the global mute is on stays silent; with both off the alert loop resumes
	if err := f.svc.SetWorldSoundMuted(si.ID, false); err != nil {
		t.Fatal(err)
	}
	st.SoundMuted = false
	before = count()
	if err := f.svc.SaveSettings(st); err != nil {
		t.Fatal(err)
	}
	if got := f.svc.MuteState(si.ID); got != "" {
		t.Fatalf("audible again: %q", got)
	}
	plays := 0
	for _, e := range f.events("cmcp-audio")[before:] {
		if m, ok := e.Payload.(SoundMsg); ok && m.Op == "play" && m.Key == "alert" {
			plays++
		}
	}
	if plays != 1 {
		t.Fatalf("unmuting resumes the alert loop that is still meant to play: %d plays", plays)
	}

	// a quick connect mutes for this connection only
	q, err := f.svc.Connect(ConnectTarget{Host: srv.Host(), Port: srv.Port()})
	if err != nil {
		t.Fatal(err)
	}
	f.waitConnected(q.ID)
	if err := f.svc.SetWorldSoundMuted(q.ID, true); err != nil {
		t.Fatal(err)
	}
	if got := f.svc.MuteState(q.ID); got != "world" {
		t.Fatalf("quick connect mute: %q", got)
	}
	if got := f.svc.MuteState(si.ID); got != "" {
		t.Fatalf("the other session is unaffected: %q", got)
	}
}
