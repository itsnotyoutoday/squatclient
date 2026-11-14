// Package stdlib is SquatClient's own TinyFugue standard library: the scripts in squat/ (see docs/LIB.md),
// embedded in the binary and installed into the client's configuration folder at start.
package stdlib

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

//go:embed squat
var files embed.FS

// Dir is the folder under the configuration folder that Install writes (lib/squat).
const Dir = "lib/squat"

// Install writes the library into <configDir>/lib/squat and returns that folder. The folder is managed: it is
// rewritten at every start, so changes belong in startup.tf. @CONFIGDIR@ in the scripts becomes configDir.
func Install(configDir string) (string, error) {
	out := filepath.Join(configDir, filepath.FromSlash(Dir))
	err := fs.WalkDir(files, "squat", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel := strings.TrimPrefix(strings.TrimPrefix(p, "squat"), "/")
		dst := filepath.Join(out, filepath.FromSlash(rel))
		if strings.HasPrefix(rel, "plugins") { // Lua plugins live where the client loads them: <configDir>/plugins
			dst = filepath.Join(configDir, filepath.FromSlash(rel))
		}
		if d.IsDir() {
			return os.MkdirAll(dst, 0o755)
		}
		b, err := files.ReadFile(p)
		if err != nil {
			return err
		}
		if strings.HasSuffix(p, ".tf") {
			b = []byte(strings.ReplaceAll(string(b), "@CONFIGDIR@", filepath.ToSlash(configDir)))
		}
		if old, err := os.ReadFile(dst); err == nil && string(old) == string(b) {
			return nil
		}
		return os.WriteFile(dst, b, 0o644)
	})
	if err != nil {
		return "", err
	}
	return out, nil
}

// Files lists the embedded library files (slash paths below squat/).
func Files() []string {
	var out []string
	_ = fs.WalkDir(files, "squat", func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			out = append(out, strings.TrimPrefix(p, "squat/"))
		}
		return nil
	})
	return out
}
