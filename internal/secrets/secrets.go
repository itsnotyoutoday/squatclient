// Package secrets keeps game passwords (and later the device key) in the OS
// keychain, keyed by world id. There is deliberately no plaintext fallback: if
// the keychain is unavailable the operation fails with ErrUnavailable.
package secrets

import (
	"errors"
	"fmt"
	"sync"

	"github.com/zalando/go-keyring"
)

// Service is the keychain service name.
const Service = "com.itsnotyoutoday.squatclient"

// Errors.
var (
	ErrNotFound    = errors.New("secrets: not found")
	ErrUnavailable = errors.New("secrets: OS keychain unavailable")
)

// Store is a secret store.
type Store interface {
	Get(key string) (string, error)
	Set(key, value string) error
	Delete(key string) error
}

// WorldKey is the key for a world's game password.
func WorldKey(worldID string) string { return "world:" + worldID }

// DeviceKey is the key for the squatter device key (used later).
const DeviceKey = "device-key"

// Keychain is the OS keychain implementation (macOS Keychain, Windows
// Credential Manager, Secret Service on Linux).
type Keychain struct{}

// Get implements Store.
func (Keychain) Get(key string) (string, error) {
	v, err := keyring.Get(Service, key)
	return v, wrap(err)
}

// Set implements Store.
func (Keychain) Set(key, value string) error { return wrap(keyring.Set(Service, key, value)) }

// Delete implements Store; deleting a missing secret is not an error.
func (Keychain) Delete(key string) error {
	err := keyring.Delete(Service, key)
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return wrap(err)
}

func wrap(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, keyring.ErrNotFound):
		return ErrNotFound
	default:
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
}

// Memory is an in-memory Store for tests. Set Fail to simulate an
// unavailable keychain.
type Memory struct {
	mu   sync.Mutex
	m    map[string]string
	Fail bool
}

// NewMemory returns an empty fake.
func NewMemory() *Memory { return &Memory{m: map[string]string{}} }

// Get implements Store.
func (s *Memory) Get(key string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Fail {
		return "", ErrUnavailable
	}
	v, ok := s.m[key]
	if !ok {
		return "", ErrNotFound
	}
	return v, nil
}

// Set implements Store.
func (s *Memory) Set(key, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Fail {
		return ErrUnavailable
	}
	s.m[key] = value
	return nil
}

// Delete implements Store.
func (s *Memory) Delete(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Fail {
		return ErrUnavailable
	}
	delete(s.m, key)
	return nil
}
