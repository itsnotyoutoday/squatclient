// Package stdlib is SquatClient's own TinyFugue standard library: the scripts in squat/ (see docs/LIB.md),
// embedded in the binary and installed into the client's configuration folder on the first start and after an update.
package stdlib

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
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

// stampFile records which build of the library is installed. Install only writes the libraries when it is missing or
// differs: on the first start and after the app itself was updated, not at every start.
const stampFile = "lib/.installed"

// libStamp identifies the embedded libraries (a hash of every file name and content) and the folder they install into.
func libStamp(configDir string) string {
	h := sha256.New()
	for _, fsys := range []embed.FS{files, tflib} {
		_ = fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
			if err == nil && !d.IsDir() {
				b, _ := fsys.ReadFile(p)
				h.Write([]byte(p))
				h.Write([]byte{0})
				h.Write(b)
			}
			return nil
		})
	}
	h.Write([]byte(configDir)) // @CONFIGDIR@ is baked into the scripts
	return hex.EncodeToString(h.Sum(nil))
}

// Install puts the library into <configDir>/lib/squat (and the classic one into lib/tf) and returns the squat folder.
// The libraries are part of the install: they are written on the first start and again only when the app ships a
// different library (a stamp file records which), never at every start. Your own versions of a script go in your
// scripts folder or a library folder from Settings, which are searched first. @CONFIGDIR@ in the scripts becomes configDir.
func Install(configDir string) (string, error) {
	out := filepath.Join(configDir, filepath.FromSlash(Dir))
	stamp := libStamp(configDir)
	if b, err := os.ReadFile(filepath.Join(configDir, filepath.FromSlash(stampFile))); err == nil && string(b) == stamp {
		if _, err := os.Stat(filepath.Join(out, "stdlib.tf")); err == nil {
			return out, nil
		}
	}
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
	if err := os.WriteFile(filepath.Join(configDir, filepath.FromSlash(stampFile)), []byte(stamp), 0o644); err != nil {
		return out, err
	}
	return out, nil
}

// installTF writes the classic library into <configDir>/lib/tf (managed like lib/squat: written on first start and after an update).
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
