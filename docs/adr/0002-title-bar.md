# ADR 0002: Window title bar

Status: accepted (2026-11-12)

Decision (staged):
1. The title bar/top strip is a React component with a platform switch, so the app strip (world name, status, quick actions) is part of the design on every platform.
2. **v1:** macOS uses Wails' hidden-inset title bar (native traffic lights over our own top strip, keeping native full-screen/snapping); Windows and Linux use the normal native window frame.
3. **Later:** a custom frameless bar for Windows/Linux (own minimise/maximise/close, drag region), only after testing resize, Windows snap layouts and Linux/WebKitGTK dragging on real machines.
4. Never a browser-like bar: no address bar, tabs or browser chrome; native app menu and Dock/taskbar icon on all platforms.
