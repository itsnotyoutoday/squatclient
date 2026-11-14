// Package layouts finds, compiles and vets the user's layout files (docs/LAYOUTS.md): a folder of
// ".layout" / ".tsx" / ".jsx" / ".ts" / ".js" files that arrange the window's built-in components.
package layouts

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

//go:embed starters/*.layout
var starterFS embed.FS

var idRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// Extensions a layout file may have, in the order they are looked for.
var exts = []string{".layout", ".tsx", ".jsx", ".ts", ".js"}

// Info describes one layout file.
type Info struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	File     string `json:"file"` // file name inside the layouts folder
	Hash     string `json:"hash"` // sha256 of the contents
	Modified int64  `json:"modified"`
	Allowed  bool   `json:"allowed"` // the user has allowed this exact content to run
}

// Bundle is what the window needs to run a layout.
type Bundle struct {
	ID           string `json:"id"`
	Hash         string `json:"hash"`
	Code         string `json:"code,omitempty"`
	Lua          string `json:"lua,omitempty"`
	CSS          string `json:"css,omitempty"`
	NeedsConsent bool   `json:"needsConsent,omitempty"`
	// Source is included only when consent is needed, so the user can read what they are asked to allow.
	Source string `json:"source,omitempty"`
	Error  string `json:"error,omitempty"`
}

// Starter is a layout that ships with the app, as editable source.
type Starter struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Source string `json:"source"`
}

// Manager owns a layouts folder and the record of which layouts the user allowed to run.
type Manager struct {
	dir     string
	consent string // path of the consent file

	mu    sync.Mutex
	cache map[string]Compiled // by id + hash
}

// New returns a Manager for dir (created when first needed); consentFile records allowed layouts.
func New(dir, consentFile string) *Manager {
	return &Manager{dir: dir, consent: consentFile, cache: map[string]Compiled{}}
}

// Dir is the layouts folder.
func (m *Manager) Dir() string { return m.dir }

// ValidID reports whether id is a usable layout id.
func ValidID(id string) bool { return idRe.MatchString(id) }

func hashOf(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

var nameRe = regexp.MustCompile(`(?m)^\s*(?://|<!--)\s*name:\s*(.+?)\s*(?:-->)?\s*$`)

func nameOf(id string, src []byte) string {
	head := src
	if len(head) > 400 {
		head = head[:400]
	}
	if m := nameRe.FindSubmatch(head); m != nil {
		return string(m[1])
	}
	return id
}

func (m *Manager) consentMap() map[string]string {
	out := map[string]string{}
	if b, err := os.ReadFile(m.consent); err == nil {
		_ = json.Unmarshal(b, &out)
	}
	return out
}

func (m *Manager) saveConsent(c map[string]string) error {
	if err := os.MkdirAll(filepath.Dir(m.consent), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	tmp := m.consent + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, m.consent)
}

// find locates the file of a layout id.
func (m *Manager) find(id string) (path, ext string, err error) {
	if !ValidID(id) {
		return "", "", fmt.Errorf("layouts: %q is not a valid layout id (lower-case letters, digits, - and _)", id)
	}
	for _, e := range exts {
		p := filepath.Join(m.dir, id+e)
		if _, err := os.Stat(p); err == nil {
			return p, e, nil
		}
	}
	return "", "", fmt.Errorf("layouts: no layout named %q in %s", id, m.dir)
}

// List returns the layouts in the folder, by id.
func (m *Manager) List() ([]Info, error) {
	ents, err := os.ReadDir(m.dir)
	if errors.Is(err, os.ErrNotExist) {
		return []Info{}, nil
	}
	if err != nil {
		return nil, err
	}
	consent := m.consentMap()
	out := []Info{}
	seen := map[string]bool{}
	for _, e := range ents {
		if e.IsDir() {
			continue
		}
		ext := filepath.Ext(e.Name())
		ok := false
		for _, x := range exts {
			ok = ok || x == ext
		}
		id := strings.TrimSuffix(e.Name(), ext)
		if !ok || !ValidID(id) || seen[id] {
			continue
		}
		seen[id] = true
		b, err := os.ReadFile(filepath.Join(m.dir, e.Name()))
		if err != nil {
			continue
		}
		fi, _ := e.Info()
		h := hashOf(b)
		inf := Info{ID: id, Name: nameOf(id, b), File: e.Name(), Hash: h, Allowed: consent[id] == h}
		if fi != nil {
			inf.Modified = fi.ModTime().UnixMilli()
		}
		out = append(out, inf)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// Read returns a layout's source.
func (m *Manager) Read(id string) (string, error) {
	p, _, err := m.find(id)
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(p)
	return string(b), err
}

// Load compiles a layout. Unless the user already allowed this exact content, nothing is compiled or run:
// the Bundle says consent is needed and carries the source to show.
func (m *Manager) Load(id string) (Bundle, error) {
	p, ext, err := m.find(id)
	if err != nil {
		return Bundle{ID: id}, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return Bundle{ID: id}, err
	}
	h := hashOf(b)
	out := Bundle{ID: id, Hash: h}
	if m.consentMap()[id] != h {
		out.NeedsConsent, out.Source = true, string(b)
		return out, nil
	}
	key := id + ":" + h
	m.mu.Lock()
	c, hit := m.cache[key]
	m.mu.Unlock()
	if !hit {
		if c, err = Compile(id, ext, string(b), m.dir); err != nil {
			out.Error = err.Error()
			return out, nil
		}
		m.mu.Lock()
		m.cache[key] = c
		m.mu.Unlock()
	}
	out.Code, out.Lua, out.CSS = c.Code, c.Lua, c.CSS
	return out, nil
}

// Allow records that the user allows (or no longer allows) the layout with this content hash to run.
func (m *Manager) Allow(id, hash string, allow bool) error {
	if !ValidID(id) {
		return fmt.Errorf("layouts: invalid layout id %q", id)
	}
	c := m.consentMap()
	if allow {
		c[id] = hash
	} else {
		delete(c, id)
	}
	return m.saveConsent(c)
}

// Save writes a layout the user made in the app's editor (or copied from a starter); that counts as the
// user's own text, so it is allowed to run without asking again. It is compiled first, and a layout that
// does not compile is not saved.
func (m *Manager) Save(id, source string) (Info, error) {
	if !ValidID(id) {
		return Info{}, fmt.Errorf("layouts: invalid layout id %q", id)
	}
	ext := ".layout"
	if p, e, err := m.find(id); err == nil {
		_ = p
		ext = e
	}
	if _, err := Compile(id, ext, source, m.dir); err != nil {
		return Info{}, err
	}
	if err := os.MkdirAll(m.dir, 0o700); err != nil {
		return Info{}, err
	}
	path := filepath.Join(m.dir, id+ext)
	if err := os.WriteFile(path, []byte(source), 0o600); err != nil {
		return Info{}, err
	}
	h := hashOf([]byte(source))
	if err := m.Allow(id, h, true); err != nil {
		return Info{}, err
	}
	return Info{ID: id, Name: nameOf(id, []byte(source)), File: filepath.Base(path), Hash: h, Allowed: true}, nil
}

// Delete removes a layout file.
func (m *Manager) Delete(id string) error {
	p, _, err := m.find(id)
	if err != nil {
		return err
	}
	_ = m.Allow(id, "", false)
	return os.Remove(p)
}

// Starters returns the layouts that ship with the app, as editable source.
func Starters() []Starter {
	ents, _ := starterFS.ReadDir("starters")
	var out []Starter
	for _, e := range ents {
		b, err := starterFS.ReadFile("starters/" + e.Name())
		if err != nil {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".layout")
		out = append(out, Starter{ID: id, Name: nameOf(id, b), Source: string(b)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
