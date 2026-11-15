// Package dlog is SquatClient's always-on diagnostics log: one redacted, timestamped timeline of the whole session (what the game sent, what the engine
// decided, what the page did) that rolls over into gzip segments, keeps the current and the previous session only, stays inside a size budget and can be
// packed into a zip for a bug report. Writing never blocks the caller: lines go through a bounded queue to one writer goroutine.
package dlog

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Config tunes a Logger; zero values are the shipped policy.
type Config struct {
	Dir          string        // <config>/diagnostics
	SegmentBytes int64         // roll over at this size (default 20 MB)
	BudgetBytes  int64         // current + previous session together (default 100 MB)
	Flush        time.Duration // how often the buffer reaches the disk (default 1 s)
	Queue        int           // lines waiting for the writer (default 16384)
	Session      string        // session id (default: the start time)
	Enabled      bool
	Now          func() time.Time
}

type entry struct {
	line   string
	flush  chan struct{} // non-nil: a flush request (the writer closes it when done)
	stop   bool          // the writer drains what is queued and ends
	urgent bool
}

// Logger is safe for concurrent use; a nil *Logger discards everything (Mode off).
type Logger struct {
	cfg Config

	mu       sync.Mutex // guards the fields below and the lifecycle
	enabled  bool
	ch       chan entry
	done     chan struct{}
	session  string
	dropped  atomic.Int64
	redacted atomic.Int64

	// owned by the writer goroutine (and read by Status under mu through the sizes on disk)
	f      *os.File
	w      *bufio.Writer
	size   int64
	segNo  int
	dir    string // the session folder
	dirty  bool
	metaRd int64
}

// Open prepares a logger; when cfg.Enabled the session starts at once.
func Open(cfg Config) *Logger {
	if cfg.SegmentBytes <= 0 {
		cfg.SegmentBytes = 20 << 20
	}
	if cfg.BudgetBytes <= 0 {
		cfg.BudgetBytes = 100 << 20
	}
	if cfg.Flush <= 0 {
		cfg.Flush = time.Second
	}
	if cfg.Queue <= 0 {
		cfg.Queue = 16384
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	l := &Logger{cfg: cfg}
	if cfg.Enabled {
		l.SetEnabled(true)
	}
	return l
}

// Enabled reports whether lines are being recorded.
func (l *Logger) Enabled() bool {
	if l == nil {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.enabled
}

// SetEnabled turns recording on (starting a session if there is none) or off (flushing and closing the current file; the files stay).
func (l *Logger) SetEnabled(on bool) {
	if l == nil {
		return
	}
	l.mu.Lock()
	if on == l.enabled {
		l.mu.Unlock()
		return
	}
	if on {
		if l.session == "" {
			l.session = l.cfg.Session
			if l.session == "" {
				l.session = l.cfg.Now().Format("20060102-150405")
			}
		}
		l.ch = make(chan entry, l.cfg.Queue)
		l.done = make(chan struct{})
		l.enabled = true
		ch, done := l.ch, l.done
		l.mu.Unlock()
		l.startSession()
		go l.run(ch, done)
		return
	}
	l.enabled = false
	ch, done := l.ch, l.done
	l.ch = nil
	l.mu.Unlock()
	ch <- entry{stop: true} // (the channel is never closed: a Log that fetched it a moment ago may still send)
	<-done
}

// Close flushes and stops the writer.
func (l *Logger) Close() {
	if l == nil {
		return
	}
	l.SetEnabled(false)
}

// Session is the id of the current session ("" if none started).
func (l *Logger) Session() string {
	if l == nil {
		return ""
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.session
}

func now(l *Logger) time.Time { return l.cfg.Now() }

// Log records one line: layer is ui, web-audio, engine, cmcp, sound, packs, net, settings, session, error, snapshot, diag...; session and tab (the
// world's name) may be empty. It never blocks: when the queue is full the line is counted as dropped.
func (l *Logger) Log(layer, session, tab, msg string) {
	if l == nil {
		return
	}
	l.mu.Lock()
	ch := l.ch
	l.mu.Unlock()
	if ch == nil {
		return
	}
	msg = strings.ReplaceAll(strings.TrimRight(msg, "\r\n"), "\n", " | ")
	msg, n := Redact(msg)
	if n > 0 {
		l.redacted.Add(int64(n))
		redactCount.Add(int64(n))
	}
	var b strings.Builder
	b.WriteString(now(l).Format("2006-01-02 15:04:05.000"))
	b.WriteString(" [")
	b.WriteString(layer)
	b.WriteString("]")
	if session != "" {
		b.WriteString(" sid=" + session)
	}
	if tab != "" {
		tab, _ = Redact(tab)
		fmt.Fprintf(&b, " tab=%q", tab)
	}
	b.WriteByte(' ')
	b.WriteString(msg)
	e := entry{line: b.String(), urgent: layer == "error"}
	select {
	case ch <- e:
	default:
		l.dropped.Add(1)
	}
}

// Logf is Log with a format.
func (l *Logger) Logf(layer, session, tab, format string, args ...any) {
	if l == nil {
		return
	}
	l.Log(layer, session, tab, fmt.Sprintf(format, args...))
}

// Flush waits until everything logged so far is on the disk.
func (l *Logger) Flush() {
	if l == nil {
		return
	}
	l.mu.Lock()
	ch := l.ch
	l.mu.Unlock()
	if ch == nil {
		return
	}
	f := make(chan struct{})
	select {
	case ch <- entry{flush: f}:
		select {
		case <-f:
		case <-time.After(5 * time.Second):
		}
	case <-time.After(2 * time.Second):
	}
}

func (l *Logger) sessionDir(id string) string { return filepath.Join(l.cfg.Dir, id) }

// startSession applies the retention policy (only the newest older session stays, as "previous") and opens the first file.
func (l *Logger) startSession() {
	_ = os.MkdirAll(l.cfg.Dir, 0o700)
	l.mu.Lock()
	cur := l.session
	l.mu.Unlock()
	ids := l.sessionIDs()
	var older []string
	for _, id := range ids {
		if id != cur {
			older = append(older, id)
		}
	}
	for i, id := range older {
		if i == len(older)-1 { // the newest of them is the previous session: close its dangling file (a crash leaves current.log)
			l.sealLeftover(id)
			continue
		}
		_ = os.RemoveAll(l.sessionDir(id))
	}
	l.dir = l.sessionDir(cur)
	_ = os.MkdirAll(l.dir, 0o700)
	l.segNo = l.nextSeg(l.dir)
	l.open()
	l.enforceBudget()
}

func (l *Logger) sessionIDs() []string {
	ents, err := os.ReadDir(l.cfg.Dir)
	if err != nil {
		return nil
	}
	var ids []string
	for _, e := range ents {
		if e.IsDir() {
			ids = append(ids, e.Name())
		}
	}
	sort.Strings(ids)
	return ids
}

func (l *Logger) nextSeg(dir string) int {
	segs, _ := filepath.Glob(filepath.Join(dir, "*.log.gz"))
	n := 0
	for _, s := range segs {
		var k int
		if _, err := fmt.Sscanf(filepath.Base(s), "%d.log.gz", &k); err == nil && k > n {
			n = k
		}
	}
	return n + 1
}

func (l *Logger) sealLeftover(id string) {
	dir := l.sessionDir(id)
	cur := filepath.Join(dir, "current.log")
	if st, err := os.Stat(cur); err == nil && st.Size() > 0 {
		_ = gzipFile(cur, filepath.Join(dir, fmt.Sprintf("%03d.log.gz", l.nextSeg(dir))))
	}
	_ = os.Remove(cur)
}

func (l *Logger) open() {
	f, err := os.OpenFile(filepath.Join(l.dir, "current.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		l.f, l.w = nil, nil
		return
	}
	l.f, l.w = f, bufio.NewWriterSize(f, 64<<10)
	if st, err := f.Stat(); err == nil {
		l.size = st.Size()
	}
}

func gzipFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	zw := gzip.NewWriter(out)
	_, err = io.Copy(zw, in)
	if e := zw.Close(); err == nil {
		err = e
	}
	if e := out.Close(); err == nil {
		err = e
	}
	if err != nil {
		_ = os.Remove(dst)
	}
	return err
}

// run is the writer goroutine.
func (l *Logger) run(ch chan entry, done chan struct{}) {
	defer close(done)
	tick := time.NewTicker(l.cfg.Flush)
	defer tick.Stop()
	var lastDropped int64
	flush := func() {
		if l.w != nil {
			_ = l.w.Flush()
		}
		l.writeMeta()
	}
	for {
		select {
		case e, ok := <-ch:
			if !ok || e.stop {
				for more := true; more && ok; { // what was queued before the stop still goes to the file
					select {
					case q := <-ch:
						if q.line != "" {
							l.write(q.line)
						}
					default:
						more = false
					}
				}
				flush()
				if l.f != nil {
					_ = l.f.Close()
					l.f, l.w = nil, nil
				}
				return
			}
			if e.flush != nil {
				flush()
				close(e.flush)
				continue
			}
			l.write(e.line)
			if d := l.dropped.Load(); d != lastDropped {
				l.write(fmt.Sprintf("%s [diag] %d lines dropped because the log queue was full", now(l).Format("2006-01-02 15:04:05.000"), d-lastDropped))
				lastDropped = d
			}
			if e.urgent {
				flush()
			}
		case <-tick.C:
			flush()
		}
	}
}

func (l *Logger) write(line string) {
	if l.w == nil {
		return
	}
	n, _ := l.w.WriteString(line + "\n")
	l.size += int64(n)
	l.dirty = true
	if l.size >= l.cfg.SegmentBytes {
		l.roll()
	}
}

// roll closes the current file into the next gzip segment and starts a new one.
func (l *Logger) roll() {
	_ = l.w.Flush()
	_ = l.f.Close()
	cur := filepath.Join(l.dir, "current.log")
	if err := gzipFile(cur, filepath.Join(l.dir, fmt.Sprintf("%03d.log.gz", l.segNo))); err == nil {
		l.segNo++
		_ = os.Remove(cur)
	} else {
		_ = os.Rename(cur, filepath.Join(l.dir, fmt.Sprintf("%03d.log", l.segNo)))
		l.segNo++
	}
	l.size = 0
	l.open()
	l.enforceBudget()
	l.write(fmt.Sprintf("%s [diag] segment rolled over (segment %d)", now(l).Format("2006-01-02 15:04:05.000"), l.segNo-1))
}

func dirSize(dir string) int64 {
	var n int64
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		if info, err := e.Info(); err == nil && !e.IsDir() {
			n += info.Size()
		}
	}
	return n
}

func segments(dir string) []string {
	var segs []string
	for _, pat := range []string{"*.log.gz", "[0-9]*.log"} {
		m, _ := filepath.Glob(filepath.Join(dir, pat))
		segs = append(segs, m...)
	}
	sort.Strings(segs)
	return segs
}

// enforceBudget keeps current + previous session inside BudgetBytes: the previous session's oldest segments go first, then the current one's.
func (l *Logger) enforceBudget() {
	ids := l.sessionIDs()
	total := func() int64 {
		var n int64
		for _, id := range ids {
			n += dirSize(l.sessionDir(id))
		}
		return n
	}
	l.mu.Lock()
	cur := l.session
	l.mu.Unlock()
	for total() > l.cfg.BudgetBytes {
		removed := false
		for _, id := range ids {
			if id == cur {
				continue
			}
			if segs := segments(l.sessionDir(id)); len(segs) > 0 {
				_ = os.Remove(segs[0])
				removed = true
				break
			}
		}
		if !removed {
			if segs := segments(l.dir); len(segs) > 0 {
				_ = os.Remove(segs[0])
				removed = true
			}
		}
		if !removed {
			return
		}
	}
}

type meta struct {
	Redactions int64  `json:"redactions"`
	Started    string `json:"started"`
}

func (l *Logger) writeMeta() {
	r := l.redacted.Load()
	if r == l.metaRd || l.dir == "" {
		return
	}
	l.metaRd = r
	b, _ := json.Marshal(meta{Redactions: r, Started: l.session})
	_ = os.WriteFile(filepath.Join(l.dir, "meta.json"), b, 0o600)
}
