package app

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/itsnotyoutoday/squatclient/internal/config"
)

func write(t *testing.T, name string, data []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestReadTextFileDecoding(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		text string
		enc  string
	}{
		{"plain.txt", []byte("hello\nworld\n"), "hello\nworld\n", "utf-8"},
		{"bom.txt", append([]byte{0xEF, 0xBB, 0xBF}, "&F me=1\n"...), "&F me=1\n", "utf-8"},
		{"crlf.txt", []byte("a\r\nb\rc\n"), "a\nb\nc\n", "utf-8"},
		{"utf8.txt", []byte("café ☃\n"), "café ☃\n", "utf-8"},
		{"latin1.txt", []byte("caf\xe9 na\xefve\n"), "café naïve\n", "latin1"},
		{"empty.txt", nil, "", "utf-8"},
		{"ansi.txt", []byte("\x1b[1mhi\x1b[0m\n"), "\x1b[1mhi\x1b[0m\n", "utf-8"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := write(t, c.name, c.data)
			r := readTextFile(p, MaxUploadBytes)
			if !r.OK || r.Text != c.text || r.Encoding != c.enc {
				t.Fatalf("got %+v", r)
			}
			if r.Name != c.name || r.Path != p || r.Size != int64(len(c.data)) {
				t.Fatalf("meta %+v", r)
			}
		})
	}
}

func TestReadTextFileRejects(t *testing.T) {
	dir := t.TempDir()
	huge := write(t, "huge.txt", bytes.Repeat([]byte("x"), 2048))
	nul := write(t, "nul.bin", []byte("abc\x00def"))
	utf16 := write(t, "u16.txt", []byte{0xFF, 0xFE, 'a', 0, 'b', 0})
	garbage := write(t, "g.dat", bytes.Repeat([]byte{0x80, 0x81, 0xfe, 0xff, 'a'}, 100))
	ctl := write(t, "c.dat", bytes.Repeat([]byte{0x01, 0x02, 0x03, 'a'}, 100))
	cases := []struct {
		name, path, want string
		limit            int64
	}{
		{"empty path", "  ", "no file", MaxUploadBytes},
		{"relative", "foo.txt", "absolute", MaxUploadBytes},
		{"missing", filepath.Join(dir, "nope.txt"), "not found", MaxUploadBytes},
		{"directory", dir, "folder", MaxUploadBytes},
		{"too big", huge, "too large", 1024},
		{"nul", nul, "binary", MaxUploadBytes},
		{"utf16", utf16, "binary", MaxUploadBytes},
		{"invalid utf8 ratio", garbage, "binary", MaxUploadBytes},
		{"control chars", ctl, "binary", MaxUploadBytes},
		{"nul in name", "/tmp/a\x00b", "invalid", MaxUploadBytes},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := readTextFile(c.path, c.limit)
			if r.OK || !strings.Contains(r.Error, c.want) {
				t.Fatalf("want error containing %q, got %+v", c.want, r)
			}
			if r.Text != "" {
				t.Fatal("no text may be returned on failure")
			}
		})
	}
}

func TestReadTextFileSymlinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks")
	}
	dir := t.TempDir()
	target := filepath.Join(dir, "real.txt")
	_ = os.WriteFile(target, []byte("ok\n"), 0o600)
	link := filepath.Join(dir, "link.txt")
	if err := os.Symlink(target, link); err != nil {
		t.Skip(err)
	}
	if r := readTextFile(link, MaxUploadBytes); !r.OK || r.Text != "ok\n" {
		t.Fatalf("symlink to a regular file should work: %+v", r)
	}
	dev := filepath.Join(dir, "dev")
	if err := os.Symlink("/dev/null", dev); err != nil {
		t.Skip(err)
	}
	if r := readTextFile(dev, MaxUploadBytes); r.OK || !strings.Contains(r.Error, "not a regular file") {
		t.Fatalf("symlink to a device must be refused: %+v", r)
	}
	if r := readTextFile("/dev/zero", MaxUploadBytes); r.OK {
		t.Fatalf("/dev/zero must be refused: %+v", r)
	}
	dang := filepath.Join(dir, "dangling")
	_ = os.Symlink(filepath.Join(dir, "gone"), dang)
	if r := readTextFile(dang, MaxUploadBytes); r.OK || !strings.Contains(r.Error, "not found") {
		t.Fatalf("dangling: %+v", r)
	}
}

func TestReadTextFileHomeAndFolder(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	_ = os.WriteFile(filepath.Join(home, "x.mush"), []byte("think hi\n"), 0o600)
	cfg, err := config.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{cfg: cfg}
	if s.UploadFolder() != "" {
		t.Fatal("no folder yet")
	}
	r := s.ReadTextFile("~/x.mush")
	if !r.OK || r.Text != "think hi\n" || r.Path != filepath.Join(home, "x.mush") {
		t.Fatalf("%+v", r)
	}
	if s.UploadFolder() != home {
		t.Fatalf("last folder = %q", s.UploadFolder())
	}
	if r := s.ReadTextFile("~/missing"); r.OK {
		t.Fatal("missing")
	}
}

func TestReadTextFileCapConstant(t *testing.T) {
	if MaxUploadBytes != 5*1024*1024 {
		t.Fatal("cap is 5 MiB")
	}
	p := write(t, "edge.txt", bytes.Repeat([]byte("a"), 1024))
	if r := readTextFile(p, 1024); !r.OK {
		t.Fatalf("exactly at the limit is fine: %+v", r)
	}
}
