package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLayoutsThroughTheService(t *testing.T) {
	f := newFixture(t)
	s := f.svc
	if l, err := s.ListLayouts(); err != nil || len(l) != 0 {
		t.Fatalf("%v %v", l, err)
	}
	if len(s.LayoutStarters()) < 4 {
		t.Fatal("no starter layouts")
	}
	// a file the user dropped into the folder needs an explicit OK
	dir := s.LayoutsDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "mine.layout"), []byte("<App><Mush /><InputBar /></App>"), 0o600); err != nil {
		t.Fatal(err)
	}
	b, err := s.LoadLayout("mine")
	if err != nil || !b.NeedsConsent || b.Code != "" {
		t.Fatalf("%+v %v", b, err)
	}
	if err := s.AllowLayout("mine", b.Hash, true); err != nil {
		t.Fatal(err)
	}
	if b, _ = s.LoadLayout("mine"); b.NeedsConsent || b.Code == "" {
		t.Fatalf("%+v", b)
	}
	// copying a starter and saving it needs no prompt, a layout that does not compile is refused
	st := s.LayoutStarters()[0]
	if _, err := s.SaveLayout("copy", st.Source); err != nil {
		t.Fatal(err)
	}
	if b, _ = s.LoadLayout("copy"); b.NeedsConsent || b.Code == "" {
		t.Fatalf("%+v", b)
	}
	if _, err := s.SaveLayout("broken", "<App><Text value={ }</App>"); err == nil {
		t.Fatal("saved a layout that does not compile")
	}
	src, err := s.ReadLayout("copy")
	if err != nil || src != st.Source {
		t.Fatalf("%q %v", src, err)
	}
	if err := s.DeleteLayout("copy"); err != nil {
		t.Fatal(err)
	}
	// saving and allowing tell the window
	f.until("layouts-changed", func() bool { return len(f.events("layouts-changed")) > 0 })
}
