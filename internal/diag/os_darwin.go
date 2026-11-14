//go:build darwin

package diag

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

func run(name string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func osInfo() (name, version string, notes []string) {
	n, v, b := ParseSwVers(run("sw_vers"))
	if n == "" {
		n = "macOS"
	}
	if v != "" && b != "" {
		v += " (" + b + ")"
	}
	if run("sysctl", "-n", "sysctl.proc_translated") == "1" {
		notes = append(notes, "running under Rosetta 2")
	}
	return n, v, notes
}

func systemLocale() string { return run("defaults", "read", "-g", "AppleLocale") }

func webViewInfo() WebViewInfo {
	w := WebViewInfo{Engine: "WKWebView"}
	w.Version = run("defaults", "read", "/System/Library/Frameworks/WebKit.framework/Resources/Info", "CFBundleVersion")
	if w.Version == "" {
		w.Note = "system WebKit; its version follows the macOS version (see navigator.userAgent)"
	}
	return w
}
