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

// tflib is the unmodified standard TinyFugue library (tf/*.tf and its help file, see tflib/TF-NOTICE.md): the same
// set gtf ships, so /load and /require find the classic scripts (tintin.tf, at.tf, kb-*.tf, ...) in an installed client.
//
//go:embed tflib
var tflib embed.FS

// TFDir is the folder under the configuration folder that Install writes the classic library into (lib/tf).
const TFDir = "lib/tf"

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
	if err := installTF(configDir); err != nil {
		return out, err
	}
	return out, nil
}

// installTF writes the classic library into <configDir>/lib/tf (managed like lib/squat: rewritten when it differs).
func installTF(configDir string) error {
	out := filepath.Join(configDir, filepath.FromSlash(TFDir))
	return fs.WalkDir(tflib, "tflib/tf", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		dst := filepath.Join(out, filepath.FromSlash(strings.TrimPrefix(strings.TrimPrefix(p, "tflib/tf"), "/")))
		if d.IsDir() {
			return os.MkdirAll(dst, 0o755)
		}
		b, err := tflib.ReadFile(p)
		if err != nil {
			return err
		}
		if old, err := os.ReadFile(dst); err == nil && string(old) == string(b) {
			return nil
		}
		return os.WriteFile(dst, b, 0o644)
	})
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
