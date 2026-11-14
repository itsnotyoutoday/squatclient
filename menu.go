package main

import (
	"runtime"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// buildMenu returns the native application menu. Items that need UI work emit a `menu` event
// {action} which the front end handles. The layout follows each platform's conventions:
//
//	macOS:           SquatClient (About, Settings..., Hide, Quit) | Session | Edit | View | Window | Help (About is
//	                 in the application menu, as on every Mac)
//	Windows, Linux:  none here: the in-window menu bar (File | Edit | View | Help, with About under Help)
//
// "Settings..." is the application's global settings; "Connection Settings..." is about the
// connection in the foreground tab.
func buildMenu(a *App) *menu.Menu {
	act := func(name string) menu.Callback {
		return func(*menu.CallbackData) { a.emitMenu(name) }
	}
	suspend := func(*menu.CallbackData) { a.report(a.suspendErr()) }
	resume := func(*menu.CallbackData) { go func() { a.report(a.Resume()) }() }
	closeSession := func(*menu.CallbackData) { a.closeSession() }

	m := menu.NewMenu()
	if runtime.GOOS == "darwin" {
		m.Append(menu.AppMenu()) // About, Hide, Quit (Cmd-Q); "Settings..." (Cmd-,) is added natively, see menu_darwin.m

		session := m.AddSubmenu("Session")
		session.AddText("New Connection...", keys.CmdOrCtrl("n"), act("quick-connect"))
		session.AddText("Worlds...", keys.CmdOrCtrl("o"), act("worlds"))
		session.AddText("Connection Settings...", keys.CmdOrCtrl("i"), act("session-settings"))
		session.AddSeparator()
		session.AddText("Suspend (detach from squatters)", keys.Combo("d", keys.CmdOrCtrlKey, keys.ShiftKey), suspend)
		session.AddText("Resume", keys.Combo("r", keys.CmdOrCtrlKey, keys.ShiftKey), resume)
		session.AddSeparator()
		session.AddText("Close Session", keys.CmdOrCtrl("w"), closeSession)

		m.Append(menu.EditMenu()) // Undo/Redo, Cut, Copy, Paste, Select All
		view := m.AddSubmenu("View")
		view.AddText("Find...", nil, act("search"))
		view.AddText("Object Editor", nil, act("editor")) // Cmd-E is handled by the page
		view.AddText("Layouts...", nil, act("layouts"))
		m.Append(menu.WindowMenu()) // Minimize, Zoom, Full Screen, ...
		help := m.AddSubmenu("Help")
		help.AddText("SquatClient Help", nil, act("help"))
		return m
	}

	// Windows and Linux: no native menu. The page draws its own menu bar (frontend/src/components/menu),
	// styled for the platform, so it looks the same everywhere and is testable.
	return nil
}

// Quit closes the application (File > Exit in the in-window menu on Windows and Linux).
func (a *App) Quit() {
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx != nil {
		wailsruntime.Quit(ctx)
	}
}
