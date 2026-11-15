package main

import (
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/itsnotyoutoday/squatclient/internal/app"
	"github.com/itsnotyoutoday/squatclient/internal/dlog"
)

// The diagnostics log part of the UI contract (docs/DIAGNOSTICS.md); each method delegates to internal/app.Service. Nothing here uploads anything: the
// zip is saved on the user's disk and the issue form is opened in their browser.

// Build-time policy and project constants, set with -ldflags "-X main.name=value" (see the Makefile and the release workflow).
var (
	diagnosticsMode = "always"                     // always (alpha: on from the first start) | optin | off (compiled out)
	repoSlug        = "itsnotyoutoday/squatclient" // the GitHub repository issues are filed in
	contactName     = "Nveid"                      // who arranges another private way of delivering a log
	contactHost     = "startrekkin.net"            // ... on this game (a MUD: connect with SquatClient itself)
	contactPort     = "1701"
)

func diagSetup() app.DiagSetup {
	port := 0
	_, _ = fmt.Sscanf(contactPort, "%d", &port)
	return app.DiagSetup{Mode: diagnosticsMode, Build: buildCommit + " " + buildTime, Version: version, RepoSlug: repoSlug,
		ContactName: contactName, ContactHost: contactHost, ContactPort: port}
}

// DiagLogInfo describes the build's diagnostics policy and constants.
func (a *App) DiagLogInfo() (app.DiagInfo, error) {
	s, err := a.service()
	if err != nil {
		return app.DiagInfo{}, err
	}
	return s.DiagInfo(), nil
}

// DiagLogStatus lists the logging state and the sizes of the current and previous session.
func (a *App) DiagLogStatus() (app.DiagStatus, error) {
	s, err := a.service()
	if err != nil {
		return app.DiagStatus{}, err
	}
	return s.DiagStatus(), nil
}

// DiagLogSetEnabled is the dialog's on/off switch.
func (a *App) DiagLogSetEnabled(on bool) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.DiagSetEnabled(on)
}

// DiagLogClear deletes every diagnostics log.
func (a *App) DiagLogClear() error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.DiagClear()
}

// DiagLogView returns the last n lines of the current session that contain filter.
func (a *App) DiagLogView(n int, filter string) ([]string, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	return s.DiagView(n, filter)
}

// DiagLogLine is the page's way into the log (layer ui, web-audio, error, snapshot...).
func (a *App) DiagLogLine(layer, session, text string) {
	if s, err := a.service(); err == nil {
		s.DiagLogLine(layer, session, text)
	}
}

// DiagLogSnapshot writes a state snapshot now.
func (a *App) DiagLogSnapshot() {
	if s, err := a.service(); err == nil {
		s.DiagSnapshot("requested")
	}
}

// DiagLogSummary is the last few error lines (redacted), for the issue form.
func (a *App) DiagLogSummary() []string {
	if s, err := a.service(); err == nil {
		return s.DiagSummaryLines()
	}
	return nil
}

// DiagLogBuildZip builds the redacted zip: in the Downloads folder, or where the user chooses (saveAs). It returns the result with the full path.
func (a *App) DiagLogBuildZip(o app.DiagZipOptions, saveAs bool) (*dlog.ZipResult, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	if saveAs {
		a.mu.RLock()
		ctx := a.ctx
		a.mu.RUnlock()
		if ctx == nil {
			return nil, errors.New("window is not ready")
		}
		def := filepath.Join(app.DownloadsDir(""), "")
		path, err := wailsruntime.SaveFileDialog(ctx, wailsruntime.SaveDialogOptions{
			Title:            "Save the diagnostics zip",
			DefaultDirectory: def,
			DefaultFilename:  dlog.ZipName(buildCommit+" "+buildTime, time.Now()),
			Filters:          []wailsruntime.FileFilter{{DisplayName: "Zip (*.zip)", Pattern: "*.zip"}},
		})
		if err != nil || path == "" {
			return nil, err // "" with no error: the user cancelled
		}
		if !strings.HasSuffix(strings.ToLower(path), ".zip") {
			path += ".zip"
		}
		o.Dest = path
	}
	return s.DiagBuildZip(o)
}

// DiagLogReveal shows a saved zip in Finder / Explorer / the file manager.
func (a *App) DiagLogReveal(path string) error {
	if !strings.HasSuffix(strings.ToLower(path), ".zip") {
		return errors.New("not a diagnostics zip")
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	case "windows":
		cmd = exec.Command("explorer", "/select,"+path)
	default:
		cmd = exec.Command("xdg-open", filepath.Dir(path))
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

// DiagLogDeleteZip deletes a saved diagnostics zip (step 4 of the wizard).
func (a *App) DiagLogDeleteZip(path string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.DiagDeleteZip(path)
}

// DiagLogOpenURL opens the project's issue pages in the browser; any other address is refused.
func (a *App) DiagLogOpenURL(url string) error {
	if !strings.HasPrefix(url, "https://github.com/"+repoSlug+"/issues") {
		return errors.New("only the project's issue pages can be opened from here")
	}
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx == nil {
		return errors.New("window is not ready")
	}
	wailsruntime.BrowserOpenURL(ctx, url)
	if s, err := a.service(); err == nil {
		s.DiagLogLine("ui", "", "opened the GitHub issue form in the browser")
	}
	return nil
}
