---
title: Using the client
order: 4
keywords: multi-line mode, upload, /upload, drag and drop, expand, collapse, brackets, code editor, resize, history browser, softcode, output, scrollback, search, pause, more, input, history, tabs, status bar, themes, colours, colors, 256, truecolor, utf-8, links, find
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

When you scroll up, live output **pauses** so the text you are reading does not move (if _Pause output when scrolled up_ is on). The status bar shows **--More--** with a count of lines that arrived meanwhile. Press End (when the output has focus) or the jump button to return to live output. This takes the place of TinyFugue's `--More--` prompt.

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

## Multi-line mode

For big pieces of code press **Editor** (or Cmd/Ctrl-Shift-E): the input becomes a large **code editor** made for MUSH softcode. It loads the first time you open it.

- It colours softcode as you type (functions, `[ ]` `{ }` `( )`, `%` substitutions, `#dbrefs`, `&ATTR` and `@commands`, `$` patterns, `@@` comments), marks the matching bracket, closes `(` `[` `{` for you and underlines brackets that do not balance (the toolbar counts them).
- Enter inserts a new line; **Cmd/Ctrl-Enter sends the whole buffer**; **Cmd/Ctrl-Shift-Enter** (or the _Send line / selection_ button) sends only the selection, or the line under the cursor together with the indented lines that continue it.
- Tab inserts two spaces (with a selection it indents every selected line); Shift-Tab outdents. Undo and redo (Cmd/Ctrl-Z, Cmd/Ctrl-Shift-Z or Ctrl-Y) work as in any editor. Line numbers, the line and column, and _Wrap_ (off by default) are in the toolbar.
- **Cmd/Ctrl-F searches inside the editor** (with replace); Escape closes that search first. The output search stays on Cmd/Ctrl-F whenever you are not in the editor.
- **Expand** breaks long function calls over indented lines so you can read them, and **Collapse** puts them back; both work on the selection, or on everything when nothing is selected, and Collapse after Expand gives back exactly what you had. Keys: Cmd/Ctrl-Alt-] and Cmd/Ctrl-Alt-[.
- Escape (with no search open) returns to the single line and keeps your text. Unsent text is kept as a **draft** for the world, across tab switches and restarts.
- Pasting several lines in the editor inserts them there instead of sending them.

### Checking brackets before sending

When you send from the editor (the whole buffer, or the selection or line) and the code has brackets that do not balance, a dialog says how many problems there are and on which lines. **Fix first** puts the cursor on the first problem and sends nothing; **Send anyway** sends it as it is. Turn the check off with _Editor: ask before sending unbalanced brackets_ in [Settings](help:settings). Single-line input is never checked.

### Sending blocks

Every resulting line is sent to the game separately, in order:

- **Indented lines continue the previous line** (setting _Editor: join indented lines_, on by default). A line starting with a space or tab has its leading whitespace removed and is appended directly to the line before it, with no space added, so indent freely for readability: `&FN obj=[add(1,` followed by `  2)]` is sent as `&FN obj=[add(1,2)]`. Add a space yourself where the code needs one.
- **Blank lines and lines holding only an `@@` comment are dropped** (setting _Editor: drop blank and @@ comment lines_, on by default), also between a line and its continuation. Trailing spaces are always removed.
- With _Delay between block lines_ above 0 the lines go out one per interval so a big block does not flood the game; a progress bar and a **Cancel** button show while it runs (lines already sent cannot be taken back).

### Passwords

Lines like `connect name password`, `create name password` and `@password ...` are recognised automatically and are never echoed, stored or logged by a squatter; the screen shows them masked (`connect name ********`). Use `/secret text` for anything else you must keep out of logs.

When the game turns off echo (for a password prompt) the input becomes a masked password field with a lock icon, history is disabled and what you type is not recorded.

## Uploading a file

`/upload` sends a text file to the game, for example a softcode installer. Type `/upload` to choose the file in the system file dialog (it starts in the folder you used last; text and code files such as `.txt` `.mush` `.mu` `.tf` `.lua` `.md` are listed first, All Files is one click away), or `/upload ~/code/install.mush` to give the path yourself (`~/` is your home folder; use quotes if the path has spaces). You can also **drag a text file onto the window**. Nothing is sent yet: a dialog opens first.

- The dialog shows the file name, size, line count and a scrollable preview with line numbers (a second tab shows exactly what will be sent). Large files stay responsive.
- It follows the same rules as multi-line mode: _join continuation lines_ and _skip blank and @@ comment lines_ start from your settings, and you can change them for this upload. The number of commands that will be sent is shown. _Delay per line_ starts from your setting, or 50 ms when that is 0, so the game is not flooded; an optional _prefix_ is put in front of every command.
- The commands go to the world shown as **Send to** (the one in front), one line at a time. If the code has unbalanced brackets the first problems are listed and the button reads **Send anyway**.
- While it runs you see a progress bar, the current line and the elapsed time, with **Pause**, **Resume** and **Cancel**. At the end a summary says how many commands were sent and skipped, or where it was cancelled. Closing the dialog while sending cancels the rest.
- Command history gets one entry, `/upload install.mush`, not the whole file.
- Only plain text files up to 5 MiB are accepted (binary files are refused with a message). UTF-8 and Latin-1 files both work; line endings are normalised. The app reads only the file you chose or typed.

## Tabs

Each connection has a tab. Use Alt-1 to Alt-9 or Ctrl-Tab to switch. Unread lines in background tabs show as a badge, and with desktop notifications on you also get notified. The small **x** on a tab disconnects it, or dismisses it if it has already ended.

## Themes

Pick a theme in [Settings](help:settings): **Dark**, **Light** or **High contrast**. A theme sets the text and background colours, the 16 ANSI colours and the colours of the window chrome. You can import your own theme as JSON. If some colour combinations are hard to read, set **Minimum contrast** (4.5 is the WCAG AA level) and the client nudges colours to meet it. The client respects your system's _reduce motion_ preference.

## Colours

By default SquatClient shows UTF-8 text with xterm-256 and 24-bit truecolour. Type `/colortest` to print every colour mode (16 colours, the full 256 grid, truecolor gradients, text styles and UTF-8) and compare it with another program.

**Why basic colours can differ between programs:** colours 0-15 (the plain `red`, `yellow`, ... and their bright versions) are not fixed: every terminal and theme chooses its own shades, and games that use them look different in different clients. Colours 16-255 (xterm-256) and truecolour are exact everywhere. SquatClient's default dark theme uses a classic terminal palette so a game that sends basic colours looks like it does in tinyfugue; if a slot looks wrong, change it in a custom theme (see below). _Bold text uses bright colours_ makes bold text switch to the bright variant of the 8 basic colours, as in many terminals. In scripts you can use all of these colours; see [Attributes](help:scripting/attributes).

## Accessibility

Dialogs trap keyboard focus and close with Escape, controls have labels, and _Screen-reader mode_ announces new lines to assistive technology. A "Skip to input" link is the first thing a keyboard user reaches.

## What next

Learn the keys in [Keyboard shortcuts](help:keys), tune the client in [Settings](help:settings), or automate it with [the scripting language](help:scripting). If something looks wrong, see [Troubleshooting](help:troubleshooting).
