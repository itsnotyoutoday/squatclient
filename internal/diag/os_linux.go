//go:build linux

package diag

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
)

func osInfo() (name, version string, notes []string) {
	b, _ := os.ReadFile("/etc/os-release")
	name = ParseOSRelease(string(b))
	if name == "" {
		name = "Linux"
	}
	var u syscall.Utsname
	if syscall.Uname(&u) == nil {
		version = "kernel " + cstr(u.Release[:])
	}
	if pv, err := os.ReadFile("/proc/version"); err == nil && IsWSL(string(pv)) {
		notes = append(notes, "running under WSL")
	}
	if os.Getenv("WAYLAND_DISPLAY") != "" {
		notes = append(notes, "Wayland session")
	} else if os.Getenv("DISPLAY") != "" {
		notes = append(notes, "X11 session")
	}
	if os.Getenv("FLATPAK_ID") != "" || fileExists("/.flatpak-info") {
		notes = append(notes, "Flatpak")
	}
	if os.Getenv("APPIMAGE") != "" {
		notes = append(notes, "AppImage")
	}
	return
}

func cstr[T ~int8 | ~uint8](a []T) string {
	var sb strings.Builder
	for _, c := range a {
		if c == 0 {
			break
		}
		sb.WriteByte(byte(c))
	}
	return sb.String()
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func systemLocale() string { return "" }

func webViewInfo() WebViewInfo {
	w := WebViewInfo{Engine: "WebKitGTK"}
	for _, pkg := range []string{"webkit2gtk-4.1", "webkit2gtk-4.0"} {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		out, err := exec.CommandContext(ctx, "pkg-config", "--modversion", pkg).Output()
		cancel()
		if v := strings.TrimSpace(string(out)); err == nil && v != "" {
			w.Version = v + " (" + pkg + ")"
			return w
		}
	}
	// no pkg-config (usual on a user's machine): the library file name carries the soname version
	for _, dir := range []string{"/usr/lib", "/usr/lib64", "/usr/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu", "/usr/lib/arm-linux-gnueabihf"} {
		m, _ := filepath.Glob(filepath.Join(dir, "libwebkit2gtk-4.*.so.*"))
		sort.Strings(m)
		if len(m) > 0 {
			w.Version = filepath.Base(m[len(m)-1])
			w.Note = "library file name; the release version needs pkg-config"
			return w
		}
	}
	w.Note = "WebKitGTK version not found"
	return w
}
