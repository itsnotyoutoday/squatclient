---
title: Using the client
order: 4
keywords: output, scrollback, search, pause, more, input, history, tabs, status bar, themes, colours, colors, 256, truecolor, utf-8, links, find
aliases: output, scrollback, input, history, tabs, status, statusbar, themes, theme, search, pause, more
---

## The window

- **Tab bar**: one tab per connection, plus buttons for worlds, quick connect, squatters, search, settings and help.
- **Output pane**: what the game says, plus your own typed lines and system messages.
- **Input line**: where you type. Lines starting with `/` are commands, anything else is sent to the game.
- **Status bar**: connection state, activity in other tabs, the pause marker, any fields your scripts add, and the clock.

## Output pane

Text keeps the colours and styles the game sends: bold, dim, italic, underline, strikethrough, blink and reverse. Colours can be the 16 theme colours, the 256-colour xterm palette, or 24-bit truecolour, and all of UTF-8 is displayed. Links the game marks up, and bare `http://` and `https://` addresses (if enabled in [Settings](help:settings)), are clickable and open in your system browser. Only web addresses are ever opened.

Select text with the mouse and copy it as usual.

## Scrollback and pausing

Recent output is kept in memory, up to the **scrollback lines** setting; older history is fetched on demand when you scroll up. Use PageUp and PageDown to scroll, or the mouse wheel.

When you scroll up, live output **pauses** so the text you are reading does not move (if _Pause output when scrolled up_ is on). The status bar shows **--More--** with a count of lines that arrived meanwhile. Press End (when the output has focus) or the jump button to return to live output. This replaces TinyFugue's `--More--` prompt.

## Searching

Press Cmd-F or Ctrl-Shift-F (Ctrl-F when the output has focus) to open the search bar. It offers previous and next match, case sensitivity and regular expressions, and searches the whole scrollback of the current tab.

## Editing the input line

The input line understands the Emacs editing keys TinyFugue users know. The full list is in [Keyboard shortcuts](help:keys). Highlights:

- Home/End or Ctrl-A/Ctrl-E move to the start or end.
- Ctrl-W and Alt-D delete words; Ctrl-K and Ctrl-U delete to the end or the whole line; Ctrl-Y pastes the last deletion.
- Shift-Enter inserts a new line so you can write several lines before sending.
- Pasting several lines sends them one by one.
- Escape clears the line.

### History

Up and Down (or Ctrl-P and Ctrl-N) walk through lines you sent earlier. If you typed something first, only lines starting with it are offered, so typing `/def` and pressing Up finds your last `/def` command.

### Passwords

When the game turns off echo (for a password prompt) the input becomes a masked password field with a lock icon, history is disabled and what you type is not recorded.

## Tabs

Each connection has a tab. Use Alt-1 to Alt-9 or Ctrl-Tab to switch. Unread lines in background tabs show as a badge, and with desktop notifications on you also get notified. The small **x** on a tab disconnects it, or dismisses it if it has already ended.

## Themes

Pick a theme in [Settings](help:settings): **Dark**, **Light** or **High contrast**. A theme sets the text and background colours, the 16 ANSI colours and the colours of the window chrome. You can import your own theme as JSON. If some colour combinations are hard to read, set **Minimum contrast** (4.5 is the WCAG AA level) and the client nudges colours to meet it. The client respects your system's _reduce motion_ preference.

## Colours

By default SquatClient shows UTF-8 text with xterm-256 and 24-bit truecolour. _Bold text uses bright colours_ makes bold text switch to the bright variant of the 8 basic colours, as in many terminals. In scripts you can use all of these colours; see [Attributes](help:scripting/attributes).

## Accessibility

Dialogs trap keyboard focus and close with Escape, controls have labels, and _Screen-reader mode_ announces new lines to assistive technology. A "Skip to input" link is the first thing a keyboard user reaches.
