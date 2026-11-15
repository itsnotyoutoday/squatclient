package app

import (
	"github.com/itsnotyoutoday/cmcp/audio"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, p, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestLocalFolderEraMapsAndServing(t *testing.T) {
	dir := t.TempDir()
	lib := filepath.Join(dir, "lib")
	writeFile(t, filepath.Join(lib, "alerts", "red.mp3"), "0123456789")
	writeFile(t, filepath.Join(lib, "era-maps", "tng.json"), `{"format":1,"id":"tng","events":{"red_alert":[{"file":"alerts/red.mp3","loop":true}]}}`)
	writeFile(t, filepath.Join(lib, "era-maps", "normalise.json"), `{"files":{"alerts/red.mp3":{"suggested_gain_db":-6}}}`)
	writeFile(t, filepath.Join(dir, "secret.txt"), "private")
	if err := os.Symlink(filepath.Join(dir, "secret.txt"), filepath.Join(lib, "alerts", "leak.mp3")); err != nil {
		t.Skip(err)
	}
	ss := &soundSvc{eras: map[string]*audio.EraMap{}}
	ss.configure(lib)
	if !ss.files["alerts/red.mp3"] {
		t.Fatalf("scan: %v", ss.files)
	}
	if g := ss.gains["alerts/red.mp3"]; g < 0.49 || g > 0.51 {
		t.Fatalf("normalise gain %v (-6 dB is about 0.5)", g)
	}
	// the player's map is preferred to the built-in one of the same era
	m := ss.eraMap("tng")
	if m == nil || len(m.Events["red_alert"]) != 1 || m.Events["red_alert"][0].File != "alerts/red.mp3" {
		t.Fatalf("user map not preferred: %+v", m)
	}
	// without a user map the built-in one is used
	if b := ss.eraMap("klingon"); b == nil || len(b.Events) == 0 {
		t.Fatal("built-in klingon map missing")
	}
	svc := &Service{snd: ss}
	h := svc.AudioHandler()
	get := func(path, rng string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		if rng != "" {
			r.Header.Set("Range", rng)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := get(audioURLLocal+"alerts/red.mp3", ""); w.Code != 200 || w.Body.String() != "0123456789" {
		t.Fatalf("file: %d %q", w.Code, w.Body.String())
	}
	if w := get(audioURLLocal+"alerts/red.mp3", "bytes=2-4"); w.Code != http.StatusPartialContent || w.Body.String() != "234" {
		t.Fatalf("range: %d %q", w.Code, w.Body.String())
	}
	for _, bad := range []string{"../secret.txt", "..%2fsecret.txt", "alerts/../../secret.txt", "alerts/leak.mp3", "era-maps/missing.json", ""} {
		if w := get(audioURLLocal+bad, ""); w.Code == 200 {
			t.Fatalf("%q was served: %q", bad, w.Body.String())
		}
	}
	// no folder: nothing is served
	ss.configure("")
	if w := get(audioURLLocal+"alerts/red.mp3", ""); w.Code == 200 {
		t.Fatal("served without a folder")
	}
}

func TestResolveRecipeEvaluatesParameters(t *testing.T) {
	raw, err := os.ReadFile("../cmcp/examples/recipes/phaser.json")
	if err != nil {
		t.Skip(err)
	}
	lo, err := resolveRecipe(raw, map[string]any{"power": 0.0, "pan": -1.0}, "phaser_fire")
	if err != nil {
		t.Fatal(err)
	}
	hi, err := resolveRecipe(raw, map[string]any{"power": 1.0, "pan": 1.0}, "phaser_fire")
	if err != nil {
		t.Fatal(err)
	}
	if lo.Voices[0].Freq.Start != 900 || hi.Voices[0].Freq.Start != 1400 {
		t.Fatalf("freq start %v %v", lo.Voices[0].Freq.Start, hi.Voices[0].Freq.Start)
	}
	if lo.Pan >= 0 || hi.Pan <= 0 {
		t.Fatalf("pan %v %v", lo.Pan, hi.Pan)
	}
	if _, err := resolveRecipe([]byte(`{"format":1,"id":"x","duration":99,"voices":[]}`), nil, "x"); err == nil {
		t.Fatal("an out-of-range recipe must be rejected whole")
	}
}
