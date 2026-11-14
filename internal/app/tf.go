package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/proto"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/wire"

	"github.com/itsnotyoutoday/squatclient/internal/config"
)

// This file is the UI-facing side of tf-squatterd (docs/TF-SQUATTER.md in the
// daemon repository): control of TinyFugue's sessions, its world records,
// remote commands, and GMCP / MSDP.

// TFWorldPut is the argument of PutTFWorld: a world record to create or replace.
// Password is write-only: empty keeps the stored one (unless ClearPassword).
type TFWorldPut struct {
	proto.TFWorld
	Password      string `json:"password,omitempty"`
	ClearPassword bool   `json:"clearPassword,omitempty"`
	SetMFile      bool   `json:"setMfile,omitempty"`
	Save          bool   `json:"save,omitempty"` // also run /saveworld in TinyFugue
}

// TFExecResult is what a remote TinyFugue command printed.
type TFExecResult struct {
	OK  bool     `json:"ok"`
	Out []string `json:"out"`
}

// SessionData is the latest GMCP and MSDP data of a session.
type SessionData = engine.SessionData

// SetControl changes one control axis of a TinyFugue session: axis "input"
// (mode "tf", "remote" or "both") or "automation" ("tf" or "client"). It
// returns when TinyFugue has applied it; with squat_takeover=ask in TinyFugue
// that waits for its user.
func (s *Service) SetControl(sessionID, axis, mode string) error {
	return s.eng.SetControl(sessionID, axis, mode)
}

// ControlPreset applies "viewer", "copilot", "takeover" or "full" to a session.
func (s *Service) ControlPreset(sessionID, preset string) error {
	return s.eng.ControlPreset(sessionID, preset)
}

// SetSquatterAutomation stores "tf" or "client" as the squatter's automation
// preference and applies it to its sessions now.
func (s *Service) SetSquatterAutomation(id, mode string) error {
	q, ok := s.squatterRecord(id)
	if !ok {
		return errors.New("no such squatter")
	}
	if !q.IsTF() {
		return errors.New("automation can only be chosen for a TinyFugue squatter")
	}
	if mode != "tf" && mode != "client" {
		return fmt.Errorf("automation must be \"tf\" or \"client\", not %q", mode)
	}
	q.Automation = mode
	if _, err := s.cfg.SaveSquatter(q); err != nil {
		return err
	}
	return s.eng.SetSquatterAutomation(id, mode)
}

func (s *Service) squatterRecord(id string) (config.Squatter, bool) {
	for _, q := range s.cfg.Squatters() {
		if q.ID == id {
			return q, true
		}
	}
	return config.Squatter{}, false
}

// ListTFWorlds returns TinyFugue's world records (never with passwords).
func (s *Service) ListTFWorlds(squatterID string) ([]proto.TFWorld, error) {
	ws, err := s.eng.TFWorlds(squatterID)
	if ws == nil {
		ws = []proto.TFWorld{}
	}
	return ws, err
}

// PutTFWorld creates or edits a world record in TinyFugue.
func (s *Service) PutTFWorld(squatterID string, w TFWorldPut) error {
	_, err := s.eng.PutTFWorld(squatterID, wire.WorldPutReq{World: w.TFWorld, Password: w.Password,
		ClearPassword: w.ClearPassword, SetMFile: w.SetMFile, Save: w.Save})
	return err
}

// DeleteTFWorld removes a world record from TinyFugue (refused while connected).
func (s *Service) DeleteTFWorld(squatterID, name string) error {
	return s.eng.DeleteTFWorld(squatterID, name)
}

// ConnectTFWorld opens a connection from one of TinyFugue's world records.
// TinyFugue logs in with its own record; no password passes through this app.
func (s *Service) ConnectTFWorld(squatterID, name string) (engine.SessionInfo, error) {
	if strings.TrimSpace(name) == "" {
		return engine.SessionInfo{}, errors.New("a world name is required")
	}
	if err := s.ensureSquatter(squatterID); err != nil {
		return engine.SessionInfo{}, err
	}
	return s.eng.Dial(engine.World{Name: name, Via: squatterID, Ref: name}, "")
}

// TFExec runs a TinyFugue command ("/...") and returns what it printed. Admin
// devices only, and only when TinyFugue has squat_exec on.
func (s *Service) TFExec(squatterID, line string) (TFExecResult, error) {
	r, err := s.eng.TFExec(squatterID, line)
	if err != nil {
		return TFExecResult{}, err
	}
	if r.Out == nil {
		r.Out = []string{}
	}
	return TFExecResult{OK: r.OK, Out: r.Out}, nil
}

// SendGmcp sends a GMCP message to the game; dataJSON is the JSON data or "".
func (s *Service) SendGmcp(sessionID, pkg, dataJSON string) error {
	var data any
	if strings.TrimSpace(dataJSON) != "" {
		if err := json.Unmarshal([]byte(dataJSON), &data); err != nil {
			return fmt.Errorf("the GMCP data is not valid JSON: %w", err)
		}
	}
	return s.eng.SendGmcp(sessionID, pkg, data)
}

// SendMsdp sends MSDP variables to the game; varsJSON is an object such as
// {"REPORT":["HEALTH","MANA"]}.
func (s *Service) SendMsdp(sessionID, varsJSON string) error {
	var vars map[string]any
	if err := json.Unmarshal([]byte(varsJSON), &vars); err != nil || len(vars) == 0 {
		return errors.New("MSDP variables must be a non-empty JSON object, e.g. {\"LIST\":\"COMMANDS\"}")
	}
	return s.eng.SendMsdp(sessionID, vars)
}

// GetSessionData returns the latest GMCP and MSDP values of a session.
func (s *Service) GetSessionData(sessionID string) (SessionData, error) {
	d, err := s.eng.SessionData(sessionID)
	if d.Gmcp == nil {
		d.Gmcp = map[string]json.RawMessage{}
	}
	if d.Msdp == nil {
		d.Msdp = map[string]any{}
	}
	return d, err
}

// TFScriptResult is what uploading a script did.
type TFScriptResult struct {
	Stored bool     `json:"stored"`
	Loaded bool     `json:"loaded"`
	Out    []string `json:"out"`
}

// TFScript describes a script stored in TinyFugue.
type TFScript struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
}

// PutTFScript uploads a script (a TinyFugue macro file) to TinyFugue and, with load, activates it.
// Admin devices only; TinyFugue's squat_scripts setting decides whether and how: "safe" runs it
// sandboxed (no shell, files, new connections or Lua), "on" with TinyFugue's own rights, off refuses.
func (s *Service) PutTFScript(squatterID, name, content string, load bool) (TFScriptResult, error) {
	r, err := s.eng.PutTFScript(squatterID, name, content, load)
	if err != nil {
		return TFScriptResult{}, err
	}
	out := r.Out
	if out == nil {
		out = []string{}
	}
	return TFScriptResult{Stored: r.Stored, Loaded: r.Loaded, Out: out}, nil
}

// ListTFScripts lists the scripts stored in TinyFugue.
func (s *Service) ListTFScripts(squatterID string) ([]TFScript, error) {
	ls, err := s.eng.TFScripts(squatterID)
	if err != nil {
		return nil, err
	}
	out := make([]TFScript, 0, len(ls))
	for _, i := range ls {
		out = append(out, TFScript{Name: i.Name, Size: i.Size, Mtime: i.Mtime})
	}
	return out, nil
}

// DeleteTFScript removes a stored script file (macros it already defined stay until undefined).
func (s *Service) DeleteTFScript(squatterID, name string) error {
	return s.eng.DeleteTFScript(squatterID, name)
}

// RenameTFWorld gives one of TinyFugue's world records a new name; a world of this app that is
// routed through it follows (see tfmirror.go).
func (s *Service) RenameTFWorld(squatterID, name, newName string) error {
	return s.eng.RenameTFWorld(squatterID, name, strings.TrimSpace(newName), true)
}
