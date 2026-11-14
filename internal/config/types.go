// Package config persists SquatClient's user data as JSON files in the OS
// user-config directory (SquatClient/): worlds, settings, squatters and window
// state. Writes are atomic (temp file + fsync + rename) and every file carries
// a version field for migrations. Game passwords are NOT stored here (see
// internal/secrets); only a HasPassword flag is.
package config

// Login mirrors the UI contract's WorldConfig.login.
type Login struct {
	Template    string `json:"template"`
	CharName    string `json:"charName,omitempty"`
	HasPassword bool   `json:"hasPassword"`
	DelayMs     int    `json:"delayMs,omitempty"`
}

// World mirrors docs/UI-CONTRACT.md WorldConfig.
type World struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Group       string `json:"group,omitempty"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	TLS         bool   `json:"tls"`
	TLSVerify   string `json:"tlsVerify"` // strict | insecure
	Encoding    string `json:"encoding"`  // utf-8 | latin1
	Via         string `json:"via"`       // direct | squatter id
	Notes       string `json:"notes,omitempty"`
	Login       *Login `json:"login,omitempty"`
	AutoConnect bool   `json:"autoConnect,omitempty"`
	MacrosFile  string `json:"macrosFile,omitempty"`
	// GameType overrides detection of the kind of game (see engine.GameKinds: pennmush, cobramush,
	// circlemud, evennia, lambdamoo...; "other" = something else). Empty means detect.
	GameType string `json:"gameType,omitempty"`
}

// Squatter is a remote daemon entry (stored now, used when squatter
// connections land).
type Squatter struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Fingerprint string `json:"fingerprint,omitempty"`
	Paired      bool   `json:"paired"`
	// Kind is "squatterd" (the default; records from before kinds existed have none) or
	// "tf-squatterd" (a TinyFugue bridge, docs/TF-SQUATTER.md in the daemon repository).
	Kind string `json:"kind,omitempty"`
	// Automation (tf-squatterd only): "tf" (default: TinyFugue runs the triggers, this client
	// only displays) or "client" (this client runs them while it is connected).
	Automation string `json:"automation,omitempty"`
}

// Squatter kinds.
const (
	KindSquatterd   = "squatterd"
	KindTFSquatterd = "tf-squatterd"
)

// KindOrDefault is the record's kind, defaulting old records to squatterd.
func (q Squatter) KindOrDefault() string {
	if q.Kind == KindTFSquatterd {
		return KindTFSquatterd
	}
	return KindSquatterd
}

// IsTF reports whether the squatter is a TinyFugue bridge.
func (q Squatter) IsTF() bool { return q.KindOrDefault() == KindTFSquatterd }

// Settings mirrors docs/UI-CONTRACT.md Settings.
type Settings struct {
	Theme           string  `json:"theme"`
	FontFamily      string  `json:"fontFamily"`
	FontSize        float64 `json:"fontSize"`
	ScrollbackLines int     `json:"scrollbackLines"`
	Timestamps      bool    `json:"timestamps"`
	BoldAsBright    bool    `json:"boldAsBright"`
	MinContrast     float64 `json:"minContrast"`
	Linkify         bool    `json:"linkify"`
	Notifications   bool    `json:"notifications"`
	ScreenReader    bool    `json:"screenReader"`
	PauseOnScroll   bool    `json:"pauseOnScroll"`
	DefaultEncoding string  `json:"defaultEncoding"`
	Truecolor       bool    `json:"truecolor"`

	// Command window / editor / history (see docs/APP.md "Command window").
	InputHeight     int  `json:"inputHeight"`     // px of the single-line input area; 0 = automatic (1 line, grows to 8)
	EditorHeight    int  `json:"editorHeight"`    // px of the editor-mode area
	SoftcodeJoin    bool `json:"softcodeJoin"`    // editor mode: indented lines continue the previous line
	StripBlankLines bool `json:"stripBlankLines"` // editor mode: drop blank and @@-comment-only lines
	SendLineDelayMs int  `json:"sendLineDelayMs"` // editor mode: pause between lines of a block (0 = none)
	HistoryMax      int  `json:"historyMax"`      // entries kept per world
	WarnUnbalanced  bool `json:"warnUnbalanced"`  // editor mode: ask before sending a buffer with bracket problems

	// AutoReconnectSquatters brings a lost link to a squatter back by itself (laptop sleep, network drop).
	AutoReconnectSquatters bool `json:"autoReconnectSquatters"`

	// ShowGagged shows lines TinyFugue gagged (tf-squatterd sessions) instead of hiding them.
	ShowGagged bool `json:"showGagged"`
}

// Limits of the command-window settings (SaveSettings clamps into them).
const (
	MaxInputHeight     = 4000
	DefaultEditorH     = 240
	MaxSendLineDelayMs = 10000
	MinHistoryMax      = 100
	MaxHistoryMax      = 1000000
	DefaultHistoryMax  = 20000
)

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// clampCommandWindow forces the command-window settings into their ranges.
func (s *Settings) clampCommandWindow() {
	s.InputHeight = clampInt(s.InputHeight, 0, MaxInputHeight)
	s.EditorHeight = clampInt(s.EditorHeight, 0, MaxInputHeight)
	s.SendLineDelayMs = clampInt(s.SendLineDelayMs, 0, MaxSendLineDelayMs)
	s.HistoryMax = clampInt(s.HistoryMax, MinHistoryMax, MaxHistoryMax) // 0 is not allowed: it clamps to the minimum
}

// DefaultSettings matches DEFAULT_SETTINGS in the front end.
func DefaultSettings() Settings {
	return Settings{
		Theme: "dark", FontFamily: "JetBrains Mono, SF Mono, Menlo, Consolas, monospace", FontSize: 14,
		ScrollbackLines: 20000, Notifications: true, Linkify: true, PauseOnScroll: true,
		DefaultEncoding: "utf-8", Truecolor: true,
		EditorHeight: DefaultEditorH, SoftcodeJoin: true, StripBlankLines: true, HistoryMax: DefaultHistoryMax, WarnUnbalanced: true, AutoReconnectSquatters: true,
	}
}

// Window is the remembered main-window geometry.
type Window struct {
	X         int  `json:"x"`
	Y         int  `json:"y"`
	Width     int  `json:"width"`
	Height    int  `json:"height"`
	Maximised bool `json:"maximised,omitempty"`
	Valid     bool `json:"valid"` // false until a geometry has been saved
}

// SquatterBacklog is how many missed entries are requested when re-attaching
// to a squatter session (bounded by the daemon at 20000): the scrollback size.
func (s Settings) SquatterBacklog() int {
	switch {
	case s.ScrollbackLines <= 0:
		return 0 // engine default
	case s.ScrollbackLines > 20000:
		return 20000
	}
	return s.ScrollbackLines
}
