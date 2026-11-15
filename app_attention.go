package main

// RequestAttention lights the app's taskbar button (Windows: the button flashes until you switch to the window; macOS: the
// Dock icon bounces once) when there is new activity while the window is in the background. on=false clears it. The window
// calls it when it is not focused and a line arrives; Settings > Display & input can turn it off. Linux has no portable call
// in this toolkit, so it does nothing there.
func (a *App) RequestAttention(on bool) {
	requestAttention(on)
}
