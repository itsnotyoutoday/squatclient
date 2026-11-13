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

## Windows and sessions

| Key                      | Action                                        |
| ------------------------ | --------------------------------------------- |
| Alt-1 to Alt-9           | switch to session 1 to 9                      |
| Ctrl-Tab, Ctrl-Shift-Tab | next and previous session                     |
| Cmd-N, Ctrl-N            | quick connect (menu: Session, New Connection) |
| Ctrl-O, Cmd-O            | world manager                                 |
| Ctrl-, and Cmd-,         | settings                                      |
| Cmd-W                    | close the session                             |

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

You can change bindings from scripts with `/bind`; see [Macros: /def](help:scripting/macros-def).
