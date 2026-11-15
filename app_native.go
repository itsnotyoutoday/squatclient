package main

import "sync"

// SetBadge shows the unread count on the app's icon: the Windows taskbar button gets a red number, the macOS Dock icon a
// badge. 0 clears it. There is nothing for it on Linux.
func (a *App) SetBadge(n int) { setBadge(n) }

// Notify shows a native desktop notification (Notification Center on macOS, a toast on Windows, the desktop's notification
// service on Linux). When it is clicked on macOS the window comes forward and the UI is told (event "notify-click") which
// session it was for.
func (a *App) Notify(title, body, session string) {
	notifyMu.Lock()
	notifyClick = a.emitNotifyClick
	notifyMu.Unlock()
	notify(title, body, session)
}

var (
	notifyMu    sync.Mutex
	notifyClick func(session string)
)

func clickedNotification(session string) {
	notifyMu.Lock()
	f := notifyClick
	notifyMu.Unlock()
	if f != nil {
		f(session)
	}
}
