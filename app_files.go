package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/itsnotyoutoday/squatclient/internal/app"
	"github.com/itsnotyoutoday/squatclient/internal/config"
	"github.com/itsnotyoutoday/squatclient/internal/stdlib"

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

// ScriptFolders says where TinyFugue files are, for Settings > Scripts: the folder a relative /load starts in,
// the app-data folder (startup.tf, plugins, logs) and the two managed library folders.
type ScriptFolders struct {
	Scripts string `json:"scripts"` // the working / scripts folder in effect (restart to apply a change)
	AppData string `json:"appData"`
	Lib     string `json:"lib"`   // the shipped SquatClient library (managed: rewritten at every start)
	TFLib   string `json:"tfLib"` // the classic TinyFugue library (managed)
	Home    string `json:"home"`  // what ~ means
}

// ScriptFolders reports the folders in effect now.
func (a *App) ScriptFolders() (ScriptFolders, error) {
	svc, err := a.service()
	if err != nil {
		return ScriptFolders{}, err
	}
	_ = svc
	return a.scriptFolders(), nil
}

func (a *App) scriptFolders() ScriptFolders {
	wd, _ := os.Getwd()
	data := os.Getenv("SQUATCLIENT_SCRIPTS_DIR")
	if data == "" {
		data = os.Getenv("SQUATCLIENT_CONFIG_DIR")
	}
	if data == "" {
		data, _ = config.DefaultDir()
	}
	home, _ := os.UserHomeDir()
	return ScriptFolders{Scripts: wd, AppData: data,
		Lib: filepath.Join(data, filepath.FromSlash(stdlib.Dir)), TFLib: filepath.Join(data, filepath.FromSlash(stdlib.TFDir)), Home: home}
}

// PickFolder opens the native folder dialog and returns the chosen folder, or "" when cancelled.
func (a *App) PickFolder(title, start string) (string, error) {
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx == nil {
		return "", errors.New("window is not ready")
	}
	return wailsruntime.OpenDirectoryDialog(ctx, wailsruntime.OpenDialogOptions{
		Title: title, DefaultDirectory: config.ExpandPath(start), CanCreateDirectories: true,
	})
}

// OpenFolder shows a folder in the system file manager. Only a folder that exists is opened.
func (a *App) OpenFolder(path string) error {
	p := config.ExpandPath(path)
	if st, err := os.Stat(p); err != nil || !st.IsDir() {
		return fmt.Errorf("%s is not a folder", path)
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", p)
	case "windows":
		cmd = exec.Command("explorer", p)
	default:
		cmd = exec.Command("xdg-open", p)
	}
	return cmd.Start()
}
