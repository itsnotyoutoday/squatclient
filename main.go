package main

import (
	"embed"
	"log/slog"
	"os"
	"runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

	"github.com/itsnotyoutoday/squatclient/internal/config"
)

// The front end is built into frontend/dist (make build); a committed
// placeholder keeps this embed valid before the first build.
//
//go:embed all:frontend/dist
var assets embed.FS

const (
	appName = "SquatClient"
	version = "0.1.0"
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
		AssetServer:      &assetserver.Options{Assets: assets},
		Menu:             buildMenu(a),
		OnStartup:        a.startup,
		OnDomReady:       a.domReady,
		OnBeforeClose:    a.beforeClose,
		OnShutdown:       a.shutdown,
		Bind:             []interface{}{a},
		// Windows/Linux keep the native frame (ADR 0002); macOS uses an
		// integrated title bar below.
		Frameless: false,
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarHiddenInset(),
			Appearance:           mac.NSAppearanceNameDarkAqua,
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
