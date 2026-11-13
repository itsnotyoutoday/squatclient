package app

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// MaxUploadBytes caps the size of a file ReadTextFile will read (5 MiB).
const MaxUploadBytes = 5 << 20

// Binary-content heuristics: a file is rejected when it holds a NUL byte, when more than
// maxControlRatio of its bytes are control characters, or when more than maxInvalidRatio of its
// bytes are not valid UTF-8 (plain Latin-1 text has a handful of such bytes; binary has many).
const (
	maxControlRatio = 0.02
	maxInvalidRatio = 0.20
)

// FileResult is the outcome of ReadTextFile. Failures are reported inside the result.
type FileResult struct {
	OK       bool   `json:"ok"`
	Error    string `json:"error,omitempty"`
	Path     string `json:"path"`
	Name     string `json:"name"`
	Size     int64  `json:"size"` // bytes on disk
	Encoding string `json:"encoding"`
	Text     string `json:"text"` // LF line endings, BOM removed
}

func fileFail(path string, format string, a ...any) FileResult {
	return FileResult{Path: path, Name: filepath.Base(path), Error: fmt.Sprintf(format, a...)}
}

// expandHome turns "~" and "~/x" into the user's home directory.
func expandHome(p string) (string, error) {
	if p != "~" && !strings.HasPrefix(p, "~/") && !strings.HasPrefix(p, `~\`) {
		return p, nil
	}
	h, err := os.UserHomeDir()
	if err != nil {
		return "", errors.New("cannot find your home folder")
	}
	return filepath.Join(h, p[1:]), nil
}

// ReadTextFile reads a text file the user explicitly chose (file picker) or typed (`/upload <path>`).
// It reads regular files only (a symlink is followed, but must end at a regular file), refuses
// relative paths, files over MaxUploadBytes and binary content, decodes UTF-8 (BOM stripped) with a
// Latin-1 fallback and normalises line endings to LF. It never writes or lists anything.
func (s *Service) ReadTextFile(path string) FileResult {
	r := readTextFile(path, MaxUploadBytes)
	if r.OK {
		if err := s.cfg.SetLastFolder(filepath.Dir(r.Path)); err != nil {
			s.log.Warn("remember upload folder", "err", err)
		}
	}
	return r
}

func readTextFile(path string, limit int64) FileResult {
	raw := path
	path = strings.TrimSpace(path)
	if path == "" {
		return fileFail(raw, "no file given")
	}
	if strings.ContainsRune(path, 0) {
		return fileFail(path, "invalid file name")
	}
	p, err := expandHome(path)
	if err != nil {
		return fileFail(path, "%v", err)
	}
	if !filepath.IsAbs(p) {
		return fileFail(path, "use an absolute path (or ~/...): %q is relative", path)
	}
	p = filepath.Clean(p)
	st, err := os.Stat(p) // follows symlinks
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fileFail(p, "file not found: %s", p)
		}
		if errors.Is(err, os.ErrPermission) {
			return fileFail(p, "permission denied: %s", p)
		}
		return fileFail(p, "cannot read %s: %v", p, err)
	}
	if st.IsDir() {
		return fileFail(p, "%s is a folder, not a file", p)
	}
	if !st.Mode().IsRegular() { // devices, pipes, sockets: opening a FIFO could even block
		return fileFail(p, "%s is not a regular file", p)
	}
	if st.Size() > limit {
		return fileFail(p, "file is too large (%s; the limit is %s)", humanBytes(st.Size()), humanBytes(limit))
	}
	f, err := os.Open(p)
	if err != nil {
		if errors.Is(err, os.ErrPermission) {
			return fileFail(p, "permission denied: %s", p)
		}
		return fileFail(p, "cannot read %s: %v", p, err)
	}
	defer f.Close()
	if fst, err := f.Stat(); err != nil || !fst.Mode().IsRegular() {
		return fileFail(p, "%s is not a regular file", p)
	}
	data, err := io.ReadAll(io.LimitReader(f, limit+1)) // the file may have grown since Stat
	if err != nil {
		return fileFail(p, "cannot read %s: %v", p, err)
	}
	if int64(len(data)) > limit {
		return fileFail(p, "file is too large (the limit is %s)", humanBytes(limit))
	}
	text, enc, err := decodeText(data)
	if err != nil {
		return fileFail(p, "%v", err)
	}
	return FileResult{OK: true, Path: p, Name: filepath.Base(p), Size: int64(len(data)), Encoding: enc, Text: text}
}

// decodeText strips a UTF-8 BOM, rejects binary data, decodes UTF-8 or Latin-1, and normalises
// CRLF / lone CR to LF.
func decodeText(data []byte) (text, encoding string, err error) {
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	if len(data) > 0 {
		if bytes.IndexByte(data, 0) >= 0 {
			return "", "", errors.New("this looks like a binary file (it contains NUL bytes); only text files can be uploaded")
		}
		ctl, bad := 0, 0
		for i := 0; i < len(data); {
			c := data[i]
			if c < utf8.RuneSelf {
				if (c < 0x20 && c != '\n' && c != '\r' && c != '\t' && c != '\f' && c != 0x1b) || c == 0x7f {
					ctl++
				}
				i++
				continue
			}
			r, n := utf8.DecodeRune(data[i:])
			if r == utf8.RuneError && n == 1 {
				bad++
			}
			i += n
		}
		if float64(ctl) > maxControlRatio*float64(len(data)) || float64(bad) > maxInvalidRatio*float64(len(data)) {
			return "", "", errors.New("this looks like a binary file; only text files can be uploaded")
		}
	}
	if utf8.Valid(data) {
		text, encoding = string(data), "utf-8"
	} else {
		rs := make([]rune, len(data))
		for i, b := range data {
			rs[i] = rune(b)
		}
		text, encoding = string(rs), "latin1"
	}
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return text, encoding, nil
}

func humanBytes(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MiB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KiB", float64(n)/(1<<10))
	}
	return fmt.Sprintf("%d bytes", n)
}

// UploadFolder is where the file picker should start ("" = the system default).
func (s *Service) UploadFolder() string { return s.cfg.LastFolder() }

// RememberUploadFolder stores the folder of a file the user picked.
func (s *Service) RememberUploadFolder(dir string) {
	if dir == "" {
		return
	}
	if err := s.cfg.SetLastFolder(dir); err != nil {
		s.log.Warn("remember upload folder", "err", err)
	}
}
