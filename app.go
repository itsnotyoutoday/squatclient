package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/proto"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/itsnotyoutoday/squatclient/internal/app"
	"github.com/itsnotyoutoday/squatclient/internal/config"
	"github.com/itsnotyoutoday/squatclient/internal/secrets"
)

// App is bound to the front end as window.go.main.App.<Name>. Every method is a
// thin delegation to internal/app.Service (docs/UI-CONTRACT.md,
// docs/UI-CONTRACT-NOTES.md); arguments are positional.
type App struct {
	mu      sync.RWMutex
	ctx     context.Context
	svc     *app.Service
	cfg     *config.Store
	initErr error
}

// NewApp creates the App; the service is built in startup.
func NewApp() *App { return &App{} }

var errNotReady = errors.New("SquatClient failed to start")

func (a *App) service() (*app.Service, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.svc == nil {
		if a.initErr != nil {
			return nil, fmt.Errorf("%w: %v", errNotReady, a.initErr)
		}
		return nil, errNotReady
	}
	return a.svc, nil
}

// startup is called by Wails before the front end loads.
func (a *App) startup(ctx context.Context) {
	svc, cfg, err := a.build(ctx)
	a.mu.Lock()
	a.ctx, a.svc, a.cfg, a.initErr = ctx, svc, cfg, err
	a.mu.Unlock()
	fixEditMenu(a.emitMenu) // macOS: let Cmd+Z / Shift+Cmd+Z reach the code editor
	if err != nil {
		slog.Error("startup failed", "err", err)
		return
	}
	svc.Start()
}

func (a *App) build(ctx context.Context) (*app.Service, *config.Store, error) {
	dir := os.Getenv("SQUATCLIENT_CONFIG_DIR")
	if dir == "" {
		d, err := config.DefaultDir()
		if err != nil {
			return nil, nil, err
		}
		dir = d
	}
	cfg, err := config.Open(dir)
	if err != nil {
		return nil, nil, err
	}
	scripts := os.Getenv("SQUATCLIENT_SCRIPTS_DIR")
	if scripts == "" {
		scripts = dir
	}
	svc, err := app.New(app.Options{
		Config:  cfg,
		Secrets: secrets.Keychain{},
		Emit:    func(name string, payload any) { wailsruntime.EventsEmit(ctx, name, payload) },
		OnQuit:  func() { wailsruntime.Quit(ctx) },
		OnWindow: func(action string) {
			if action == "minimise" { // /suspend: hide the window, the squatter keeps the sessions
				wailsruntime.WindowMinimise(ctx)
			}
		},
		Engine: engine.Options{
			ConfigDir: scripts, // startup.tf, plugins/*.lua, logs/
			Version:   version,
		},
	})
	return svc, cfg, err
}

// shutdown is called by Wails on exit: close every session gracefully.
func (a *App) shutdown(context.Context) {
	if svc, err := a.service(); err == nil {
		svc.Shutdown()
	}
}

// beforeClose remembers the window geometry; it never prevents closing.
func (a *App) beforeClose(ctx context.Context) bool {
	a.saveWindow(ctx)
	return false
}

func (a *App) saveWindow(ctx context.Context) {
	svc, err := a.service()
	if err != nil {
		return
	}
	w, h := wailsruntime.WindowGetSize(ctx)
	x, y := wailsruntime.WindowGetPosition(ctx)
	if err := svc.SaveWindow(config.Window{X: x, Y: y, Width: w, Height: h, Maximised: wailsruntime.WindowIsMaximised(ctx)}); err != nil {
		slog.Warn("save window state", "err", err)
	}
}

// domReady restores the window position (size is applied at creation).
func (a *App) domReady(ctx context.Context) {
	fixEditMenu(a.emitMenu) // the native menu exists by now; this is safe to repeat
	svc, err := a.service()
	if err != nil {
		return
	}
	w := svc.Window()
	if !w.Valid {
		return
	}
	if onAnyScreen(ctx, w) {
		wailsruntime.WindowSetPosition(ctx, w.X, w.Y)
	}
	if w.Maximised {
		wailsruntime.WindowMaximise(ctx)
	}
}

func onAnyScreen(ctx context.Context, w config.Window) bool {
	screens, err := wailsruntime.ScreenGetAll(ctx)
	if err != nil || len(screens) == 0 {
		return true
	}
	for _, s := range screens {
		if w.X+64 > 0 && w.X < s.Size.Width*4 && w.Y >= 0 && w.Y < s.Size.Height*4 {
			return true
		}
	}
	return false
}

// emitMenu tells the UI a native menu item was chosen.
func (a *App) emitMenu(action string) {
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx != nil {
		wailsruntime.EventsEmit(ctx, "menu", map[string]string{"action": action})
	}
}

// closeSession (Cmd-W): close the foreground session via the UI, or quit when
// there is none.
func (a *App) closeSession() {
	svc, err := a.service()
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if err == nil {
		if l, _ := svc.ListSessions(); len(l) > 0 {
			a.emitMenu("close-session")
			return
		}
	}
	if ctx != nil {
		wailsruntime.Quit(ctx)
	}
}

// ---- bound methods (names are part of the UI contract) ------------------------

// ListWorlds returns the configured worlds.
func (a *App) ListWorlds() ([]config.World, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	return s.ListWorlds()
}

// SaveWorld creates or updates a world.
func (a *App) SaveWorld(w config.World) (config.World, error) {
	s, err := a.service()
	if err != nil {
		return config.World{}, err
	}
	return s.SaveWorld(w)
}

// DeleteWorld removes a world.
func (a *App) DeleteWorld(id string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.DeleteWorld(id)
}

// SetWorldPassword stores a world's password in the OS keychain.
func (a *App) SetWorldPassword(id, password string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.SetWorldPassword(id, password)
}

// GetSettings returns the settings.
func (a *App) GetSettings() (config.Settings, error) {
	s, err := a.service()
	if err != nil {
		return config.Settings{}, err
	}
	return s.GetSettings()
}

// SaveSettings persists the settings.
func (a *App) SaveSettings(st config.Settings) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.SaveSettings(st)
}

// ListSquatters returns the stored squatters with their connection state.
func (a *App) ListSquatters() ([]app.SquatterView, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	return s.ListSquatters()
}

// PairSquatter reads the squatter's TLS fingerprint (no pairing code is sent yet). kind is
// "squatterd" (default) or "tf-squatterd".
func (a *App) PairSquatter(host string, port int, name, pairCode, kind string) (app.PairResult, error) {
	s, err := a.service()
	if err != nil {
		return app.PairResult{}, err
	}
	return s.PairSquatter(host, port, name, pairCode, kind)
}

// ConfirmSquatter trusts (accept) or drops the fingerprint and pairs.
func (a *App) ConfirmSquatter(id string, accept bool) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.ConfirmSquatter(id, accept)
}

// RemoveSquatter removes a stored squatter.
func (a *App) RemoveSquatter(id string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.RemoveSquatter(id)
}

// ReconnectSquatter reconnects a squatter on the user's request.
func (a *App) ReconnectSquatter(id string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.ReconnectSquatter(id)
}

// Suspend detaches from the squatters and minimises the window (/suspend).
func (a *App) Suspend() (int, error) {
	s, err := a.service()
	if err != nil {
		return 0, err
	}
	return s.Suspend(), nil
}

// Resume re-attaches suspended squatter sessions and replays what was missed.
func (a *App) Resume() error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.Resume()
}

// Connect opens a session.
func (a *App) Connect(t app.ConnectTarget) (engine.SessionInfo, error) {
	s, err := a.service()
	if err != nil {
		return engine.SessionInfo{}, err
	}
	return s.Connect(t)
}

// Disconnect closes a session's connection.
func (a *App) Disconnect(id string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.Disconnect(id)
}

// Dismiss removes a session.
func (a *App) Dismiss(id string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.Dismiss(id)
}

// ListSessions returns all sessions.
func (a *App) ListSessions() ([]engine.SessionInfo, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	return s.ListSessions()
}

// Foreground selects the foreground session.
func (a *App) Foreground(id string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.Foreground(id)
}

// Input sends a line of user input to the engine.
func (a *App) Input(id, text string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.Input(id, text)
}

// Resize reports the output size.
func (a *App) Resize(id string, cols, rows int) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.Resize(id, cols, rows)
}

// Scrollback returns older lines.
func (a *App) Scrollback(id string, opts app.ScrollbackOpts) ([]proto.Line, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	return s.Scrollback(id, opts)
}

// RecordHistory remembers one input (a block is one entry); see app.Service.RecordHistory.
func (a *App) RecordHistory(id, text string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.RecordHistory(id, text)
}

// History returns the world's command history, newest first.
func (a *App) History(id, query string, opts app.HistoryOpts) (app.HistoryPage, error) {
	s, err := a.service()
	if err != nil {
		return app.HistoryPage{Entries: []app.HistoryEntry{}}, err
	}
	return s.History(id, query, opts)
}

// DeleteHistory removes one history entry.
func (a *App) DeleteHistory(id string, entryID uint64) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.DeleteHistory(id, entryID)
}

// ClearHistory removes the world's whole command history.
func (a *App) ClearHistory(id string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.ClearHistory(id)
}

// Search searches a session's history.
func (a *App) Search(id, query string, opts app.SearchOpts) ([]engine.Hit, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	return s.Search(id, query, opts)
}

// Ack marks lines up to seq as seen.
func (a *App) Ack(id string, seq uint64) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.Ack(id, seq)
}

func (a *App) suspendErr() error {
	_, err := a.Suspend()
	return err
}

// report shows an error from a menu action as an error notice in the UI.
func (a *App) report(err error) {
	if err == nil {
		return
	}
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx != nil {
		wailsruntime.EventsEmit(ctx, "notice", map[string]string{"level": "error", "text": err.Error()})
	}
}
