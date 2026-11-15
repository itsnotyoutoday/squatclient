package main

import (
	"embed"
	"log/slog"
	"net/http"
	"os"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

	"github.com/itsnotyoutoday/squatclient/internal/config"
)

// The front end is built into frontend/dist (make build); a committed
// placeholder keeps this embed valid before the first build.
//
//go:embed all:frontend/dist
var assets embed.FS

// the build stamp, set by the Makefile with -ldflags (git commit, dirty flag and build time)
var (
	buildCommit = "unknown"
	buildTime   = "unknown"
	version     = "0.1.0" // the release workflow sets it with -X main.version=...
)

// The window icon on Linux (Windows and macOS take theirs from the executable and the app bundle,
// which are built from the same file).
//
//go:embed build/appicon.png
var appIcon []byte

const (
	appName = "SquatClient"
	// bg matches --bg in frontend/src/styles/app.css (no white flash on start).
	bgR, bgG, bgB = 20, 22, 26
)

func main() {
	a := NewApp()

	width, height := 1100, 720
	if dir, err := config.DefaultDir(); err == nil {
		if d := os.Getenv("SQUATCLIENT_CONFIG_DIR"); d != "" {
			dir = d
		}
		if st, err := config.Open(dir); err == nil {
			if w := st.Window(); w.Valid && w.Width >= 700 && w.Height >= 420 {
				width, height = w.Width, w.Height
			}
		}
	}

	err := wails.Run(&options.App{
		Title:            appName,
		Width:            width,
		Height:           height,
		MinWidth:         700,
		MinHeight:        420,
		BackgroundColour: &options.RGBA{R: bgR, G: bgG, B: bgB, A: 255},
		AssetServer: &assetserver.Options{Assets: assets, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/cmcp-audio/") { // sound bytes come from the Go side, never from the game (cmcp spec 8, 9)
				if svc, err := a.service(); err == nil {
					svc.AudioHandler().ServeHTTP(w, r)
					return
				}
			}
			http.NotFound(w, r)
		})},
		Menu:          buildMenu(a),
		OnStartup:     a.startup,
		OnDomReady:    a.domReady,
		OnBeforeClose: a.beforeClose,
		OnShutdown:    a.shutdown,
		Bind:          []interface{}{a},
		// Windows/Linux keep the native frame (ADR 0002); macOS uses an
		// integrated title bar below.
		Frameless: false,
		Linux:     &linux.Options{Icon: appIcon, ProgramName: "squatclient"},
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
			// no forced appearance: the window follows the system, and so does the page's prefers-color-scheme (the "Follow the system" theme)
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			// no native About panel: the About item opens the page's own dialog (menu_darwin.m)
		},
	})
	if err != nil {
		slog.Error("wails", "err", err, "os", runtime.GOOS)
		os.Exit(1)
	}
}
