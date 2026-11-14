package main

import (
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/proto"

	"github.com/itsnotyoutoday/squatclient/internal/app"
)

// The methods below are the TinyFugue-squatter (tf-squatterd) part of the UI
// contract; each delegates to internal/app.Service (internal/app/tf.go).

// SetControl changes one control axis ("input" or "automation") of a TinyFugue session.
func (a *App) SetControl(sessionID, axis, mode string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.SetControl(sessionID, axis, mode)
}

// ControlPreset applies "viewer", "copilot", "takeover" or "full" to a TinyFugue session.
func (a *App) ControlPreset(sessionID, preset string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.ControlPreset(sessionID, preset)
}

// SetSquatterAutomation stores and applies "tf" or "client" as a squatter's automation preference.
func (a *App) SetSquatterAutomation(id, mode string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.SetSquatterAutomation(id, mode)
}

// ListTFWorlds returns TinyFugue's world records.
func (a *App) ListTFWorlds(squatterID string) ([]proto.TFWorld, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	return s.ListTFWorlds(squatterID)
}

// PutTFWorld creates or edits a world record in TinyFugue.
func (a *App) PutTFWorld(squatterID string, w app.TFWorldPut) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.PutTFWorld(squatterID, w)
}

// DeleteTFWorld removes a world record from TinyFugue.
func (a *App) DeleteTFWorld(squatterID, name string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.DeleteTFWorld(squatterID, name)
}

// ConnectTFWorld opens a connection from one of TinyFugue's world records.
func (a *App) ConnectTFWorld(squatterID, name string) (engine.SessionInfo, error) {
	s, err := a.service()
	if err != nil {
		return engine.SessionInfo{}, err
	}
	return s.ConnectTFWorld(squatterID, name)
}

// TFExec runs a TinyFugue command for an admin device.
func (a *App) TFExec(squatterID, line string) (app.TFExecResult, error) {
	s, err := a.service()
	if err != nil {
		return app.TFExecResult{}, err
	}
	return s.TFExec(squatterID, line)
}

// SendGmcp sends a GMCP message (JSON data or "") to the game of a session.
func (a *App) SendGmcp(sessionID, pkg, dataJSON string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.SendGmcp(sessionID, pkg, dataJSON)
}

// SendMsdp sends MSDP variables (a JSON object) to the game of a session.
func (a *App) SendMsdp(sessionID, varsJSON string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.SendMsdp(sessionID, varsJSON)
}

// GetSessionData returns the latest GMCP and MSDP values of a session.
func (a *App) GetSessionData(sessionID string) (app.SessionData, error) {
	s, err := a.service()
	if err != nil {
		return app.SessionData{}, err
	}
	return s.GetSessionData(sessionID)
}

// PutTFScript uploads a script to TinyFugue and optionally loads it.
func (a *App) PutTFScript(squatterID, name, content string, load bool) (app.TFScriptResult, error) {
	s, err := a.service()
	if err != nil {
		return app.TFScriptResult{}, err
	}
	return s.PutTFScript(squatterID, name, content, load)
}

// ListTFScripts lists the scripts stored in TinyFugue.
func (a *App) ListTFScripts(squatterID string) ([]app.TFScript, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	return s.ListTFScripts(squatterID)
}

// DeleteTFScript removes a stored script from TinyFugue.
func (a *App) DeleteTFScript(squatterID, name string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.DeleteTFScript(squatterID, name)
}
