//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa -framework UserNotifications
#include <stdlib.h>
#include "native_darwin.h"
*/
import "C"

import (
	"os/exec"
	"unsafe"
)

func setBadge(n int) { C.squatSetBadge(C.int(n)) }

//export goNotifyClicked
func goNotifyClicked(session *C.char) { clickedNotification(C.GoString(session)) }

// notify posts a Notification Center banner. User notifications need an app bundle; a bare binary (go run, wails dev) falls back to
// a plain osascript notification, which cannot report clicks.
func notify(title, body, session string) {
	if C.squatHaveBundle() == 0 {
		script := `on run argv
display notification (item 2 of argv) with title (item 1 of argv)
end run`
		_ = exec.Command("osascript", "-e", script, title, body).Start()
		return
	}
	t, b, s := C.CString(title), C.CString(body), C.CString(session)
	defer C.free(unsafe.Pointer(t))
	defer C.free(unsafe.Pointer(b))
	defer C.free(unsafe.Pointer(s))
	C.squatNotify(t, b, s)
}

// startDesktop: nothing to start (the web view follows the system appearance itself).
func startDesktop(func(string, any)) {}
