//go:build windows

package main

import (
	"os/exec"
	"runtime"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

var (
	ole32                  = windows.NewLazySystemDLL("ole32.dll")
	gdi32                  = windows.NewLazySystemDLL("gdi32.dll")
	procCoInitializeEx     = ole32.NewProc("CoInitializeEx")
	procCoCreateInstance   = ole32.NewProc("CoCreateInstance")
	procCreateBitmap       = gdi32.NewProc("CreateBitmap")
	procDeleteObject       = gdi32.NewProc("DeleteObject")
	procCreateIconIndirect = user32.NewProc("CreateIconIndirect")
	procDestroyIcon        = user32.NewProc("DestroyIcon")

	clsidTaskbarList  = windows.GUID{Data1: 0x56FDF344, Data2: 0xFD6D, Data3: 0x11D0, Data4: [8]byte{0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90}}
	iidTaskbarList3   = windows.GUID{Data1: 0xEA1AFB91, Data2: 0x9E28, Data3: 0x4B86, Data4: [8]byte{0x90, 0xE9, 0x9E, 0x9F, 0x8A, 0x5E, 0xAE, 0xFA}}
	badgeOnce         sync.Once
	badgeCh           = make(chan int, 1)
	toastAUMID        = "SquatClient"
	registerAUMIDOnce sync.Once
)

const (
	vtHrInit         = 3
	vtSetOverlayIcon = 18
)

type iconInfo struct {
	fIcon    uint32
	xHotspot uint32
	yHotspot uint32
	hbmMask  uintptr
	hbmColor uintptr
}

// badgeIcon makes an HICON of the unread badge (see badgeRGBA).
func badgeIcon(n int) uintptr {
	px := badgeRGBA(n)
	color, _, _ := procCreateBitmap.Call(32, 32, 1, 32, uintptr(unsafe.Pointer(&px[0])))
	mask, _, _ := procCreateBitmap.Call(32, 32, 1, 1, 0)
	if color == 0 || mask == 0 {
		return 0
	}
	ii := iconInfo{fIcon: 1, hbmMask: mask, hbmColor: color}
	h, _, _ := procCreateIconIndirect.Call(uintptr(unsafe.Pointer(&ii)))
	procDeleteObject.Call(color)
	procDeleteObject.Call(mask)
	return h
}

// badgeWorker owns the COM taskbar object: COM wants one thread, so it is locked to it.
func badgeWorker() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	procCoInitializeEx.Call(0, 2) // COINIT_APARTMENTTHREADED
	var tb uintptr
	hr, _, _ := procCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsidTaskbarList)), 0, 1, uintptr(unsafe.Pointer(&iidTaskbarList3)), uintptr(unsafe.Pointer(&tb)))
	if hr != 0 || tb == 0 {
		return
	}
	obj := *(*unsafe.Pointer)(unsafe.Pointer(&tb)) // the COM object: its first word points at the method table
	vt := **(**[20]uintptr)(obj)
	syscall.SyscallN(vt[vtHrInit], tb)
	var prev uintptr
	for n := range badgeCh {
		hwnd := mainWindow()
		if hwnd == 0 {
			continue
		}
		var icon uintptr
		var desc *uint16
		if n > 0 {
			icon = badgeIcon(n)
			desc, _ = windows.UTF16PtrFromString("unread lines")
		}
		syscall.SyscallN(vt[vtSetOverlayIcon], tb, hwnd, icon, uintptr(unsafe.Pointer(desc)))
		if prev != 0 {
			procDestroyIcon.Call(prev)
		}
		prev = icon
	}
}

// setBadge puts the unread number on the taskbar button as an overlay icon (0 clears it).
func setBadge(n int) {
	badgeOnce.Do(func() { go badgeWorker() })
	select { // only the latest value matters
	case <-badgeCh:
	default:
	}
	select {
	case badgeCh <- n:
	default:
	}
}

// notify shows a toast. A desktop app needs an AppUserModelID registered for toasts to show with its name; that is one registry key.
// The text goes to PowerShell through the environment, never spliced into the script.
func notify(title, body, _ string) {
	registerAUMIDOnce.Do(func() {
		if k, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\AppUserModelId\`+toastAUMID, registry.SET_VALUE); err == nil {
			_ = k.SetStringValue("DisplayName", "SquatClient")
			k.Close()
		}
	})
	const script = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [System.Security.SecurityElement]::Escape($env:SQUAT_TITLE); $b = [System.Security.SecurityElement]::Escape($env:SQUAT_BODY)
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual></toast>")
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:SQUAT_AUMID).Show((New-Object Windows.UI.Notifications.ToastNotification $x))`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	cmd.Env = append(cmd.Environ(), "SQUAT_TITLE="+title, "SQUAT_BODY="+body, "SQUAT_AUMID="+toastAUMID)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	_ = cmd.Start()
}

// startDesktop: nothing to start (the web view follows the system appearance itself).
func startDesktop(func(string, any)) {}
