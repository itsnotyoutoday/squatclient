// Package themes reads the user's theme folder: every "<id>.json" file, or "<id>/theme.json" in a
// sub-folder of its own, is a theme. The window validates the contents; this package only finds them.
package themes

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var idRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// File is one theme found in the folder.
type File struct {
	ID       string `json:"id"`   // from the file or folder name
	File     string `json:"file"` // path relative to the folder
	JSON     string `json:"json"` // contents, for the window to validate
	Modified int64  `json:"modified"`
}

// Manager owns a themes folder.
type Manager struct{ dir string }

// New returns a Manager for dir (created when first needed).
func New(dir string) *Manager { return &Manager{dir: dir} }

// Dir is the themes folder.
func (m *Manager) Dir() string { return m.dir }

// ValidID reports whether id is usable as a file name.
func ValidID(id string) bool { return idRe.MatchString(id) }

// List returns the themes in the folder, sorted by id. A missing folder is an empty list.
func (m *Manager) List() ([]File, error) {
	ents, err := os.ReadDir(m.dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []File
	for _, e := range ents {
		var rel, id string
		switch {
		case e.IsDir():
			id, rel = e.Name(), filepath.Join(e.Name(), "theme.json")
		case strings.HasSuffix(e.Name(), ".json"):
			id, rel = strings.TrimSuffix(e.Name(), ".json"), e.Name()
		default:
			continue
		}
		if !ValidID(id) {
			continue
		}
		p := filepath.Join(m.dir, rel)
		b, err := os.ReadFile(p)
		if err != nil || len(b) > 256<<10 {
			continue
		}
		var mod int64
		if st, err := os.Stat(p); err == nil {
			mod = st.ModTime().UnixMilli()
		}
		out = append(out, File{ID: id, File: filepath.ToSlash(rel), JSON: string(b), Modified: mod})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// Save writes "<id>.json" (replacing an existing one).
func (m *Manager) Save(id, json string) error {
	if !ValidID(id) {
		return errors.New("theme id may use a-z, 0-9, - and _ only")
	}
	if err := os.MkdirAll(m.dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(m.dir, id+".json"), []byte(json), 0o644)
}

// Delete removes a theme file (or its folder).
func (m *Manager) Delete(id string) error {
	if !ValidID(id) {
		return errors.New("bad theme id")
	}
	if err := os.Remove(filepath.Join(m.dir, id+".json")); err == nil || !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.RemoveAll(filepath.Join(m.dir, id))
}
