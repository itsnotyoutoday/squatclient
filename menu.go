package main

import (
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
)

// buildMenu returns the native application menu. Items that need UI work emit
// a `menu` event {action} which the front end handles.
func buildMenu(a *App) *menu.Menu {
	act := func(name string) menu.Callback {
		return func(*menu.CallbackData) { a.emitMenu(name) }
	}
	m := menu.NewMenu()
	m.Append(menu.AppMenu()) // About, Hide, Quit (Cmd-Q)

	session := m.AddSubmenu("Session")
	session.AddText("New Connection...", keys.CmdOrCtrl("n"), act("quick-connect"))
	session.AddText("Worlds...", keys.CmdOrCtrl("o"), act("worlds"))
	session.AddText("Settings...", keys.CmdOrCtrl(","), act("settings"))
	session.AddSeparator()
	session.AddText("Close Session", keys.CmdOrCtrl("w"), func(*menu.CallbackData) { a.closeSession() })

	m.Append(menu.EditMenu()) // Undo/Redo, Cut, Copy, Paste, Select All
	view := m.AddSubmenu("View")
	view.AddText("Find...", nil, act("search"))
	m.Append(menu.WindowMenu()) // Minimize, Zoom, Full Screen, ...
	help := m.AddSubmenu("Help")
	help.AddText("SquatClient Help", nil, act("help"))
	return m
}
