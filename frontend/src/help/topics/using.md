---
title: Using the client
order: 4
keywords: editor mode, resize, history browser, softcode, output, scrollback, search, pause, more, input, history, tabs, status bar, themes, colours, colors, 256, truecolor, utf-8, links, find
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
- Ctrl-R opens the history browser; Cmd/Ctrl-Shift-E switches to the editor.

### History

Up and Down (or Ctrl-P and Ctrl-N) walk through lines you sent earlier. If you typed something first, only lines starting with it are offered, so typing `/def` and pressing Up finds your last `/def` command.

History is kept **per world**, on disk, so it survives restarts and is shared by every tab of the same world. A multi-line block is one entry. Passwords and anything typed while the game has echo off are never stored. How many entries are kept is the _Command history size_ setting (default 20,000; see [Settings](help:settings)).

### History browser

Press Ctrl-R (or Cmd-Shift-H), or click **History** next to the input, to search everything you have sent to this world.

- Type to filter at once. **.\*** switches to regular expressions and **Aa** to case-sensitive matching; matches are highlighted.
- Up and Down select (PageUp, PageDown, Ctrl-Home, Ctrl-End jump), Enter puts the entry into the input (into the editor if it has several lines), Shift-Enter sends it now, Cmd/Ctrl-C copies it, Delete removes it, Escape closes.
- Click selects, double-click loads. **Clear history** asks for confirmation first.

## Resizing the command window

Drag the thin bar above the input upwards to make the command window taller (up to about 70% of the window); the output shrinks to match. Focus the bar and use Up and Down (PageUp and PageDown for five lines, Home for the tallest, End for the smallest). Double-click it to reset. The height is remembered.

## Editor mode

For big pieces of code press **Editor** (or Cmd/Ctrl-Shift-E): the input becomes a large monospace editor.

- Enter inserts a new line; **Cmd/Ctrl-Enter sends the whole buffer**; **Cmd/Ctrl-Shift-Enter** (or the _Send line / selection_ button) sends only the selection, or the line under the cursor together with the indented lines that continue it.
- Tab inserts two spaces (with a selection it indents every selected line); Shift-Tab outdents. Line numbers, the line and column, and _Wrap_ (off by default) are in the toolbar.
- Escape returns to the single line and keeps your text. Unsent text is kept as a **draft** for the world, across tab switches and restarts.
- Pasting several lines inserts them into the editor instead of sending them.

### Sending blocks

Every resulting line is sent to the game separately, in order:

- **Indented lines continue the previous line** (setting _Editor: join indented lines_, on by default). A line starting with a space or tab has its leading whitespace removed and is appended directly to the line before it, with no space added, so indent freely for readability: `&FN obj=[add(1,` followed by `  2)]` is sent as `&FN obj=[add(1,2)]`. Add a space yourself where the code needs one.
- **Blank lines and lines holding only an `@@` comment are dropped** (setting _Editor: drop blank and @@ comment lines_, on by default), also between a line and its continuation. Trailing spaces are always removed.
- With _Delay between block lines_ above 0 the lines go out one per interval so a big block does not flood the game; a progress bar and a **Cancel** button show while it runs (lines already sent cannot be taken back).

### Passwords

Lines like `connect name password`, `create name password` and `@password ...` are recognised automatically and are never echoed, stored or logged by a squatter; the screen shows them masked (`connect name ********`). Use `/secret text` for anything else you must keep out of logs.

When the game turns off echo (for a password prompt) the input becomes a masked password field with a lock icon, history is disabled and what you type is not recorded.

## Tabs

Each connection has a tab. Use Alt-1 to Alt-9 or Ctrl-Tab to switch. Unread lines in background tabs show as a badge, and with desktop notifications on you also get notified. The small **x** on a tab disconnects it, or dismisses it if it has already ended.

## Themes

Pick a theme in [Settings](help:settings): **Dark**, **Light** or **High contrast**. A theme sets the text and background colours, the 16 ANSI colours and the colours of the window chrome. You can import your own theme as JSON. If some colour combinations are hard to read, set **Minimum contrast** (4.5 is the WCAG AA level) and the client nudges colours to meet it. The client respects your system's _reduce motion_ preference.

## Colours

By default SquatClient shows UTF-8 text with xterm-256 and 24-bit truecolour. Type `/colortest` to print every colour mode (16 colours, the full 256 grid, truecolor gradients, text styles and UTF-8) and compare it with another program.

**Why basic colours can differ between programs:** colours 0-15 (the plain `red`, `yellow`, ... and their bright versions) are not fixed: every terminal and theme chooses its own shades, and games that use them look different in different clients. Colours 16-255 (xterm-256) and truecolour are exact everywhere. SquatClient's default dark theme uses a classic terminal palette so a game that sends basic colours looks like it does in tinyfugue; if a slot looks wrong, change it in a custom theme (see below). _Bold text uses bright colours_ makes bold text switch to the bright variant of the 8 basic colours, as in many terminals. In scripts you can use all of these colours; see [Attributes](help:scripting/attributes).

## Accessibility

Dialogs trap keyboard focus and close with Escape, controls have labels, and _Screen-reader mode_ announces new lines to assistive technology. A "Skip to input" link is the first thing a keyboard user reaches.
