package main

import (
	"errors"
	"path/filepath"

	"github.com/itsnotyoutoday/squatclient/internal/app"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// File methods for /upload (docs/APP.md "Upload"). ReadTextFile only reads a file the user chose in
// the picker or typed after /upload; failures come back inside the result.

// PickFile opens the native file dialog (text/code filters, starts in the last used folder) and
// returns the chosen path, or "" when the user cancelled.
func (a *App) PickFile(title string) (string, error) {
	svc, err := a.service()
	if err != nil {
		return "", err
	}
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx == nil {
		return "", errors.New("window is not ready")
	}
	if title == "" {
		title = "Choose a text file to upload"
	}
	path, err := wailsruntime.OpenFileDialog(ctx, wailsruntime.OpenDialogOptions{
		Title:            title,
		DefaultDirectory: svc.UploadFolder(),
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "Text and code (*.txt, *.mush, *.mu, *.tf, *.lua, *.md)", Pattern: "*.txt;*.mush;*.mu;*.tf;*.lua;*.md"},
			{DisplayName: "All files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil || path == "" {
		return "", err
	}
	svc.RememberUploadFolder(filepath.Dir(path))
	return path, nil
}

// ReadTextFile reads a text file (<= 5 MiB, no binary) for /upload.
func (a *App) ReadTextFile(path string) app.FileResult {
	svc, err := a.service()
	if err != nil {
		return app.FileResult{Path: path, Error: err.Error()}
	}
	return svc.ReadTextFile(path)
}
