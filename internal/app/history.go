package app

import (
	"bufio"
	"bytes"
	"crypto/sha1" //nolint:gosec // file-name disambiguation only
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
)

// Command history is kept per WORLD (not per session) as
// <config>/history/<worldKey>.ndjson, one JSON object {id, ts, text} per line.
// Appends are single O_APPEND writes; deletes and cap compaction rewrite the
// file atomically (temp file + fsync + rename). A torn or corrupt line is
// skipped on load, never fatal.

const maxHistoryText = 256 << 10 // bytes per entry

// HistoryEntry is one remembered input. A multi-line editor block is ONE entry
// (Text contains newlines).
type HistoryEntry struct {
	ID   uint64 `json:"id"`
	TS   int64  `json:"ts"` // unix milliseconds
	Text string `json:"text"`
}

// HistoryOpts is `{regex?, caseSensitive?, limit?, offset?}`.
type HistoryOpts struct {
	Regex         bool `json:"regex,omitempty"`
	CaseSensitive bool `json:"caseSensitive,omitempty"`
	Limit         int  `json:"limit,omitempty"`
	Offset        int  `json:"offset,omitempty"`
}

// HistoryPage is a newest-first window onto the matching entries.
type HistoryPage struct {
	Entries []HistoryEntry `json:"entries"`
	Total   int            `json:"total"` // matches overall, not just this page
}

type historyList struct {
	path      string
	entries   []HistoryEntry // oldest first
	nextID    uint64
	fileLines int // lines currently in the file (drives compaction)
}

type historyStore struct {
	dir   string
	max   func() int
	now   func() time.Time
	mu    sync.Mutex
	lists map[string]*historyList
}

func newHistoryStore(dir string, max func() int) *historyStore {
	return &historyStore{dir: dir, max: max, now: time.Now, lists: map[string]*historyList{}}
}

// historyFile maps a world key to a safe file name.
func historyFile(key string) string {
	var b strings.Builder
	for _, r := range key {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '.':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	name := strings.TrimLeft(b.String(), ".")
	if name != key || name == "" || len(name) > 80 || windowsReserved(name) {
		sum := sha1.Sum([]byte(key)) //nolint:gosec
		if len(name) > 60 {
			name = name[:60]
		}
		name += "-" + hex.EncodeToString(sum[:4])
	}
	if windowsReserved(name) { // "con.txt-1234" is still the device CON: a prefix is what makes it an ordinary file
		name = "_" + name
	}
	return name + ".ndjson"
}

// get loads (once) the list for key. Caller holds mu.
func (h *historyStore) get(key string) (*historyList, error) {
	if l, ok := h.lists[key]; ok {
		return l, nil
	}
	l := &historyList{path: filepath.Join(h.dir, historyFile(key))}
	f, err := os.Open(l.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return nil, fmt.Errorf("history: %w", err)
	default:
		defer f.Close()
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 64<<10), 4*maxHistoryText)
		for sc.Scan() {
			l.fileLines++
			var e HistoryEntry
			if json.Unmarshal(sc.Bytes(), &e) != nil || e.Text == "" {
				continue // torn / corrupt line
			}
			l.entries = append(l.entries, e)
			if e.ID >= l.nextID {
				l.nextID = e.ID + 1
			}
		}
	}
	if m := h.max(); len(l.entries) > m {
		l.entries = append([]HistoryEntry(nil), l.entries[len(l.entries)-m:]...)
		if err := l.rewrite(); err != nil {
			return nil, err
		}
	}
	h.lists[key] = l
	return l, nil
}

func marshalLine(e HistoryEntry) []byte {
	b, _ := json.Marshal(e) // cannot fail for this type
	return append(b, '\n')
}

// rewrite atomically replaces the file with the in-memory entries.
func (l *historyList) rewrite() error {
	var buf bytes.Buffer
	for _, e := range l.entries {
		buf.Write(marshalLine(e))
	}
	if err := atomicWriteFile(l.path, buf.Bytes()); err != nil {
		return err
	}
	l.fileLines = len(l.entries)
	return nil
}

func atomicWriteFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("history: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("history: %w", err)
	}
	name := tmp.Name()
	fail := func(err error) error {
		_ = tmp.Close()
		_ = os.Remove(name)
		return fmt.Errorf("history: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		return fail(err)
	}
	if err := tmp.Sync(); err != nil {
		return fail(err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(name)
		return fmt.Errorf("history: %w", err)
	}
	if err := os.Chmod(name, 0o600); err != nil {
		_ = os.Remove(name)
		return fmt.Errorf("history: %w", err)
	}
	if err := os.Rename(name, path); err != nil {
		_ = os.Remove(name)
		return fmt.Errorf("history: %w", err)
	}
	return nil
}

// record appends text. Blank text and an exact repeat of the newest entry are
// ignored (returns false).
func (h *historyStore) record(key, text string) (bool, error) {
	if strings.TrimSpace(text) == "" {
		return false, nil
	}
	if len(text) > maxHistoryText {
		return false, fmt.Errorf("history: entry too large (%d bytes, max %d)", len(text), maxHistoryText)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	l, err := h.get(key)
	if err != nil {
		return false, err
	}
	if n := len(l.entries); n > 0 && l.entries[n-1].Text == text {
		return false, nil
	}
	e := HistoryEntry{ID: l.nextID, TS: h.now().UnixMilli(), Text: text}
	if err := os.MkdirAll(h.dir, 0o700); err != nil {
		return false, fmt.Errorf("history: %w", err)
	}
	f, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return false, fmt.Errorf("history: %w", err)
	}
	_, werr := f.Write(marshalLine(e))
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		return false, fmt.Errorf("history: %w", werr)
	}
	l.nextID++
	l.fileLines++
	l.entries = append(l.entries, e)
	m := h.max()
	if len(l.entries) > m {
		l.entries = append([]HistoryEntry(nil), l.entries[len(l.entries)-m:]...)
	}
	// compact once the file holds a quarter more lines than the cap
	if l.fileLines > m+m/4+1 {
		if err := l.rewrite(); err != nil {
			return true, err
		}
	}
	return true, nil
}

// matcher builds the entry filter for a query ("" matches everything).
func matcher(query string, o HistoryOpts) (func(string) bool, error) {
	if query == "" {
		return func(string) bool { return true }, nil
	}
	if o.Regex {
		p := query
		if !o.CaseSensitive {
			p = "(?i)" + p
		}
		re, err := regexp.Compile(p)
		if err != nil {
			return nil, fmt.Errorf("invalid regular expression: %w", err)
		}
		return re.MatchString, nil
	}
	if o.CaseSensitive {
		return func(s string) bool { return strings.Contains(s, query) }, nil
	}
	q := strings.ToLower(query)
	return func(s string) bool { return strings.Contains(strings.ToLower(s), q) }, nil
}

// query returns matching entries newest-first.
func (h *historyStore) query(key, q string, o HistoryOpts) (HistoryPage, error) {
	match, err := matcher(q, o)
	if err != nil {
		return HistoryPage{Entries: []HistoryEntry{}}, err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	l, err := h.get(key)
	if err != nil {
		return HistoryPage{Entries: []HistoryEntry{}}, err
	}
	limit := o.Limit
	if limit <= 0 || limit > 50000 {
		limit = 50000
	}
	off := max(o.Offset, 0)
	page := HistoryPage{Entries: []HistoryEntry{}}
	for i := len(l.entries) - 1; i >= 0; i-- {
		e := l.entries[i]
		if !match(e.Text) {
			continue
		}
		if page.Total >= off && len(page.Entries) < limit {
			page.Entries = append(page.Entries, e)
		}
		page.Total++
	}
	return page, nil
}

func (h *historyStore) remove(key string, id uint64) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	l, err := h.get(key)
	if err != nil {
		return err
	}
	for i, e := range l.entries {
		if e.ID == id {
			next := make([]HistoryEntry, 0, len(l.entries)-1)
			next = append(append(next, l.entries[:i]...), l.entries[i+1:]...)
			old := l.entries
			l.entries = next
			if err := l.rewrite(); err != nil {
				l.entries = old
				return err
			}
			return nil
		}
	}
	return nil // already gone
}

func (h *historyStore) clear(key string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	l, err := h.get(key)
	if err != nil {
		return err
	}
	if err := os.Remove(l.path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("history: %w", err)
	}
	l.entries, l.fileLines = nil, 0
	return nil
}

// ---- Service methods ---------------------------------------------------------

// historyKey is the world key of a session: the world id when the session was
// opened from a world, else host:port.
func (s *Service) historyKey(sessionID string) (key string, remoteEcho bool, err error) {
	si, err := s.eng.Session(sessionID)
	if err != nil {
		return "", false, err
	}
	if si.WorldID != "" {
		return "w-" + si.WorldID, si.RemoteEcho, nil
	}
	return fmt.Sprintf("h-%s:%d", strings.ToLower(si.Host), si.Port), si.RemoteEcho, nil
}

// RecordHistory remembers text as one history entry of the session's world.
// It is a silent no-op (nil error) when the server has echo off (a password
// is being typed) or when any line of text is a password line according to
// engine.MaskSecret: such entries are SKIPPED entirely, not stored masked
// (a recalled "connect bob ********" would be useless and risky to resend).
func (s *Service) RecordHistory(sessionID, text string) error {
	key, remoteEcho, err := s.historyKey(sessionID)
	if err != nil {
		return err
	}
	if remoteEcho {
		return nil
	}
	if _, secret := engine.MaskSecret(text); secret {
		return nil
	}
	_, err = s.hist.record(key, text)
	return err
}

// History returns the world's history newest-first, filtered by query.
func (s *Service) History(sessionID, query string, o HistoryOpts) (HistoryPage, error) {
	key, _, err := s.historyKey(sessionID)
	if err != nil {
		return HistoryPage{Entries: []HistoryEntry{}}, err
	}
	return s.hist.query(key, query, o)
}

// DeleteHistory removes one entry.
func (s *Service) DeleteHistory(sessionID string, id uint64) error {
	key, _, err := s.historyKey(sessionID)
	if err != nil {
		return err
	}
	return s.hist.remove(key, id)
}

// ClearHistory removes the world's whole history.
func (s *Service) ClearHistory(sessionID string) error {
	key, _, err := s.historyKey(sessionID)
	if err != nil {
		return err
	}
	return s.hist.clear(key)
}

// windowsReserved reports names Windows refuses as file names, with or without an extension
// ("con", "nul", "com1"...). They get a hash suffix like any other awkward name.
func windowsReserved(name string) bool {
	base := strings.ToLower(name)
	if i := strings.IndexByte(base, '.'); i >= 0 {
		base = base[:i]
	}
	switch base {
	case "con", "prn", "aux", "nul":
		return true
	}
	if len(base) == 4 && (strings.HasPrefix(base, "com") || strings.HasPrefix(base, "lpt")) && base[3] >= '1' && base[3] <= '9' {
		return true
	}
	return false
}
