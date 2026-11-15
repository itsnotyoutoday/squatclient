//go:build windows

package main

import (
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32            = windows.NewLazySystemDLL("user32.dll")
	procFlashWindowEx = user32.NewProc("FlashWindowEx")
	procEnumWindows   = user32.NewProc("EnumWindows")
	procGetWindowPID  = user32.NewProc("GetWindowThreadProcessId")
	procIsVisible     = user32.NewProc("IsWindowVisible")
	procGetWindow     = user32.NewProc("GetWindow")
	procTextLength    = user32.NewProc("GetWindowTextLengthW")

	attnMu   sync.Mutex
	attnHwnd uintptr
)

const (
	flashwStop      = 0
	flashwTray      = 0x2
	flashwTimerNoFG = 0xC // keep flashing until the window comes to the foreground
	gwOwner         = 4
)

type flashInfo struct {
	cbSize  uint32
	hwnd    uintptr
	flags   uint32
	count   uint32
	timeout uint32
}

// mainWindow finds this process's visible top-level window (the app window), once.
func mainWindow() uintptr {
	attnMu.Lock()
	defer attnMu.Unlock()
	if attnHwnd != 0 {
		return attnHwnd
	}
	pid := uint32(windows.GetCurrentProcessId())
	cb := syscall.NewCallback(func(h uintptr, _ uintptr) uintptr {
		var p uint32
		procGetWindowPID.Call(h, uintptr(unsafe.Pointer(&p)))
		if p != pid {
			return 1
		}
		if vis, _, _ := procIsVisible.Call(h); vis == 0 {
			return 1
		}
		if owner, _, _ := procGetWindow.Call(h, gwOwner); owner != 0 {
			return 1
		}
		if n, _, _ := procTextLength.Call(h); n == 0 {
			return 1
		}
		attnHwnd = h
		return 0 // stop
	})
	procEnumWindows.Call(cb, 0)
	return attnHwnd
}

func requestAttention(on bool) {
	h := mainWindow()
	if h == 0 {
		return
	}
	fi := flashInfo{hwnd: h}
	fi.cbSize = uint32(unsafe.Sizeof(fi))
	if on {
		fi.flags = flashwTray | flashwTimerNoFG
	} else {
		fi.flags = flashwStop
	}
	procFlashWindowEx.Call(uintptr(unsafe.Pointer(&fi)))
}
