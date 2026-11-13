package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// CurrentVersion is the on-disk schema version of every file.
const CurrentVersion = 1

// ErrNotFound is returned for unknown ids.
var ErrNotFound = errors.New("config: not found")

// DefaultDir is <os user config dir>/SquatClient.
func DefaultDir() (string, error) {
	d, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("config: %w", err)
	}
	return filepath.Join(d, "SquatClient"), nil
}

// Store is safe for concurrent use.
type Store struct {
	dir string
	mu  sync.Mutex

	worlds    []World
	squatters []Squatter
	settings  Settings
	window    Window
}

type worldsFile struct {
	Version int     `json:"version"`
	Worlds  []World `json:"worlds"`
}
type squattersFile struct {
	Version   int        `json:"version"`
	Squatters []Squatter `json:"squatters"`
}
type settingsFile struct {
	Version  int      `json:"version"`
	Settings Settings `json:"settings"`
}
type windowFile struct {
	Version int    `json:"version"`
	Window  Window `json:"window"`
}

// Open loads (creating the directory if needed) the store in dir. A corrupt
// file is moved aside as <name>.corrupt-<unix> and replaced by defaults; a file
// from a newer version is an error (it is never overwritten).
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}
	s := &Store{dir: dir, settings: DefaultSettings()}
	var wf worldsFile
	if err := s.load("worlds.json", &wf, &wf.Version); err != nil {
		return nil, err
	}
	s.worlds = wf.Worlds
	var sq squattersFile
	if err := s.load("squatters.json", &sq, &sq.Version); err != nil {
		return nil, err
	}
	s.squatters = sq.Squatters
	sf := settingsFile{Settings: DefaultSettings()}
	if err := s.load("settings.json", &sf, &sf.Version); err != nil {
		return nil, err
	}
	s.settings = sf.Settings
	var win windowFile
	if err := s.load("window.json", &win, &win.Version); err != nil {
		return nil, err
	}
	s.window = win.Window
	return s, nil
}

// Dir returns the directory the store lives in.
func (s *Store) Dir() string { return s.dir }

func (s *Store) load(name string, into any, version *int) error {
	p := filepath.Join(s.dir, name)
	b, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	if err := json.Unmarshal(b, into); err != nil {
		_ = os.Rename(p, fmt.Sprintf("%s.corrupt-%d", p, time.Now().Unix()))
		return nil // start from defaults; the bad file is preserved
	}
	switch {
	case *version > CurrentVersion:
		return fmt.Errorf("config: %s has version %d, newer than supported %d", name, *version, CurrentVersion)
	case *version < CurrentVersion:
		// migrations: v0 (unversioned) -> v1 needs no structural change.
		*version = CurrentVersion
	}
	return nil
}

func (s *Store) write(name string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	return atomicWrite(filepath.Join(s.dir, name), append(b, '\n'))
}

func atomicWrite(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	name := tmp.Name()
	cleanup := func() { _ = os.Remove(name) }
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("config: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("config: %w", err)
	}
	if err := os.Chmod(name, 0o600); err != nil {
		cleanup()
		return fmt.Errorf("config: %w", err)
	}
	if err := os.Rename(name, path); err != nil {
		cleanup()
		return fmt.Errorf("config: %w", err)
	}
	return nil
}

// NewID returns a random 16-hex-digit id.
func NewID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// ---- worlds -----------------------------------------------------------

// Worlds returns a copy of the world list.
func (s *Store) Worlds() []World {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneWorlds(s.worlds)
}

func cloneWorlds(in []World) []World {
	out := make([]World, len(in))
	for i, w := range in {
		out[i] = w
		if w.Login != nil {
			l := *w.Login
			out[i].Login = &l
		}
	}
	return out
}

// World returns one world.
func (s *Store) World(id string) (World, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, w := range s.worlds {
		if w.ID == id {
			return cloneWorlds([]World{w})[0], nil
		}
	}
	return World{}, ErrNotFound
}

// Validate normalises and checks a world (defaults tlsVerify, encoding, via).
func (w *World) Validate(defaultEncoding string) error {
	w.Name = strings.TrimSpace(w.Name)
	w.Host = strings.TrimSpace(w.Host)
	if w.Name == "" {
		return errors.New("world name is required")
	}
	if w.Host == "" {
		return errors.New("host is required")
	}
	if w.Port < 1 || w.Port > 65535 {
		return fmt.Errorf("port %d out of range", w.Port)
	}
	switch w.TLSVerify {
	case "":
		w.TLSVerify = "strict"
	case "strict", "insecure":
	default:
		return fmt.Errorf("bad tlsVerify %q", w.TLSVerify)
	}
	if w.GameType == "auto" {
		w.GameType = ""
	}
	// the engine knows the valid types; an unknown one is ignored there (detection is used)
	if len(w.GameType) > 24 || strings.Trim(w.GameType, "abcdefghijklmnopqrstuvwxyz0123456789_") != "" {
		return fmt.Errorf("bad gameType %q", w.GameType)
	}
	switch w.Encoding {
	case "":
		w.Encoding = defaultEncoding
		if w.Encoding == "" {
			w.Encoding = "utf-8"
		}
	case "utf-8", "latin1":
	default:
		return fmt.Errorf("bad encoding %q", w.Encoding)
	}
	if w.Via == "" {
		w.Via = "direct"
	}
	return nil
}

// SaveWorld creates (empty id) or replaces a world and returns it as stored.
// hasPassword is preserved from the stored copy: only SetHasPassword changes it.
func (s *Store) SaveWorld(w World) (World, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := w.Validate(s.settings.DefaultEncoding); err != nil {
		return World{}, err
	}
	if w.ID == "" {
		w.ID = NewID()
	}
	idx := -1
	for i, old := range s.worlds {
		if old.ID == w.ID {
			idx = i
		}
	}
	if w.Login != nil {
		if idx >= 0 && s.worlds[idx].Login != nil {
			w.Login.HasPassword = s.worlds[idx].Login.HasPassword
		} else {
			w.Login.HasPassword = false
		}
	}
	next := cloneWorlds(s.worlds)
	if idx >= 0 {
		next[idx] = w
	} else {
		next = append(next, w)
	}
	if err := s.write("worlds.json", worldsFile{Version: CurrentVersion, Worlds: next}); err != nil {
		return World{}, err
	}
	s.worlds = next
	return cloneWorlds([]World{w})[0], nil
}

// DeleteWorld removes a world.
func (s *Store) DeleteWorld(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := make([]World, 0, len(s.worlds))
	found := false
	for _, w := range s.worlds {
		if w.ID == id {
			found = true
			continue
		}
		next = append(next, w)
	}
	if !found {
		return ErrNotFound
	}
	if err := s.write("worlds.json", worldsFile{Version: CurrentVersion, Worlds: next}); err != nil {
		return err
	}
	s.worlds = next
	return nil
}

// SetHasPassword records whether the keychain holds a password for the world.
func (s *Store) SetHasPassword(id string, has bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneWorlds(s.worlds)
	for i := range next {
		if next[i].ID != id {
			continue
		}
		if next[i].Login == nil {
			next[i].Login = &Login{Template: "connect {name} {password}"}
		}
		next[i].Login.HasPassword = has
		if err := s.write("worlds.json", worldsFile{Version: CurrentVersion, Worlds: next}); err != nil {
			return err
		}
		s.worlds = next
		return nil
	}
	return ErrNotFound
}

// ---- settings ----------------------------------------------------------

// Settings returns the current settings.
func (s *Store) Settings() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.settings
}

// SaveSettings validates and stores settings. Truecolor is always on.
func (s *Store) SaveSettings(in Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	in.Truecolor = true
	in.clampCommandWindow()
	if in.ScrollbackLines < 100 {
		return fmt.Errorf("scrollbackLines %d too small (min 100)", in.ScrollbackLines)
	}
	if in.FontSize < 6 || in.FontSize > 72 {
		return fmt.Errorf("fontSize %v out of range", in.FontSize)
	}
	switch in.DefaultEncoding {
	case "utf-8", "latin1":
	default:
		return fmt.Errorf("bad defaultEncoding %q", in.DefaultEncoding)
	}
	if in.Theme == "" {
		return errors.New("theme is required")
	}
	if err := s.write("settings.json", settingsFile{Version: CurrentVersion, Settings: in}); err != nil {
		return err
	}
	s.settings = in
	return nil
}

// ---- squatters -----------------------------------------------------------

// Squatters returns a copy of the stored squatters.
func (s *Store) Squatters() []Squatter {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Squatter(nil), s.squatters...)
}

// SaveSquatter adds or replaces a squatter (empty id = new).
func (s *Store) SaveSquatter(q Squatter) (Squatter, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if q.ID == "" {
		q.ID = NewID()
	}
	next := append([]Squatter(nil), s.squatters...)
	replaced := false
	for i := range next {
		if next[i].ID == q.ID {
			next[i], replaced = q, true
		}
	}
	if !replaced {
		next = append(next, q)
	}
	if err := s.write("squatters.json", squattersFile{Version: CurrentVersion, Squatters: next}); err != nil {
		return Squatter{}, err
	}
	s.squatters = next
	return q, nil
}

// DeleteSquatter removes a squatter.
func (s *Store) DeleteSquatter(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := make([]Squatter, 0, len(s.squatters))
	found := false
	for _, q := range s.squatters {
		if q.ID == id {
			found = true
			continue
		}
		next = append(next, q)
	}
	if !found {
		return ErrNotFound
	}
	if err := s.write("squatters.json", squattersFile{Version: CurrentVersion, Squatters: next}); err != nil {
		return err
	}
	s.squatters = next
	return nil
}

// ---- window --------------------------------------------------------------

// Window returns the saved window state (Valid=false if none).
func (s *Store) Window() Window {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.window
}

// SaveWindow stores window geometry.
func (s *Store) SaveWindow(w Window) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	w.Valid = w.Width > 0 && w.Height > 0
	if err := s.write("window.json", windowFile{Version: CurrentVersion, Window: w}); err != nil {
		return err
	}
	s.window = w
	return nil
}
