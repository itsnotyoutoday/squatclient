// Package desktop talks to a Linux desktop over D-Bus, with the freedesktop standards every desktop environment implements, so
// one code path serves GNOME, KDE Plasma, XFCE, Cinnamon, MATE and the tiling-window-manager setups (dunst, mako, ...):
//
//   - notifications: org.freedesktop.Notifications (a click comes back as an ActionInvoked signal),
//   - the unread count on the launcher icon: com.canonical.Unity.LauncherEntry (KDE, the Ubuntu dock, Dash to Dock, Plank),
//   - the colour scheme and contrast preference: the org.freedesktop.portal.Settings "appearance" keys.
//
// Everything degrades quietly: no session bus, no notification daemon or no launcher that listens is not an error, it just means
// that feature is not there. The code is plain Go (no cgo) and speaks to the bus through a small interface, so it is tested
// without a desktop.
package desktop

import (
	"html"
	"strings"
	"sync"
)

// Bus is what the package needs from a D-Bus connection (a fake in the tests, godbus in the app).
type Bus interface {
	// Call calls a method on the session bus and returns its results.
	Call(dest, path, iface, method string, args ...any) ([]any, error)
	// Emit sends a signal.
	Emit(path, iface, name string, args ...any) error
}

// Desktop is one app's view of the desktop.
type Desktop struct {
	bus    Bus
	app    string // the .desktop file id without ".desktop" (the icon, the name and the grouping come from it)
	onOpen func(session string)

	mu      sync.Mutex
	caps    map[string]bool // what the notification daemon can do; nil = not asked yet
	byID    map[uint32]string
	bySess  map[string]uint32
	hasDaem bool
}

// New makes a Desktop for the app with the given desktop-entry id (for example "squatclient"). onOpen is called with the session
// when a notification is clicked.
func New(bus Bus, appID string, onOpen func(session string)) *Desktop {
	return &Desktop{bus: bus, app: appID, onOpen: onOpen, byID: map[uint32]string{}, bySess: map[string]uint32{}}
}

const (
	notifDest  = "org.freedesktop.Notifications"
	notifPath  = "/org/freedesktop/Notifications"
	notifIface = "org.freedesktop.Notifications"
)

// capabilities asks the daemon once what it supports.
func (d *Desktop) capabilities() map[string]bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.caps != nil {
		return d.caps
	}
	d.caps = map[string]bool{}
	res, err := d.bus.Call(notifDest, notifPath, notifIface, "GetCapabilities")
	if err != nil || len(res) == 0 {
		return d.caps
	}
	d.hasDaem = true
	if list, ok := res[0].([]string); ok {
		for _, c := range list {
			d.caps[c] = true
		}
	}
	return d.caps
}

// Notify shows a notification. A world that already has one showing replaces it instead of stacking another. It reports whether a
// notification daemon took it.
func (d *Desktop) Notify(title, body, session string) bool {
	caps := d.capabilities()
	if !d.hasDaemon() {
		return false
	}
	if caps["body-markup"] { // the text is a line from a game: it must not be read as markup
		title, body = html.EscapeString(title), html.EscapeString(body)
	}
	if !caps["body"] { // a daemon with no body shows only the summary
		title, body = strings.TrimSpace(title+": "+body), ""
	}
	actions := []string{}
	if caps["actions"] {
		actions = []string{"default", "Show"} // "default" is what a click on the notification itself sends
	}
	hints := map[string]any{"desktop-entry": d.app, "category": "im.received", "x-canonical-append": "false"}
	d.mu.Lock()
	replaces := d.bySess[session]
	d.mu.Unlock()
	res, err := d.bus.Call(notifDest, notifPath, notifIface, "Notify", "SquatClient", replaces, d.app, title, body, actions, hints, int32(-1))
	if err != nil || len(res) == 0 {
		return false
	}
	if id, ok := res[0].(uint32); ok && session != "" {
		d.mu.Lock()
		d.byID[id], d.bySess[session] = session, id
		d.mu.Unlock()
	}
	return true
}

func (d *Desktop) hasDaemon() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.hasDaem
}

// ActionInvoked is the daemon's signal that a notification (or one of its buttons) was clicked.
func (d *Desktop) ActionInvoked(id uint32, _ string) {
	d.mu.Lock()
	session := d.byID[id]
	d.mu.Unlock()
	if session != "" && d.onOpen != nil {
		d.onOpen(session)
	}
}

// NotificationClosed forgets a notification that went away.
func (d *Desktop) NotificationClosed(id uint32) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if s, ok := d.byID[id]; ok {
		delete(d.byID, id)
		if d.bySess[s] == id {
			delete(d.bySess, s)
		}
	}
}

// Badge puts the unread count on the launcher entry (0 clears it). Launchers that do not listen simply ignore it.
func (d *Desktop) Badge(n int) error {
	props := map[string]any{"count": int64(n), "count-visible": n > 0}
	return d.bus.Emit("/com/canonical/unity/launcherentry/1", "com.canonical.Unity.LauncherEntry", "Update", "application://"+d.app+".desktop", props)
}

// Look is the desktop's appearance preference.
type Look struct {
	Dark         bool `json:"dark"`
	HighContrast bool `json:"highContrast"`
	Known        bool `json:"known"` // the desktop said anything about it
}

const (
	portalDest  = "org.freedesktop.portal.Desktop"
	portalPath  = "/org/freedesktop/portal/desktop"
	portalIface = "org.freedesktop.portal.Settings"
)

// unwrap strips the variants D-Bus nests around a value (the portal's Read answers a variant inside a variant).
func unwrap(v any) any {
	for {
		w, ok := v.(interface{ Value() any })
		if !ok {
			return v
		}
		v = w.Value()
	}
}

// Appearance reads the colour scheme (0 = no preference, 1 = dark, 2 = light) and the contrast preference (1 = more).
func (d *Desktop) Appearance() Look {
	var l Look
	read := func(key string) (uint32, bool) {
		res, err := d.bus.Call(portalDest, portalPath, portalIface, "Read", "org.freedesktop.appearance", key)
		if err != nil || len(res) == 0 {
			return 0, false
		}
		n, ok := unwrap(res[0]).(uint32)
		return n, ok
	}
	if n, ok := read("color-scheme"); ok {
		l.Known, l.Dark = true, n == 1
	}
	if n, ok := read("contrast"); ok {
		l.Known, l.HighContrast = true, n == 1
	}
	return l
}

// Setting applies one SettingChanged signal of the portal to a Look; it reports whether the look changed.
func Setting(l *Look, namespace, key string, value any) bool {
	if namespace != "org.freedesktop.appearance" {
		return false
	}
	n, ok := unwrap(value).(uint32)
	if !ok {
		return false
	}
	switch key {
	case "color-scheme":
		l.Known, l.Dark = true, n == 1
	case "contrast":
		l.Known, l.HighContrast = true, n == 1
	default:
		return false
	}
	return true
}
