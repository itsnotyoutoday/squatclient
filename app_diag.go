package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/itsnotyoutoday/squatclient/internal/config"
	"github.com/itsnotyoutoday/squatclient/internal/diag"
)

// Diagnostics returns the platform facts for Help > Diagnostics (the page adds what only it can
// see: web view, display, rendering checks, settings, sessions, recent problems).
func (a *App) Diagnostics() diag.Report {
	dir := os.Getenv("SQUATCLIENT_CONFIG_DIR")
	if dir == "" {
		dir, _ = config.DefaultDir()
	}
	data := os.Getenv("SQUATCLIENT_SCRIPTS_DIR")
	if data == "" {
		data = dir
	}
	in := diag.Input{Version: version, ConfigDir: dir, DataDir: data, LogDir: filepath.Join(data, "logs")}
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx != nil {
		in.BuildType = wailsruntime.Environment(ctx).BuildType
	}
	return diag.Collect(in)
}

// SaveTextFile asks where to save a report and writes it; it returns the path, or "" when the user cancelled.
func (a *App) SaveTextFile(defaultName, text string) (string, error) {
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx == nil {
		return "", errors.New("window is not ready")
	}
	path, err := wailsruntime.SaveFileDialog(ctx, wailsruntime.SaveDialogOptions{
		Title:           "Save diagnostics",
		DefaultFilename: defaultName,
		Filters:         []wailsruntime.FileFilter{{DisplayName: "Text (*.txt)", Pattern: "*.txt"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.Contains(filepath.Base(path), ".") {
		path += ".txt"
	}
	return path, os.WriteFile(path, []byte(text), 0o644)
}

// CopyText puts text on the clipboard through the native API (the web view may refuse its own).
func (a *App) CopyText(text string) error {
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx == nil {
		return errors.New("window is not ready")
	}
	return wailsruntime.ClipboardSetText(ctx, text)
}
