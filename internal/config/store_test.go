package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultsAndRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	st := s.Settings()
	if st.Theme != "dark" || !st.Truecolor || st.DefaultEncoding != "utf-8" || st.ScrollbackLines != 20000 || !st.Linkify || !st.PauseOnScroll {
		t.Fatalf("bad defaults %+v", st)
	}
	w, err := s.SaveWorld(World{Name: " Trek ", Host: "startrekkin.net", Port: 1701, Login: &Login{Template: "connect {name} {password}", CharName: "kirk", HasPassword: true}})
	if err != nil {
		t.Fatal(err)
	}
	if w.ID == "" || w.Name != "Trek" || w.Encoding != "utf-8" || w.TLSVerify != "strict" || w.Via != "direct" {
		t.Fatalf("bad world %+v", w)
	}
	if w.Login.HasPassword {
		t.Fatal("hasPassword must not be settable through SaveWorld")
	}
	if err := s.SetHasPassword(w.ID, true); err != nil {
		t.Fatal(err)
	}
	// edit keeps the flag
	w.Notes = "n"
	w.Login.HasPassword = false
	w2, _ := s.SaveWorld(w)
	if !w2.Login.HasPassword {
		t.Fatal("flag lost on edit")
	}
	st.Theme = "light"
	if err := s.SaveSettings(st); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveWindow(Window{X: 1, Y: 2, Width: 800, Height: 600}); err != nil {
		t.Fatal(err)
	}
	q, _ := s.SaveSquatter(Squatter{Name: "home", Host: "h", Port: 10327})

	s2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := s2.Worlds(); len(got) != 1 || got[0].Notes != "n" || got[0].Login.CharName != "kirk" {
		t.Fatalf("reload worlds %+v", got)
	}
	if s2.Settings().Theme != "light" || !s2.Window().Valid || s2.Window().Width != 800 {
		t.Fatal("reload settings/window")
	}
	if sq := s2.Squatters(); len(sq) != 1 || sq[0].ID != q.ID {
		t.Fatal("reload squatters")
	}
	if err := s2.DeleteWorld(w.ID); err != nil || len(s2.Worlds()) != 0 {
		t.Fatal("delete")
	}
	if err := s2.DeleteWorld("nope"); err != ErrNotFound {
		t.Fatal("want ErrNotFound")
	}
}

func TestNoPasswordOnDisk(t *testing.T) {
	dir := t.TempDir()
	s, _ := Open(dir)
	_, _ = s.SaveWorld(World{Name: "a", Host: "h", Port: 1, Login: &Login{Template: "connect {name} {password}"}})
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		b, _ := os.ReadFile(filepath.Join(dir, e.Name()))
		if strings.Contains(string(b), "password\":") && strings.Contains(string(b), `"password": "`) {
			t.Fatal("plaintext password field on disk")
		}
		if info, _ := e.Info(); info.Mode().Perm() != 0o600 {
			t.Fatalf("%s perms %v", e.Name(), info.Mode().Perm())
		}
	}
}

func TestValidation(t *testing.T) {
	s, _ := Open(t.TempDir())
	for _, w := range []World{
		{Host: "h", Port: 1}, {Name: "a", Port: 1}, {Name: "a", Host: "h", Port: 0},
		{Name: "a", Host: "h", Port: 70000}, {Name: "a", Host: "h", Port: 1, Encoding: "ebcdic"},
		{Name: "a", Host: "h", Port: 1, TLSVerify: "maybe"},
	} {
		if _, err := s.SaveWorld(w); err == nil {
			t.Fatalf("want error for %+v", w)
		}
	}
	bad := DefaultSettings()
	bad.ScrollbackLines = 5
	if s.SaveSettings(bad) == nil {
		t.Fatal("small scrollback accepted")
	}
	tc := DefaultSettings()
	tc.Truecolor = false
	_ = s.SaveSettings(tc)
	if !s.Settings().Truecolor {
		t.Fatal("truecolor must stay on")
	}
}

func TestCorruptAndFutureVersion(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "worlds.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := Open(dir)
	if err != nil || len(s.Worlds()) != 0 {
		t.Fatalf("corrupt should reset: %v", err)
	}
	m, _ := filepath.Glob(filepath.Join(dir, "worlds.json.corrupt-*"))
	if len(m) != 1 {
		t.Fatal("corrupt file not preserved")
	}
	_ = os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"version": 99, "settings": {}}`), 0o600)
	if _, err := Open(dir); err == nil {
		t.Fatal("future version must be an error")
	}
}

func TestMigrateUnversioned(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "worlds.json"), []byte(`{"worlds":[{"id":"x","name":"a","host":"h","port":5,"tlsVerify":"strict","encoding":"utf-8","via":"direct","tls":false}]}`), 0o600)
	s, err := Open(dir)
	if err != nil || len(s.Worlds()) != 1 {
		t.Fatalf("migrate: %v", err)
	}
	_, _ = s.SaveWorld(s.Worlds()[0])
	b, _ := os.ReadFile(filepath.Join(dir, "worlds.json"))
	if !strings.Contains(string(b), `"version": 1`) {
		t.Fatal("version not written")
	}
}

func TestPartialSettingsKeepDefaults(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"version":1,"settings":{"theme":"light"}}`), 0o600)
	s, _ := Open(dir)
	if st := s.Settings(); st.Theme != "light" || st.ScrollbackLines != 20000 || !st.Linkify {
		t.Fatalf("%+v", st)
	}
}

func TestOldSettingsFileGetsCommandWindowDefaults(t *testing.T) {
	dir := t.TempDir()
	old := `{"version":1,"settings":{"theme":"light","fontFamily":"x","fontSize":14,"scrollbackLines":20000,"defaultEncoding":"utf-8","truecolor":true}}`
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	st := s.Settings()
	if st.Theme != "light" || !st.SoftcodeJoin || !st.StripBlankLines || st.HistoryMax != 20000 || st.EditorHeight != 240 || st.InputHeight != 0 {
		t.Fatalf("%+v", st)
	}
}
