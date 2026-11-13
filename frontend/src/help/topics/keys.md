---
title: Keyboard shortcuts
order: 5
keywords: keys, shortcuts, keybindings, hotkeys, emacs, editing, alt, ctrl, cmd, option, f1
aliases: keys, shortcuts, keybindings, hotkeys, keyboard
---

On macOS, **Alt** means the Option key and **Cmd** the Command key. On other systems use Ctrl where Cmd is shown.

## Editing the input line

These are the default bindings of the input line. They follow Emacs and TinyFugue.

| Key                          | Action                                                  |
| ---------------------------- | ------------------------------------------------------- |
| Enter                        | send the line                                           |
| Shift-Enter                  | insert a new line                                       |
| Tab                          | insert a tab character                                  |
| Escape                       | clear the input line                                    |
| Ctrl-A, Home                 | start of line                                           |
| Ctrl-E, End                  | end of line                                             |
| Ctrl-B, Left                 | back one character                                      |
| Ctrl-F, Right                | forward one character                                   |
| Alt-B, Ctrl-Left, Alt-Left   | back one word                                           |
| Alt-F, Ctrl-Right, Alt-Right | forward one word                                        |
| Backspace, Ctrl-H            | delete the character before the cursor                  |
| Delete, Ctrl-D               | delete the character under the cursor                   |
| Ctrl-W, Alt-Backspace        | delete the word before the cursor                       |
| Alt-D                        | delete the word after the cursor                        |
| Ctrl-K                       | delete to the end of the line                           |
| Ctrl-U                       | delete the whole line                                   |
| Ctrl-Y                       | paste the last deleted text                             |
| Ctrl-T                       | swap the two characters around the cursor               |
| Up, Ctrl-P                   | previous history line (prefix search on what you typed) |
| Down, Ctrl-N                 | next history line                                       |

Up, Down, Ctrl-P, Ctrl-N and Shift-Enter are disabled while a password is being typed.

## Editor mode

Toggle with Cmd-Shift-E or Ctrl-Shift-E (or the Editor button). The editor is a code editor: the Emacs keys above are not used; it has the usual code-editor keys instead.

| Key                               | Action                                                                  |
| --------------------------------- | ----------------------------------------------------------------------- |
| Cmd-Shift-E, Ctrl-Shift-E         | switch editor mode on or off                                            |
| Enter                             | insert a new line                                                       |
| Cmd-Enter, Ctrl-Enter             | send the whole buffer                                                   |
| Cmd-Shift-Enter, Ctrl-Shift-Enter | send the selection or the current line                                  |
| Tab                               | insert two spaces (indent the selected lines)                           |
| Shift-Tab                         | outdent                                                                 |
| Cmd-Alt-], Ctrl-Alt-]             | expand the selection (or everything) over indented lines                |
| Cmd-Alt-[, Ctrl-Alt-[             | collapse it again                                                       |
| Cmd-F, Ctrl-F                     | search (and replace) inside the editor; Escape closes it                |
| Cmd-Z, Ctrl-Z                     | undo                                                                    |
| Cmd-Shift-Z, Ctrl-Y               | redo                                                                    |
| Escape                            | back to the single line (the text is kept), when no search is open      |

## Resizing the command window

Focus the bar above the input (Tab to it), then:

| Key              | Action                      |
| ---------------- | --------------------------- |
| Up, Down         | one line taller, shorter    |
| PageUp, PageDown | five lines taller, shorter  |
| Home, End        | tallest, smallest           |
| double-click     | reset to the default height |

## History browser

| Key                 | Action                                                         |
| ------------------- | -------------------------------------------------------------- |
| Ctrl-R, Cmd-Shift-H | open the history browser                                       |
| Up, Down            | select the previous, next entry                                |
| PageUp, PageDown    | move eight entries                                             |
| Ctrl-Home, Ctrl-End | newest, oldest entry                                           |
| Enter               | load the entry into the input (editor if it has several lines) |
| Shift-Enter         | send the entry now                                             |
| Cmd-C, Ctrl-C       | copy the entry (when no text is selected)                      |
| Delete              | remove the entry                                               |
| Escape              | close                                                          |

## Windows and sessions

| Key                       | Action                                                    |
| ------------------------- | --------------------------------------------------------- |
| Alt-1 to Alt-9            | switch to session 1 to 9                                  |
| Ctrl-Tab, Ctrl-Shift-Tab  | next and previous session                                 |
| Cmd-N, Ctrl-N             | quick connect (menu: Session, New Connection)             |
| Ctrl-O, Cmd-O             | world manager                                             |
| Ctrl-, and Cmd-,          | settings                                                  |
| Cmd-W                     | close the session                                         |
| Cmd-Shift-D, Ctrl-Shift-D | suspend: detach from squatters (menu: Session, Suspend)   |
| Cmd-Shift-R, Ctrl-Shift-R | resume: attach to squatters again (menu: Session, Resume) |

## Output and search

| Key                  | Action                                                   |
| -------------------- | -------------------------------------------------------- |
| PageUp, PageDown     | scroll the output (pauses live output)                   |
| End (output focused) | jump to live output                                      |
| Cmd-F, Ctrl-Shift-F  | search the scrollback (Ctrl-F when the output has focus) |

## Help

| Key                 | Action                                |
| ------------------- | ------------------------------------- |
| F1, Cmd-?           | open help                             |
| `/`                 | focus the help search box             |
| Up, Down            | move in the topic tree                |
| Right, Left         | expand, collapse in the tree          |
| Enter               | open the selected topic               |
| Alt-Left, Alt-Right | back, forward in help history         |
| Escape              | clear the search box, then close help |

You can bind keys from scripts with `/bind`; see [Macros: /def](help:scripting/macros-def).

## What next

If a key does not do what you expect, see [Troubleshooting](help:troubleshooting#ctrl-b-and-ctrl-f-do-not-scroll). To learn what the input line can do, read [Using the client](help:using).
