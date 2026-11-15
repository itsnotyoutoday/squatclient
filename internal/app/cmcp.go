package app

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/itsnotyoutoday/cmcp/msg"
	cs "github.com/itsnotyoutoday/cmcp/session"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
	"github.com/itsnotyoutoday/squatclient/internal/config"
)

// CMCP in the app (cmcp/spec): the engine owns one protocol session per game session and evaluates screens with the
// shared core; the Service turns its events into the "cmcp" / "cmcp-notes" window events and exposes the actions.

// cmcpHello describes this client to a game (Cobra.Hello, spec 2.3): a gpu renderer implementing the core widgets,
// the themes above, Web Audio with recipes, packs by inline chunks and HTTPS.
func (s *Service) cmcpHello() cs.Config {
	st := s.cfg.Settings()
	return cs.Config{
		Name: "SquatClient", Version: s.version(), Kind: "gui", MaxBody: 65536,
		Render:  &msg.Render{Kind: "gpu", FPS: 60},
		Widgets: map[string]int{"joystick": 1, "scope": 1, "lights": 1}, // only the optional ones; core widgets are never listed
		Themes:  config.CmcpThemes, Theme: st.ConsoleTheme,
		Audio: &msg.Audio{Play: !st.SoundMuted && st.SoundVolume > 0, Formats: []string{"wav", "ogg", "mp3"}, Recipes: true, Voices: 16},
		Input: &msg.Input{Mouse: true, Keyboard: true}, // gamepad/touch only when implemented
		Packs: &msg.HelloPacks{Formats: []int{1}, Inline: true, HTTPS: true},
	}
}

func (s *Service) version() string { return "dev" }

// applyCmcpSettings (re)configures the engine from the settings; called at start and after SaveSettings.
func (s *Service) applyCmcpSettings() {
	st := s.cfg.Settings()
	if s.mutedSeen.Swap(st.SoundMuted) != st.SoundMuted {
		defer s.soundMuteChanged("") // the global mute changed: every session stops, or resumes its loops
	}
	if s.snd != nil {
		s.snd.configure(st.SoundFolder)
	}
	if st.Cmcp {
		s.eng.SetCmcp(s.cmcpHello)
	} else {
		s.eng.SetCmcp(nil)
	}
	s.eng.SetCmcpRender(engine.CmcpRender{PortDefault: st.CmcpPortDefault, Calm: st.CmcpCalm, StartCollapsed: st.CmcpStartCollapsed, PackConsent: st.CmcpPackConsent, TextLayout: st.CmcpTextLayout, AlertPulse: st.CmcpAlertPulse, AlertAmbient: st.CmcpAlertAmbient, HitShake: st.CmcpHitShake, AlertRecolour: st.CmcpAlertRecolour, Reduced: s.reducedMotion.Load(), Theme: st.ConsoleTheme, UseShipTheme: st.ConsoleThemeMode != "fixed", Tokens: CmcpThemeTokens})
}

type cmcpNotesPayload struct {
	Session string            `json:"session"`
	Notes   []engine.CmcpNote `json:"notes"`
}

// CmcpState returns a session's CMCP model (with the current screen tree), for a window that mounts late.
func (s *Service) CmcpState(session string) (*engine.CmcpUI, error) { return s.eng.CmcpUI(session) }

// CmcpEvent reports a widget event (click, select, assign, ...) of the current screen.
func (s *Service) CmcpEvent(session, path, event, valueJSON string) (engine.CmcpEventResult, error) {
	var v any
	if valueJSON != "" {
		if err := json.Unmarshal([]byte(valueJSON), &v); err != nil {
			return engine.CmcpEventResult{}, fmt.Errorf("the widget value is not valid JSON: %w", err)
		}
	}
	return s.eng.CmcpEvent(session, path, event, v)
}

// CmcpCommand sends a verb of the game's catalogue directly (argsJSON is an object).
func (s *Service) CmcpCommand(session, name, argsJSON string) (engine.CmcpTicket, error) {
	var a map[string]any
	if argsJSON != "" {
		if err := json.Unmarshal([]byte(argsJSON), &a); err != nil {
			return engine.CmcpTicket{}, fmt.Errorf("the arguments are not a JSON object: %w", err)
		}
	}
	return s.eng.CmcpCommand(session, name, a)
}

// CmcpAcquire sets the extra packages an owner (a widget or panel) needs; subscriptions are reference counted.
func (s *Service) CmcpAcquire(session, owner, subsJSON string) error {
	var subs []msg.SubSpec
	if subsJSON != "" {
		if err := json.Unmarshal([]byte(subsJSON), &subs); err != nil {
			return fmt.Errorf("the subscriptions are not valid JSON: %w", err)
		}
	}
	return s.eng.CmcpAcquire(session, owner, subs)
}

// CmcpRelease drops everything an owner acquired.
func (s *Service) CmcpRelease(session, owner string) error { return s.eng.CmcpRelease(session, owner) }

// CmcpSprite returns a sprite of the session's current pack with the theme's tokens resolved (JSON).
func (s *Service) CmcpSprite(session, sprite string) (string, error) {
	b, err := s.eng.CmcpSprite(session, sprite)
	return string(b), err
}

// CmcpSetUI writes a key of the screen's $ui state for a widget (valueJSON null or "" deletes).
func (s *Service) CmcpSetUI(session, key, valueJSON string) error {
	var v any
	if valueJSON != "" {
		if err := json.Unmarshal([]byte(valueJSON), &v); err != nil {
			return fmt.Errorf("the value is not valid JSON: %w", err)
		}
	}
	return s.eng.CmcpSetUI(session, key, v)
}

// CmcpReducedMotion tells the engine the web view's prefers-reduced-motion (a steady alert, no fades).
func (s *Service) CmcpReducedMotion(on bool) {
	if s.reducedMotion.Swap(on) != on {
		s.applyCmcpSettings()
	}
}

// CmcpThemeDoc is the decoded downloaded theme of a session (the web view builds its skin from it).
func (s *Service) CmcpThemeDoc(session, themeID string) (map[string]any, error) {
	return s.eng.CmcpThemeDoc(session, themeID)
}

// CmcpPackConsent answers the first-use question about a game's interface pack (spec 8.8).
func (s *Service) CmcpPackConsent(session, packID string, allow bool) error {
	return s.eng.CmcpPackConsent(session, packID, allow)
}

// CmcpViewEvent toggles the text view: "log_toggle" (compact <-> expanded) or "screen_toggle" (the console screen off/on); it returns the state.
func (s *Service) CmcpViewEvent(session, ev string) (string, error) {
	return s.eng.CmcpViewEvent(session, ev)
}

// CmcpShowScreen shows another screen of the current console locally (the themes' console-switch column).
func (s *Service) CmcpShowScreen(session, screen string) error {
	return s.eng.CmcpShowScreen(session, screen)
}

// CmcpCycleScreen moves to the next (dir > 0) or previous available screen of the console, wrapping; it returns the screen shown.
func (s *Service) CmcpCycleScreen(session string, dir int) (string, error) {
	return s.eng.CmcpCycleScreen(session, dir)
}

// CmcpPinScreen keeps the locally chosen screen across console changes.
func (s *Service) CmcpPinScreen(session string, pin bool) error {
	return s.eng.CmcpPinScreen(session, pin)
}

// CmcpViewport passes the web view's viewport to the engine (the core's layout decision and the textport cap).
func (s *Service) CmcpViewport(session string, widthPx, scale, monoPx float64) error {
	return s.eng.CmcpViewport(session, widthPx, scale, monoPx)
}

// CmcpClientClosing tells every connected game that the client window is closing (Cobra.Context.Close with reason "client"); the game decides.
func (s *Service) CmcpClientClosing() {
	s.eng.CmcpCloseAll()
	time.Sleep(150 * time.Millisecond) // let the frames leave before the connections go
}

// CmcpClose asks the game to close the session's active context.
func (s *Service) CmcpClose(session, reason string) error { return s.eng.CmcpClose(session, reason) }
