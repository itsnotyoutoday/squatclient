//go:build !linux && !darwin && !windows

package diag

func osInfo() (string, string, []string) { return "", "", nil }
func systemLocale() string               { return "" }
func webViewInfo() WebViewInfo           { return WebViewInfo{Engine: "unknown"} }
