package app

import (
	"os"
	"path/filepath"
	"testing"
)

// The themes folder can be moved in Settings: a theme saved afterwards lands there, and an empty setting is the default folder.
func TestThemesFolderIsChangeable(t *testing.T) {
	f := newFixture(t)
	def := f.svc.ThemesDir()
	other := filepath.Join(t.TempDir(), "my-themes")
	s := f.cfg.Settings()
	s.ThemesDir = other
	if err := f.svc.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	if got := f.svc.ThemesDir(); got != other {
		t.Fatalf("themes folder %q, want %q", got, other)
	}
	if err := f.svc.SaveTheme("mine", `{"id":"mine","name":"Mine"}`); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(other, "mine.json")); err != nil {
		t.Fatalf("the theme is saved in the chosen folder: %v", err)
	}
	s.ThemesDir = ""
	if err := f.svc.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	if got := f.svc.ThemesDir(); got != def {
		t.Fatalf("an empty setting is the default folder %q, got %q", def, got)
	}
}
