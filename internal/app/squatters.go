package app

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/auth"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"

	"github.com/itsnotyoutoday/squatclient/internal/config"
	"github.com/itsnotyoutoday/squatclient/internal/secrets"
)

// SquatterView is config.Squatter plus the live connection state
// (a superset of the UI contract's SquatterConfig).
type SquatterView struct {
	config.Squatter
	State    string `json:"state"`
	Problem  string `json:"problem,omitempty"`
	Message  string `json:"message,omitempty"`
	Sessions int    `json:"sessions"`
}

// pendingPair is a squatter whose fingerprint the user has not confirmed yet.
// The pairing code stays in memory only and is NOT sent until the user trusts
// the fingerprint (trust on first use).
type pendingPair struct {
	host string
	port int
	name string
	code string
	fp   string
	at   time.Time
}

const pairTTL = 10 * time.Minute // pairing codes live 10 minutes on the daemon

type pairing struct {
	mu      sync.Mutex
	pending map[string]pendingPair
}

// deviceKey returns this device's ed25519 key from the OS keychain, creating
// it on first use. There is no plaintext fallback: a keychain failure is an error.
func (s *Service) deviceKey() (ed25519.PrivateKey, error) {
	s.keyMu.Lock()
	defer s.keyMu.Unlock()
	v, err := s.sec.Get(secrets.DeviceKey)
	switch {
	case err == nil:
		seed, derr := base64.StdEncoding.DecodeString(v)
		if derr != nil || len(seed) != ed25519.SeedSize {
			return nil, errors.New("the stored device key is corrupt; remove the keychain entry " + secrets.DeviceKey + " and pair again")
		}
		return ed25519.NewKeyFromSeed(seed), nil
	case errors.Is(err, secrets.ErrNotFound):
		k, gerr := auth.GenerateKey()
		if gerr != nil {
			return nil, gerr
		}
		if serr := s.sec.Set(secrets.DeviceKey, base64.StdEncoding.EncodeToString(k.Seed())); serr != nil {
			return nil, fmt.Errorf("cannot store the device key in the OS keychain: %w", serr)
		}
		return k, nil
	}
	return nil, fmt.Errorf("device key unavailable: %w", err)
}

func deviceName() string {
	if h, err := os.Hostname(); err == nil && h != "" {
		return "SquatClient on " + h
	}
	return "SquatClient"
}

func (s *Service) engineSquatter(q config.Squatter, key ed25519.PrivateKey, code string) engine.SquatterConfig {
	return engine.SquatterConfig{ID: q.ID, Name: q.Name, Host: q.Host, Port: q.Port, Key: key, DeviceName: deviceName(),
		Fingerprint: q.Fingerprint, PairCode: code, MaxBacklog: s.cfg.Settings().SquatterBacklog()}
}

// ListSquatters returns the stored squatters with their live state.
func (s *Service) ListSquatters() ([]SquatterView, error) {
	out := []SquatterView{}
	for _, q := range s.cfg.Squatters() {
		v := SquatterView{Squatter: q, State: engine.SqIdle}
		if st, err := s.eng.SquatterStatus(q.ID); err == nil {
			v.State, v.Problem, v.Message, v.Sessions = st.State, st.Problem, st.Message, st.Sessions
		}
		out = append(out, v)
	}
	return out, nil
}

// PairSquatter is step 1 of trust on first use: it performs only a TLS
// handshake to read the server's certificate fingerprint. The pairing code is
// NOT sent; it is kept in memory until ConfirmSquatter(id, true).
func (s *Service) PairSquatter(host string, port int, name, pairCode string) (PairResult, error) {
	host = strings.TrimSpace(host)
	pairCode = strings.TrimSpace(pairCode)
	if host == "" || port < 1 || port > 65535 {
		return PairResult{}, errors.New("host and a port between 1 and 65535 are required")
	}
	if pairCode == "" {
		return PairResult{}, errors.New("the pairing code is required (run `squatterd pair` on the server)")
	}
	if strings.TrimSpace(name) == "" {
		name = host
	}
	ctx, cancel := context.WithTimeout(s.ctx, 15*time.Second)
	defer cancel()
	fp, err := engine.ProbeSquatter(ctx, host, port)
	if err != nil {
		return PairResult{}, fmt.Errorf("cannot reach a squatter at %s:%d (is squatterd running and the port open?): %w", host, port, err)
	}
	id := "sq" + config.NewID()
	s.pair.mu.Lock()
	defer s.pair.mu.Unlock()
	if s.pair.pending == nil {
		s.pair.pending = map[string]pendingPair{}
	}
	for k, p := range s.pair.pending {
		if time.Since(p.at) > pairTTL {
			delete(s.pair.pending, k)
		}
	}
	s.pair.pending[id] = pendingPair{host: host, port: port, name: strings.TrimSpace(name), code: pairCode, fp: fp, at: time.Now()}
	return PairResult{ID: id, Fingerprint: fp}, nil
}

// ConfirmSquatter is step 2: with accept=true the fingerprint is pinned, the
// device key is created in the keychain if needed, and the engine connects
// sending the pairing code in hello. On success the squatter is stored as
// paired. With accept=false the pending entry is dropped (the code is never sent).
func (s *Service) ConfirmSquatter(id string, accept bool) error {
	s.pair.mu.Lock()
	p, ok := s.pair.pending[id]
	if ok && !accept {
		delete(s.pair.pending, id)
	}
	s.pair.mu.Unlock()
	if !ok {
		return errors.New("no pending squatter pairing (it may have expired): start again")
	}
	if !accept {
		return nil
	}
	key, err := s.deviceKey()
	if err != nil {
		return err
	}
	q, err := s.cfg.SaveSquatter(config.Squatter{ID: id, Name: p.name, Host: p.host, Port: p.port, Fingerprint: p.fp, Paired: false})
	if err != nil {
		return err
	}
	if err := s.eng.AddSquatter(s.engineSquatter(q, key, p.code)); err != nil {
		_ = s.cfg.DeleteSquatter(id)
		return err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 20*time.Second)
	defer cancel()
	if err := s.eng.ConnectSquatter(ctx, id); err != nil {
		_ = s.eng.RemoveSquatter(id)
		_ = s.cfg.DeleteSquatter(id)
		return fmt.Errorf("pairing failed: %w", err)
	}
	q.Paired = true
	if _, err := s.cfg.SaveSquatter(q); err != nil {
		return err
	}
	s.pair.mu.Lock()
	delete(s.pair.pending, id)
	s.pair.mu.Unlock()
	return nil
}

// RemoveSquatter forgets a squatter on this device (the daemon keeps running
// its sessions; revoke the device there with `squatterd revoke`).
func (s *Service) RemoveSquatter(id string) error {
	if err := s.cfg.DeleteSquatter(id); err != nil {
		return err
	}
	if err := s.eng.RemoveSquatter(id); err != nil && !errors.Is(err, engine.ErrNoSquatter) {
		return err
	}
	return nil
}

// ReconnectSquatter is the explicit "Reconnect" action: nothing reconnects by itself.
func (s *Service) ReconnectSquatter(id string) error {
	ctx, cancel := context.WithTimeout(s.ctx, 20*time.Second)
	defer cancel()
	return s.eng.ReconnectSquatter(ctx, id)
}

// Suspend is /suspend: detach from the squatters (they keep the sessions
// running) and minimise the window. It returns the number of detached sessions.
func (s *Service) Suspend() int { return s.eng.Suspend() }

// Resume re-attaches suspended squatter sessions and replays what was missed.
func (s *Service) Resume() error {
	ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
	defer cancel()
	return s.eng.ResumeSquatters(ctx)
}

// startSquatters registers every paired squatter with the engine and connects
// it once (app start): they may hold sessions from a previous run. It does not
// retry; a failure is reported as a notice and the squatter shows its state.
func (s *Service) startSquatters() {
	var ids []string
	for _, q := range s.cfg.Squatters() {
		if !q.Paired {
			continue
		}
		key, err := s.deviceKey()
		if err != nil {
			s.emit("notice", Notice{Level: "error", Text: fmt.Sprintf("squatter %s: %v", q.Name, err)})
			return
		}
		if err := s.eng.AddSquatter(s.engineSquatter(q, key, "")); err != nil {
			s.log.Warn("add squatter", "id", q.ID, "err", err)
			continue
		}
		ids = append(ids, q.ID)
	}
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(s.ctx, 20*time.Second)
			defer cancel()
			if err := s.eng.ConnectSquatter(ctx, id); err != nil {
				s.log.Warn("squatter connect", "id", id, "err", err) // the engine already published a notice
			}
		}()
	}
	wg.Wait()
}

// ensureSquatter makes sure the squatter used by a world is connected. This
// runs for an explicit connect() by the user (one attempt, never a retry loop).
func (s *Service) ensureSquatter(id string) error {
	st, err := s.eng.SquatterStatus(id)
	if err != nil {
		return fmt.Errorf("this world connects via a squatter that is not set up on this device (squatter %s): pair it in Squatters", id)
	}
	if st.State == engine.SqConnected {
		return nil
	}
	if st.State == engine.SqRefused {
		return errors.New(st.Message)
	}
	ctx, cancel := context.WithTimeout(s.ctx, 20*time.Second)
	defer cancel()
	return s.eng.ConnectSquatter(ctx, id)
}
