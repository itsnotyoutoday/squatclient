package main

import "github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"

// The CMCP part of the UI contract (docs/CMCP.md); each method delegates to internal/app.Service.

// CmcpState returns a session's CMCP model and bound screen (nil if the game does not speak CMCP).
func (a *App) CmcpState(session string) (*engine.CmcpUI, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	u, err := s.CmcpState(session)
	if err != nil {
		return nil, nil //nolint:nilerr // "this session does not speak CMCP" is not an error for the window
	}
	return u, nil
}

// CmcpEvent performs a widget event of the current screen; valueJSON is the widget's output ($value) or "".
func (a *App) CmcpEvent(session, path, event, valueJSON string) (engine.CmcpEventResult, error) {
	s, err := a.service()
	if err != nil {
		return engine.CmcpEventResult{}, err
	}
	return s.CmcpEvent(session, path, event, valueJSON)
}

// CmcpCommand sends a verb of the game's catalogue; argsJSON is an object or "".
func (a *App) CmcpCommand(session, name, argsJSON string) (engine.CmcpTicket, error) {
	s, err := a.service()
	if err != nil {
		return engine.CmcpTicket{}, err
	}
	return s.CmcpCommand(session, name, argsJSON)
}

// CmcpAcquire sets the extra packages an owner needs (JSON array of {pkg, rate_ms}); reference counted.
func (a *App) CmcpAcquire(session, owner, subsJSON string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.CmcpAcquire(session, owner, subsJSON)
}

// CmcpRelease drops every package an owner acquired.
func (a *App) CmcpRelease(session, owner string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.CmcpRelease(session, owner)
}

// CmcpSprite returns a sprite of the session's current pack with the theme's tokens resolved (JSON text).
func (a *App) CmcpSprite(session, sprite string) (string, error) {
	s, err := a.service()
	if err != nil {
		return "", err
	}
	return s.CmcpSprite(session, sprite)
}

// CmcpSetUI writes a key of the screen's $ui state for a widget (valueJSON "" or null deletes it).
func (a *App) CmcpSetUI(session, key, valueJSON string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.CmcpSetUI(session, key, valueJSON)
}

// CmcpPackConsent answers "This game wants to use its interface ... Allow?" for a pack.
func (a *App) CmcpPackConsent(session, packID string, allow bool) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.CmcpPackConsent(session, packID, allow)
}

// CmcpViewEvent toggles the text view ("log_toggle" or "screen_toggle") and returns the state (default, expanded, off).
func (a *App) CmcpViewEvent(session, ev string) (string, error) {
	s, err := a.service()
	if err != nil {
		return "", err
	}
	return s.CmcpViewEvent(session, ev)
}

// CmcpShowScreen shows another screen of the current console locally ("std.power", "<pack>/<screen>").
func (a *App) CmcpShowScreen(session, screen string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.CmcpShowScreen(session, screen)
}

// CmcpCycleScreen shows the next (dir > 0) or previous available screen of the console.
func (a *App) CmcpCycleScreen(session string, dir int) (string, error) {
	s, err := a.service()
	if err != nil {
		return "", err
	}
	return s.CmcpCycleScreen(session, dir)
}

// CmcpPinScreen keeps the locally chosen screen across console changes.
func (a *App) CmcpPinScreen(session string, pin bool) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.CmcpPinScreen(session, pin)
}
