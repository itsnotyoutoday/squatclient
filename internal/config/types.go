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
}

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
}

// DefaultSettings matches DEFAULT_SETTINGS in the front end.
func DefaultSettings() Settings {
	return Settings{
		Theme: "dark", FontFamily: "JetBrains Mono, SF Mono, Menlo, Consolas, monospace", FontSize: 14,
		ScrollbackLines: 20000, Notifications: true, Linkify: true, PauseOnScroll: true,
		DefaultEncoding: "utf-8", Truecolor: true,
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
