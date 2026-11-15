package dlog

import (
	"encoding/json"
	"os"
	"strings"
)

// Mode is the compile-time diagnostics policy (-X main.diagnosticsMode=always|optin|off).
type Mode string

const (
	Always Mode = "always" // alpha: on from the first start; it stays on unless the user turned it off in the dialog
	OptIn  Mode = "optin"  // off until the user turns it on
	Off    Mode = "off"    // compiled out: no logging, no menu entry
)

// ParseMode reads the ldflags string; anything unknown is the privacy-conservative opt-in.
func ParseMode(s string) Mode {
	switch Mode(strings.ToLower(strings.TrimSpace(s))) {
	case Always:
		return Always
	case Off:
		return Off
	}
	return OptIn
}

// Prefs is what the user chose in the dialog; it persists in the config folder.
type Prefs struct {
	Chosen  bool `json:"chosen"`  // the user changed the switch at least once
	Enabled bool `json:"enabled"` // what they chose
}

// Effective says whether logging is on for a mode and the user's saved choice.
func Effective(m Mode, p Prefs) bool {
	switch m {
	case Always:
		return !(p.Chosen && !p.Enabled)
	case OptIn:
		return p.Chosen && p.Enabled
	}
	return false
}

// LoadPrefs reads the saved choice (a missing or damaged file is "never chosen").
func LoadPrefs(path string) Prefs {
	var p Prefs
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &p)
	}
	return p
}

// SavePrefs writes the choice.
func SavePrefs(path string, p Prefs) error {
	b, _ := json.Marshal(p)
	return os.WriteFile(path, b, 0o600)
}
