package app

import (
	"errors"
	"fmt"
	"strings"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/proto"

	"github.com/itsnotyoutoday/squatclient/internal/config"
	"github.com/itsnotyoutoday/squatclient/internal/secrets"
)

// ConnectTarget is `{worldId} | {host, port, tls}` (UI-CONTRACT connect()).
type ConnectTarget struct {
	WorldID string `json:"worldId,omitempty"`
	Host    string `json:"host,omitempty"`
	Port    int    `json:"port,omitempty"`
	TLS     bool   `json:"tls,omitempty"`
	// Optional settings of an ad-hoc connection (a reconnect of a quick connect keeps them).
	Name      string `json:"name,omitempty"`
	TLSVerify string `json:"tlsVerify,omitempty"`
	Encoding  string `json:"encoding,omitempty"`
	Via       string `json:"via,omitempty"` // "" / direct, or a squatter id
}

// ScrollbackOpts is `{beforeSeq?, limit}`.
type ScrollbackOpts struct {
	BeforeSeq uint64 `json:"beforeSeq,omitempty"`
	Limit     int    `json:"limit"`
}

// SearchOpts is `{regex?, caseSensitive?}`.
type SearchOpts struct {
	Regex         bool `json:"regex,omitempty"`
	CaseSensitive bool `json:"caseSensitive,omitempty"`
}

// PairResult is pairSquatter's return value (the fingerprint to be confirmed).
type PairResult struct {
	ID          string `json:"id"`
	Fingerprint string `json:"fingerprint"`
}

// ---- worlds and settings -------------------------------------------------

// ListWorlds returns all configured worlds.
func (s *Service) ListWorlds() ([]config.World, error) { return s.cfg.Worlds(), nil }

// SaveWorld creates or updates a world; the stored copy is returned.
func (s *Service) SaveWorld(w config.World) (config.World, error) {
	var old *config.World
	if w.ID != "" {
		if o, err := s.cfg.World(w.ID); err == nil {
			old = &o
		}
	}
	out, err := s.cfg.SaveWorld(w)
	if err != nil {
		return config.World{}, err
	}
	s.syncWorlds()
	s.afterSaveWorld(old, out) // a world routed through TinyFugue is a TinyFugue world record too
	if old != nil && old.Name != out.Name {
		for _, si := range s.eng.Sessions() { // open connections of this world carry its name
			if si.WorldID == out.ID && si.Name != out.Name {
				_ = s.eng.RenameSession(si.ID, out.Name)
			}
		}
	}
	return out, nil
}

// DeleteWorld removes a world and its keychain entry.
func (s *Service) DeleteWorld(id string) error {
	gone, gerr := s.cfg.World(id)
	if err := s.cfg.DeleteWorld(id); err != nil {
		return err
	}
	if err := s.sec.Delete(secrets.WorldKey(id)); err != nil {
		s.log.Warn("delete secret", "world", id, "err", err)
	}
	s.syncWorlds()
	if gerr == nil {
		s.afterDeleteWorld(gone)
	}
	return nil
}

// SetWorldPassword stores (or, when empty, clears) the world's game password
// in the OS keychain. It never touches disk.
func (s *Service) SetWorldPassword(id, password string) error {
	if _, err := s.cfg.World(id); err != nil {
		return err
	}
	if password == "" {
		if err := s.sec.Delete(secrets.WorldKey(id)); err != nil {
			return err
		}
		return s.cfg.SetHasPassword(id, false)
	}
	if err := s.sec.Set(secrets.WorldKey(id), password); err != nil {
		return fmt.Errorf("cannot store the password: %w", err)
	}
	return s.cfg.SetHasPassword(id, true)
}

// GetSettings returns the settings.
func (s *Service) GetSettings() (config.Settings, error) { return s.cfg.Settings(), nil }

// SaveSettings validates and persists settings and applies the ones that can
// change at runtime (advertised capabilities). scrollbackLines applies to
// sessions opened after the next app start.
func (s *Service) SaveSettings(in config.Settings) error {
	if err := s.cfg.SaveSettings(in); err != nil {
		return err
	}
	s.eng.SetCaps(capsFor(s.cfg.Settings()))
	s.eng.SetAutoReconnectSquatters(s.cfg.Settings().AutoReconnectSquatters)
	s.eng.SetShowGagged(s.cfg.Settings().ShowGagged)
	s.syncWorlds()
	return nil
}

// ---- sessions --------------------------------------------------------------

// Connect opens a session to a world (login automation + keychain password)
// or to an ad-hoc host:port. It returns once the session exists; progress
// arrives as `session` events.
func (s *Service) Connect(t ConnectTarget) (engine.SessionInfo, error) {
	if t.WorldID != "" {
		w, err := s.cfg.World(t.WorldID)
		if err != nil {
			return engine.SessionInfo{}, fmt.Errorf("unknown world: %w", err)
		}
		if w.Via != "" && w.Via != "direct" {
			if err := s.ensureSquatter(w.Via); err != nil {
				return engine.SessionInfo{}, err
			}
		}
		pw := ""
		if w.Login != nil && w.Login.HasPassword {
			pw, err = s.sec.Get(secrets.WorldKey(w.ID))
			if err != nil {
				return engine.SessionInfo{}, fmt.Errorf("password for %s is unavailable: %w", w.Name, err)
			}
		}
		if sq, ok := s.tfSquatterID(w.Via); ok {
			return s.dialTFWorld(sq, w, pw)
		}
		return s.eng.Dial(toEngineWorld(w, s.cfg.Settings().DefaultEncoding), pw)
	}
	host := strings.TrimSpace(t.Host)
	if host == "" || t.Port < 1 || t.Port > 65535 {
		return engine.SessionInfo{}, errors.New("host and a port between 1 and 65535 are required")
	}
	w := engine.World{Name: fmt.Sprintf("%s:%d", host, t.Port), Host: host, Port: t.Port, TLS: t.TLS,
		TLSVerify: "strict", Encoding: s.cfg.Settings().DefaultEncoding}
	if t.Name != "" {
		w.Name = t.Name
	}
	if t.TLSVerify == "insecure" {
		w.TLSVerify = "insecure"
	}
	if t.Encoding == "utf-8" || t.Encoding == "latin1" {
		w.Encoding = t.Encoding
	}
	if t.Via != "" && t.Via != "direct" {
		if err := s.ensureSquatter(t.Via); err != nil {
			return engine.SessionInfo{}, err
		}
		w.Via = t.Via
	}
	return s.eng.Dial(w, "")
}

// Disconnect closes a session's connection (it stays listed, ended).
func (s *Service) Disconnect(id string) error { return s.eng.Disconnect(id) }

// Dismiss removes a session (a `session-removed` event follows).
func (s *Service) Dismiss(id string) error { return s.eng.Dismiss(id) }

// ListSessions returns all sessions.
func (s *Service) ListSessions() ([]engine.SessionInfo, error) { return s.eng.Sessions(), nil }

// Foreground selects the foreground session.
func (s *Service) Foreground(id string) error {
	s.fgMu.Lock()
	prev := s.uiFg
	s.uiFg = id // events for this id are the UI's own choice: not echoed back
	s.fgMu.Unlock()
	err := s.eng.SetForeground(id)
	if err != nil {
		s.fgMu.Lock()
		s.uiFg = prev
		s.fgMu.Unlock()
	}
	return err
}

// ---- I/O ---------------------------------------------------------------------

// Input hands a line to the engine (commands, macros, send).
func (s *Service) Input(id, text string) error { return s.eng.Input(id, text) }

// Resize reports the output pane size (NAWS).
func (s *Service) Resize(id string, cols, rows int) error { return s.eng.Resize(id, cols, rows) }

// Scrollback returns the most recent opts.Limit lines before opts.BeforeSeq.
func (s *Service) Scrollback(id string, o ScrollbackOpts) ([]proto.Line, error) {
	return s.eng.Scrollback(id, o.BeforeSeq, o.Limit)
}

// Search finds lines in the session's history.
func (s *Service) Search(id, query string, o SearchOpts) ([]engine.Hit, error) {
	hits, err := s.eng.Search(id, query, engine.SearchOptions{Regex: o.Regex, CaseSensitive: o.CaseSensitive, Limit: 500})
	if hits == nil {
		hits = []engine.Hit{}
	}
	return hits, err
}

// Ack marks lines up to seq as seen.
func (s *Service) Ack(id string, seq uint64) error { return s.eng.Ack(id, seq) }

// ---- window ------------------------------------------------------------------

// Window returns the remembered window geometry.
func (s *Service) Window() config.Window { return s.cfg.Window() }

// SaveWindow remembers the window geometry.
func (s *Service) SaveWindow(w config.Window) error { return s.cfg.SaveWindow(w) }
