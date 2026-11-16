//go:build linux

package main

import (
	"log/slog"
	"os/exec"
	"sync"

	"github.com/itsnotyoutoday/squatclient/internal/desktop"
)

// desktopID is the .desktop file the app installs (build/linux/squatclient.desktop): the icon, the name and the launcher badge
// all hang off it.
const desktopID = "squatclient"

var (
	deskOnce sync.Once
	desk     *desktop.Desktop
)

// linuxDesk connects to the session bus once. nil = no bus (a headless box): every feature then does nothing.
func linuxDesk() *desktop.Desktop { return startDesk(nil) }

func startDesk(onLook func(desktop.Look)) *desktop.Desktop {
	deskOnce.Do(func() {
		bus, err := desktop.Connect()
		if err != nil {
			slog.Info("no D-Bus session bus: desktop notifications, badge and appearance are off", "err", err)
			return
		}
		desk = desktop.New(bus, desktopID, clickedNotification)
		bus.Watch(desk, onLook)
		if onLook != nil {
			if l := desk.Appearance(); l.Known {
				onLook(l)
			}
		}
	})
	return desk
}

// startDesktop starts listening to the desktop: notification clicks. The window does NOT follow the desktop's colour scheme
// or contrast preference; it uses the theme the player picked (see Settings.migrate).
func startDesktop(func(string, any)) { startDesk(nil) }

// setBadge shows the unread count on the launcher entry (KDE, the Ubuntu dock, Dash to Dock, Plank; others ignore it).
func setBadge(n int) {
	if d := linuxDesk(); d != nil {
		_ = d.Badge(n)
	}
}

// notify shows a desktop notification through the freedesktop notification service; with no service answering, notify-send.
func notify(title, body, session string) {
	if d := linuxDesk(); d != nil && d.Notify(title, body, session) {
		return
	}
	if p, err := exec.LookPath("notify-send"); err == nil {
		_ = exec.Command(p, "--app-name=SquatClient", title, body).Start()
	}
}
