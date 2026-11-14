// Package diag collects the platform facts shown by Help > Diagnostics: operating system, web view,
// build and paths. It holds no secrets and never reads user data. The parsing helpers are plain
// functions so they can be tested on any OS; the OS-specific probes live in os_*.go.
package diag

import (
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/proto"
)

// Input is what the application tells the collector about itself.
type Input struct {
	Version   string // application version
	BuildType string // wails build type ("dev", "production", ...) if known
	ConfigDir string
	DataDir   string
	LogDir    string
}

// Report is bound to the front end (window.go.main.App.Diagnostics).
type Report struct {
	App      AppInfo      `json:"app"`
	Platform PlatformInfo `json:"platform"`
	WebView  WebViewInfo  `json:"webview"`
	Paths    PathsInfo    `json:"paths"`
}

type AppInfo struct {
	Version       string `json:"version"`
	Commit        string `json:"commit"`
	BuildDate     string `json:"buildDate"`
	BuildType     string `json:"buildType"`
	EngineVersion string `json:"engineVersion"`
	SWPVersion    int    `json:"swpVersion"`
}

type PlatformInfo struct {
	OS        string   `json:"os"`        // runtime.GOOS
	OSName    string   `json:"osName"`    // "Windows 11 Pro", "macOS", "Ubuntu 24.04"
	OSVersion string   `json:"osVersion"` // "10.0.22631.3007", "15.1 (24B83)", kernel on Linux
	Arch      string   `json:"arch"`
	GoVersion string   `json:"goVersion"`
	Locale    string   `json:"locale"`
	Timezone  string   `json:"timezone"`
	NumCPU    int      `json:"numCPU"`
	Notes     []string `json:"notes"` // Wine, WSL, ...
}

type WebViewInfo struct {
	Engine  string `json:"engine"`  // WebView2, WKWebView, WebKitGTK
	Version string `json:"version"` // "" when it could not be read
	Note    string `json:"note"`
}

type PathsInfo struct {
	Config string `json:"config"`
	Data   string `json:"data"`
	Logs   string `json:"logs"`
}

// Collect gathers the report. It never fails: anything unreadable is left empty or noted.
func Collect(in Input) Report {
	home, _ := os.UserHomeDir()
	osName, osVer, notes := osInfo()
	tz, off := time.Now().Zone()
	loc := time.Local.String()
	r := Report{
		App: AppInfo{
			Version:       in.Version,
			BuildType:     in.BuildType,
			SWPVersion:    proto.Version,
			EngineVersion: "",
		},
		Platform: PlatformInfo{
			OS: runtime.GOOS, OSName: osName, OSVersion: osVer, Arch: runtime.GOARCH,
			GoVersion: runtime.Version(), Locale: locale(), NumCPU: runtime.NumCPU(),
			Timezone: FormatTimezone(loc, tz, off), Notes: notes,
		},
		WebView: webViewInfo(),
		Paths: PathsInfo{
			Config: TildePath(in.ConfigDir, home),
			Data:   TildePath(in.DataDir, home),
			Logs:   TildePath(in.LogDir, home),
		},
	}
	if bi, ok := debug.ReadBuildInfo(); ok {
		r.App.Commit, r.App.BuildDate, r.App.EngineVersion = FromBuildInfo(bi)
	}
	return r
}

// FromBuildInfo pulls the VCS commit, its time, and the engine module version from the build info.
func FromBuildInfo(bi *debug.BuildInfo) (commit, date, engine string) {
	modified := false
	for _, s := range bi.Settings {
		switch s.Key {
		case "vcs.revision":
			commit = s.Value
		case "vcs.time":
			date = s.Value
		case "vcs.modified":
			modified = s.Value == "true"
		}
	}
	if len(commit) > 12 {
		commit = commit[:12]
	}
	if commit != "" && modified {
		commit += "+dirty"
	}
	for _, d := range bi.Deps {
		if d.Path == "github.com/itsnotyoutoday/squatClientDaemon" {
			engine = d.Version
			if d.Replace != nil {
				engine += " (replaced by " + filepath.Base(d.Replace.Path) + ")"
			}
		}
	}
	return
}

// FormatTimezone renders "Europe/London (BST, UTC+01:00)".
func FormatTimezone(loc, abbr string, offsetSec int) string {
	sign := '+'
	if offsetSec < 0 {
		sign = '-'
		offsetSec = -offsetSec
	}
	utc := string(sign) + two(offsetSec/3600) + ":" + two(offsetSec%3600/60)
	if loc == "" || loc == "Local" {
		return abbr + ", UTC" + utc
	}
	return loc + " (" + abbr + ", UTC" + utc + ")"
}

func two(n int) string {
	if n < 10 {
		return "0" + string(rune('0'+n))
	}
	return string(rune('0'+n/10)) + string(rune('0'+n%10))
}

// TildePath replaces a leading home directory with "~" so reports do not carry the user name.
func TildePath(p, home string) string {
	if p == "" || home == "" {
		return p
	}
	sep := string(filepath.Separator)
	h := strings.TrimRight(home, sep)
	if p == h {
		return "~"
	}
	if strings.HasPrefix(p, h+sep) {
		return "~" + sep + p[len(h)+1:]
	}
	return p
}

// ParseOSRelease reads /etc/os-release content: PRETTY_NAME (or NAME VERSION) and the id.
func ParseOSRelease(s string) (pretty string) {
	kv := map[string]string{}
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		i := strings.IndexByte(line, '=')
		if line == "" || line[0] == '#' || i < 0 {
			continue
		}
		kv[line[:i]] = strings.Trim(line[i+1:], `"'`)
	}
	if v := kv["PRETTY_NAME"]; v != "" {
		return v
	}
	return strings.TrimSpace(kv["NAME"] + " " + kv["VERSION_ID"])
}

// ParseSwVers reads the output of `sw_vers`: name, version and build.
func ParseSwVers(s string) (name, version, build string) {
	for _, line := range strings.Split(s, "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		v = strings.TrimSpace(v)
		switch strings.TrimSpace(k) {
		case "ProductName":
			name = v
		case "ProductVersion":
			version = v
		case "BuildVersion":
			build = v
		}
	}
	return
}

// IsWSL reports whether /proc/version (or osrelease) text says this is Windows Subsystem for Linux.
func IsWSL(procVersion string) bool {
	l := strings.ToLower(procVersion)
	return strings.Contains(l, "microsoft") || strings.Contains(l, "wsl")
}

// WindowsVersionString renders major.minor.build[.ubr].
func WindowsVersionString(major, minor, build, ubr uint32) string {
	s := itoa(major) + "." + itoa(minor) + "." + itoa(build)
	if ubr != 0 {
		s += "." + itoa(ubr)
	}
	return s
}

// WindowsProductName fixes the registry's habit of calling Windows 11 "Windows 10 ...".
func WindowsProductName(name string, build uint32) string {
	if build >= 22000 && strings.HasPrefix(name, "Windows 10") {
		return "Windows 11" + strings.TrimPrefix(name, "Windows 10")
	}
	return name
}

func itoa(n uint32) string {
	if n == 0 {
		return "0"
	}
	var b [10]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func locale() string {
	for _, k := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return systemLocale()
}

func osUserHome() (string, error) { return os.UserHomeDir() }
