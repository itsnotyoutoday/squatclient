//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa
#include "menu_darwin.h"
*/
import "C"

import "sync"

var (
	editMu   sync.Mutex
	editHook func(action string)
)

//export goEditAction
func goEditAction(action C.int) {
	editMu.Lock()
	h := editHook
	editMu.Unlock()
	if h == nil {
		return
	}
	switch action {
	case 0:
		h("undo")
	case 1:
		h("redo")
	case 2:
		h("settings") // the application menu's Settings... item
	case 3:
		h("about") // the application menu's About item
	}
}

// fixEditMenu stops the native Edit menu from claiming Cmd+Z / Shift+Cmd+Z (WebKit's own undo
// does not know about the code editor's history, so the keys did nothing or undid something
// unrelated). The keys now reach the page; clicking the menu items routes through h.
func fixEditMenu(h func(action string)) {
	editMu.Lock()
	editHook = h
	editMu.Unlock()
	C.squatFixEditMenu()
}
