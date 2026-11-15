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

// CmcpPaneEvent performs a widget event of an off-screen pane (panel, dock, float); pane is the pane's context key.
func (a *App) CmcpPaneEvent(session, pane, path, event, valueJSON string) (engine.CmcpEventResult, error) {
	s, err := a.service()
	if err != nil {
		return engine.CmcpEventResult{}, err
	}
	return s.CmcpPaneEvent(session, pane, path, event, valueJSON)
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

// CmcpThemeDoc returns the verified downloaded theme the console is drawn with (the decoded theme document).
func (a *App) CmcpThemeDoc(session, themeID string) (map[string]any, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	return s.CmcpThemeDoc(session, themeID)
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

// CmcpReducedMotion reports the web view's prefers-reduced-motion.
func (a *App) CmcpReducedMotion(on bool) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	s.CmcpReducedMotion(on)
	return nil
}

// CmcpViewport reports the web view's logical width (px), device px per scene unit and the monospace font size (px) for the layout decision.
func (a *App) CmcpViewport(session string, widthPx, scale, monoPx float64) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.CmcpViewport(session, widthPx, scale, monoPx)
}

// SetWorldSoundMuted mutes or unmutes the sound of one session's world (persisted on a saved world).
func (a *App) SetWorldSoundMuted(session string, muted bool) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.SetWorldSoundMuted(session, muted)
}

// SoundMuteState says what mutes a session: "global", "world" or "" (audible).
func (a *App) SoundMuteState(session string) (string, error) {
	s, err := a.service()
	if err != nil {
		return "", err
	}
	return s.MuteState(session), nil
}

// CmcpClose asks the game to close the session's active context (the X of the console window). The screen is not hidden here: the game decides.
func (a *App) CmcpClose(session, reason string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.CmcpClose(session, reason)
}

// ClientLog writes a line of the web view's diagnostics to client.log in the config folder.
func (a *App) ClientLog(line string) {
	if s, err := a.service(); err == nil {
		s.ClientLog(line)
	}
}

// AudioSelfTestDir is the developer sound self-test folder ("" in a normal run).
func (a *App) AudioSelfTestDir() string {
	if s, err := a.service(); err == nil {
		return s.AudioSelfTestDir()
	}
	return ""
}

// AudioSelfTestLive is the developer live self-test script ("" in a normal run).
func (a *App) AudioSelfTestLive() string {
	if s, err := a.service(); err == nil {
		return s.AudioSelfTestLive()
	}
	return ""
}
