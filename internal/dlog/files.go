package dlog

import (
	"archive/zip"
	"bufio"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// SessionInfo describes one session's log on disk.
type SessionInfo struct {
	ID         string `json:"id"`
	Current    bool   `json:"current"`
	Bytes      int64  `json:"bytes"`
	Segments   int    `json:"segments"`
	Redactions int64  `json:"redactions"`
}

// Status is what the dialog shows.
type Status struct {
	Enabled  bool          `json:"enabled"`
	Session  string        `json:"session"`
	Sessions []SessionInfo `json:"sessions"` // newest first: current, then previous
	Dropped  int64         `json:"dropped"`
	Budget   int64         `json:"budget"`
}

// Status lists what is on disk (it flushes first so the sizes are current).
func (l *Logger) Status() Status {
	if l == nil {
		return Status{}
	}
	l.Flush()
	l.mu.Lock()
	st := Status{Enabled: l.enabled, Session: l.session, Dropped: l.dropped.Load(), Budget: l.cfg.BudgetBytes}
	cur := l.session
	l.mu.Unlock()
	ids := l.sessionIDs()
	for i := len(ids) - 1; i >= 0; i-- {
		id := ids[i]
		dir := l.sessionDir(id)
		si := SessionInfo{ID: id, Current: id == cur, Bytes: dirSize(dir), Segments: len(segments(dir))}
		if _, err := os.Stat(filepath.Join(dir, "current.log")); err == nil {
			si.Segments++
		}
		var m meta
		if b, err := os.ReadFile(filepath.Join(dir, "meta.json")); err == nil && json.Unmarshal(b, &m) == nil {
			si.Redactions = m.Redactions
		}
		st.Sessions = append(st.Sessions, si)
	}
	return st
}

// Clear deletes every log (the current session starts a fresh file when logging is on).
func (l *Logger) Clear() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	was := l.enabled
	l.mu.Unlock()
	l.SetEnabled(false)
	err := os.RemoveAll(l.cfg.Dir)
	l.mu.Lock()
	l.session = ""
	l.mu.Unlock()
	if was {
		l.SetEnabled(true)
		l.Log("diag", "", "", "logs cleared by the user")
	}
	return err
}

// readSegment streams one segment's lines (gzip or plain).
func readSegment(path string, fn func(line string)) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	var r io.Reader = f
	if strings.HasSuffix(path, ".gz") {
		zr, err := gzip.NewReader(f)
		if err != nil {
			return err
		}
		defer zr.Close()
		r = zr
	}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 4<<20)
	for sc.Scan() {
		fn(sc.Text())
	}
	return sc.Err()
}

// sessionFiles lists a session's files oldest first (segments, then the open file).
func (l *Logger) sessionFiles(id string) []string {
	dir := l.sessionDir(id)
	files := segments(dir)
	if _, err := os.Stat(filepath.Join(dir, "current.log")); err == nil {
		files = append(files, filepath.Join(dir, "current.log"))
	}
	return files
}

// Tail returns the last n lines of the current session (newest last) that contain filter (case-insensitive; "" = all).
func (l *Logger) Tail(n int, filter string) ([]string, error) {
	if l == nil {
		return nil, nil
	}
	l.Flush()
	st := l.Status()
	if len(st.Sessions) == 0 {
		return nil, nil
	}
	filter = strings.ToLower(filter)
	var out []string
	files := l.sessionFiles(st.Sessions[0].ID)
	for i := len(files) - 1; i >= 0 && len(out) < n; i-- { // newest file first, then older ones only if more lines are needed
		var part []string
		if err := readSegment(files[i], func(s string) {
			if filter == "" || strings.Contains(strings.ToLower(s), filter) {
				part = append(part, s)
			}
		}); err != nil {
			continue
		}
		if need := n - len(out); len(part) > need {
			part = part[len(part)-need:]
		}
		out = append(append([]string(nil), part...), out...)
	}
	return out, nil
}

var nameClean = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// ZipName is squatclient-diagnostics-<build>-<date>.zip with the build stamp made safe for a file name.
func ZipName(build string, t time.Time) string {
	b := strings.Trim(nameClean.ReplaceAllString(build, "-"), "-.")
	if b == "" {
		b = "unknown"
	}
	if len(b) > 40 {
		b = b[:40]
	}
	return fmt.Sprintf("squatclient-diagnostics-%s-%s.zip", b, t.Format("2006-01-02"))
}

// ZipOptions says what goes into a bug-report zip.
type ZipOptions struct {
	CurrentOnly bool
	Note        string // the user's own words (redacted too)
	System      string // build stamp, OS, versions, settings summary: the caller keeps secrets out, the zip redacts again
}

// ZipResult describes a finished zip.
type ZipResult struct {
	Path       string        `json:"path"`
	Size       int64         `json:"size"`
	Files      []ZipFileInfo `json:"files"`
	Redactions int           `json:"redactions"` // secrets found (and removed) while packing, on top of the ones removed when the lines were written
}

// ZipFileInfo is one entry of the zip.
type ZipFileInfo struct {
	Name  string `json:"name"`
	Bytes int64  `json:"bytes"` // uncompressed
}

// BuildZip packs the log (current and previous session, or only the current), the system summary and the note into dest. Every line is redacted again
// on the way. Nothing is sent anywhere.
func (l *Logger) BuildZip(dest string, o ZipOptions) (*ZipResult, error) {
	l.Flush()
	st := l.Status()
	tmp := dest + ".part"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return nil, err
	}
	res := &ZipResult{Path: dest}
	zw := zip.NewWriter(f)
	fail := func(err error) (*ZipResult, error) {
		_ = zw.Close()
		_ = f.Close()
		_ = os.Remove(tmp)
		return nil, err
	}
	put := func(name string, fill func(w io.Writer) (int64, error)) error {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: time.Now()})
		if err != nil {
			return err
		}
		n, err := fill(w)
		res.Files = append(res.Files, ZipFileInfo{Name: name, Bytes: n})
		return err
	}
	text := func(s string) func(io.Writer) (int64, error) {
		return func(w io.Writer) (int64, error) {
			c, n := RedactText(s)
			res.Redactions += n
			k, err := io.WriteString(w, c)
			return int64(k), err
		}
	}
	var readme strings.Builder
	readme.WriteString("SquatClient diagnostics log\n\nThis zip holds the app's own log of what it did (connections, sounds, packs, settings changes, errors), in\n")
	readme.WriteString("time order. Passwords, pairing codes, keys and tokens were removed, but the text the game sent can appear in it.\n")
	readme.WriteString("Nothing was uploaded: you decide where this file goes.\n\nSessions:\n")
	for i, s := range st.Sessions {
		if o.CurrentOnly && i > 0 {
			break
		}
		kind := "previous"
		if s.Current {
			kind = "current"
		}
		fmt.Fprintf(&readme, "  %s (%s, %d bytes on disk)\n", s.ID, kind, s.Bytes)
	}
	if err := put("README.txt", text(readme.String())); err != nil {
		return fail(err)
	}
	if o.System != "" {
		if err := put("system.txt", text(o.System)); err != nil {
			return fail(err)
		}
	}
	if strings.TrimSpace(o.Note) != "" {
		if err := put("note.txt", text(o.Note)); err != nil {
			return fail(err)
		}
	}
	for i, s := range st.Sessions {
		if o.CurrentOnly && i > 0 {
			break
		}
		for _, file := range l.sessionFiles(s.ID) {
			name := s.ID + "/" + strings.TrimSuffix(strings.TrimSuffix(filepath.Base(file), ".gz"), ".log") + ".log"
			file := file
			if err := put(name, func(w io.Writer) (int64, error) {
				bw := bufio.NewWriter(w)
				var n int64
				err := readSegment(file, func(line string) {
					c, k := Redact(line)
					res.Redactions += k
					m, _ := bw.WriteString(c + "\n")
					n += int64(m)
				})
				if e := bw.Flush(); err == nil {
					err = e
				}
				return n, err
			}); err != nil {
				return fail(err)
			}
		}
	}
	if err := zw.Close(); err != nil {
		return fail(err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return nil, err
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return nil, err
	}
	if info, err := os.Stat(dest); err == nil {
		res.Size = info.Size()
	}
	return res, nil
}
