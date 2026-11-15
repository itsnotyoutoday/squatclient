package config

import (
	"path/filepath"
	"testing"
)

func TestCleanScriptDirs(t *testing.T) {
	abs, _ := filepath.Abs(filepath.Join(t.TempDir(), "x"))
	sc, libs, err := CleanScriptDirs(" "+abs+" ", []string{abs, "", abs, "~/lib"})
	if err != nil || sc != abs || len(libs) != 2 || libs[1] != "~/lib" {
		t.Fatalf("got %q %v %v", sc, libs, err)
	}
	if _, _, err := CleanScriptDirs("relative/dir", nil); err == nil {
		t.Fatal("a relative scripts folder must be refused")
	}
	if _, _, err := CleanScriptDirs("", []string{"lib"}); err == nil {
		t.Fatal("a relative library folder must be refused")
	}
	if ExpandPath("~/a") == "~/a" {
		t.Fatal("~ not expanded")
	}
}
