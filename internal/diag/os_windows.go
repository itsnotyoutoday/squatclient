//go:build windows

package diag

import (
	"syscall"
	"unsafe"

	"github.com/wailsapp/go-webview2/webviewloader"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

func regString(root registry.Key, path, name string, access uint32) string {
	k, err := registry.OpenKey(root, path, registry.QUERY_VALUE|access)
	if err != nil {
		return ""
	}
	defer k.Close()
	s, _, _ := k.GetStringValue(name)
	return s
}

func osInfo() (name, version string, notes []string) {
	v := windows.RtlGetVersion() // not subject to the manifest version lie of GetVersionEx
	const cv = `SOFTWARE\Microsoft\Windows NT\CurrentVersion`
	product := regString(registry.LOCAL_MACHINE, cv, "ProductName", 0)
	disp := regString(registry.LOCAL_MACHINE, cv, "DisplayVersion", 0)
	if disp == "" {
		disp = regString(registry.LOCAL_MACHINE, cv, "ReleaseId", 0)
	}
	var ubr uint32
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, cv, registry.QUERY_VALUE); err == nil {
		if n, _, err := k.GetIntegerValue("UBR"); err == nil {
			ubr = uint32(n)
		}
		k.Close()
	}
	name = WindowsProductName(product, v.BuildNumber)
	if name == "" {
		name = "Windows"
	}
	if disp != "" {
		name += " " + disp
	}
	version = WindowsVersionString(v.MajorVersion, v.MinorVersion, v.BuildNumber, ubr)
	if isWine() {
		notes = append(notes, "running under Wine")
	}
	return
}

func isWine() bool {
	ntdll, err := syscall.LoadDLL("ntdll.dll")
	if err != nil {
		return false
	}
	_, err = ntdll.FindProc("wine_get_version")
	return err == nil
}

func systemLocale() string {
	k32 := syscall.NewLazyDLL("kernel32.dll")
	p := k32.NewProc("GetUserDefaultLocaleName")
	var buf [85]uint16
	r, _, _ := p.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if r == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf[:])
}

func webViewInfo() WebViewInfo {
	w := WebViewInfo{Engine: "WebView2"}
	if v, err := webviewloader.GetAvailableCoreWebView2BrowserVersionString(""); err == nil && v != "" {
		w.Version = v
		return w
	}
	const guid = `SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`
	for _, c := range []struct {
		root registry.Key
		path string
		acc  uint32
	}{
		{registry.LOCAL_MACHINE, guid, registry.WOW64_32KEY},
		{registry.LOCAL_MACHINE, guid, registry.WOW64_64KEY},
		{registry.CURRENT_USER, guid, 0},
	} {
		if v := regString(c.root, c.path, "pv", c.acc); v != "" && v != "0.0.0.0" {
			w.Version = v
			return w
		}
	}
	w.Note = "WebView2 runtime version not found"
	return w
}
