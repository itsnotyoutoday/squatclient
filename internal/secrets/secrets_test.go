package secrets

import (
	"errors"
	"os"
	"testing"
)

func TestMemory(t *testing.T) {
	var s Store = NewMemory()
	if _, err := s.Get(WorldKey("a")); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if err := s.Set(WorldKey("a"), "pw"); err != nil {
		t.Fatal(err)
	}
	if v, _ := s.Get(WorldKey("a")); v != "pw" {
		t.Fatal(v)
	}
	_ = s.Delete(WorldKey("a"))
	if _, err := s.Get(WorldKey("a")); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	m := NewMemory()
	m.Fail = true
	if err := m.Set("k", "v"); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
}

// Real keychain round trip only when explicitly requested (it may prompt).
func TestKeychainOptIn(t *testing.T) {
	if os.Getenv("SQUAT_KEYCHAIN") == "" {
		t.Skip("set SQUAT_KEYCHAIN=1 to exercise the real OS keychain")
	}
	var s Store = Keychain{}
	k := WorldKey("test-" + t.Name())
	if err := s.Set(k, "pw1"); err != nil {
		t.Fatal(err)
	}
	if v, err := s.Get(k); err != nil || v != "pw1" {
		t.Fatalf("get: %q %v", v, err)
	}
	if err := s.Delete(k); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(k); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete: %v", err)
	}
}
