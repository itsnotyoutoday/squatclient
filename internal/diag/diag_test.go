package diag

import (
	"encoding/json"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"testing"
)

func TestParseOSRelease(t *testing.T) {
	got := ParseOSRelease("NAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\n# c\nPRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\n")
	if got != "Ubuntu 24.04.1 LTS" {
		t.Fatal(got)
	}
	if got := ParseOSRelease("NAME=Alpine\nVERSION_ID=3.20\n"); got != "Alpine 3.20" {
		t.Fatal(got)
	}
	if ParseOSRelease("") != "" {
		t.Fatal("empty")
	}
}

func TestParseSwVers(t *testing.T) {
	n, v, b := ParseSwVers("ProductName:\t\tmacOS\nProductVersion:\t\t15.1\nBuildVersion:\t\t24B83\n")
	if n != "macOS" || v != "15.1" || b != "24B83" {
		t.Fatal(n, v, b)
	}
}

func TestIsWSL(t *testing.T) {
	if !IsWSL("Linux version 5.15.153.1-microsoft-standard-WSL2") || IsWSL("Linux version 6.8.0-generic") {
		t.Fatal("wsl detection")
	}
}

func TestWindowsHelpers(t *testing.T) {
	if got := WindowsVersionString(10, 0, 22631, 3007); got != "10.0.22631.3007" {
		t.Fatal(got)
	}
	if got := WindowsVersionString(10, 0, 19045, 0); got != "10.0.19045" {
		t.Fatal(got)
	}
	if got := WindowsProductName("Windows 10 Pro", 22631); got != "Windows 11 Pro" {
		t.Fatal(got)
	}
	if got := WindowsProductName("Windows 10 Pro", 19045); got != "Windows 10 Pro" {
		t.Fatal(got)
	}
}

func TestTildePath(t *testing.T) {
	home := filepath.Join(string(filepath.Separator), "home", "ann")
	if got := TildePath(filepath.Join(home, ".config", "SquatClient"), home); got != filepath.Join("~", ".config", "SquatClient") {
		t.Fatal(got)
	}
	if TildePath(home, home) != "~" {
		t.Fatal("home itself")
	}
	other := filepath.Join(string(filepath.Separator), "home", "annabel", "x")
	if TildePath(other, home) != other {
		t.Fatal("prefix of a longer name must not match")
	}
	if TildePath("", home) != "" || TildePath("/x", "") != "/x" {
		t.Fatal("empty")
	}
}

func TestFormatTimezone(t *testing.T) {
	if got := FormatTimezone("Europe/London", "BST", 3600); got != "Europe/London (BST, UTC+01:00)" {
		t.Fatal(got)
	}
	if got := FormatTimezone("Local", "IST", -(5*3600 + 1800)); got != "IST, UTC-05:30" {
		t.Fatal(got)
	}
}

func TestFromBuildInfo(t *testing.T) {
	c, d, e := FromBuildInfo(&debug.BuildInfo{
		Settings: []debug.BuildSetting{{Key: "vcs.revision", Value: "0123456789abcdef"}, {Key: "vcs.time", Value: "2026-01-02T03:04:05Z"}, {Key: "vcs.modified", Value: "true"}},
		Deps:     []*debug.Module{{Path: "github.com/itsnotyoutoday/squatClientDaemon", Version: "v0.3.0", Replace: &debug.Module{Path: "../squatClientDaemon"}}},
	})
	if c != "0123456789ab+dirty" || d != "2026-01-02T03:04:05Z" || e != "v0.3.0 (replaced by squatClientDaemon)" {
		t.Fatal(c, d, e)
	}
}

func TestCollect(t *testing.T) {
	home, _ := osUserHome()
	r := Collect(Input{Version: "1.2.3", ConfigDir: filepath.Join(home, "cfg"), DataDir: filepath.Join(home, "cfg"), LogDir: filepath.Join(home, "cfg", "logs")})
	if r.App.Version != "1.2.3" || r.App.SWPVersion < 1 {
		t.Fatalf("%+v", r.App)
	}
	if r.Platform.OS != runtime.GOOS || r.Platform.Arch != runtime.GOARCH || r.Platform.NumCPU < 1 || r.Platform.GoVersion == "" || r.Platform.Timezone == "" {
		t.Fatalf("%+v", r.Platform)
	}
	if r.WebView.Engine == "" {
		t.Fatal("engine kind")
	}
	if home != "" && !strings.HasPrefix(r.Paths.Config, "~") {
		t.Fatalf("home not replaced: %q", r.Paths.Config)
	}
	b, err := json.Marshal(r)
	if err != nil || strings.Contains(strings.ToLower(string(b)), "password") {
		t.Fatal("report must marshal and carry no secrets")
	}
}
