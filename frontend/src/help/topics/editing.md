---
title: Editing objects and attributes
order: 5
keywords: edit, /edit, Object Editor, editor view, attribute, attributes, dbref, softcode, save, conflict, permission, read-only, tabs, quick open, search, go to definition, expand, collapse, %r
aliases: edit, /edit, Object Editor, editor view, attributes, editing objects
---

The Object Editor lets you work on objects and their attributes in a game as if they were files: a list of attributes on the left, a full code editor on the right, and tabs for every object you have open. It needs a connected world, because it reads and writes through the game itself.

## Opening the editor

| How                          | What happens                                                            |
| ---------------------------- | ----------------------------------------------------------------------- |
| `/edit`                      | open the Object Editor and bring back the objects you had open          |
| `/edit #12`                  | open object #12                                                         |
| `/edit #12/CMD_ENGAGE`       | open object #12 and select the attribute `CMD_ENGAGE`                   |
| `/edit me`, `/edit here`     | open yourself, or the room you are in                                   |
| `/edit Nav Console`          | open an object by name (the game finds it; use a `#dbref` if two match) |
| Cmd-E (Ctrl-E)               | switch between the terminal and the editor                              |
| the **Object Editor** button | the same, from the top bar                                              |

`/edit` is handled by the window itself and is never sent to the game. Your connections keep running while you edit: switch back with Cmd-E, Escape or the **Terminal** button and everything that happened is in the output. Ctrl-E is the end-of-line key on the input line, so there it does not switch views; use Cmd-E, the button, or press Ctrl-E from anywhere else.

## The layout

- **Top row**: the connected worlds. Click one to switch world (Alt-1 to Alt-9 work too). Each world has its own set of open objects.
- **Second row**: the objects open in that world, labelled `Name (#12)`. A dot marks unsaved changes. Close a tab with its x or Cmd-W; drag tabs to reorder. The **+** asks for an object: `#123`, `me`, `here` or a name, optionally followed by `/ATTRIBUTE`.
- **Left**: the attribute list with a filter box. A dot means modified, `!` means the last save was refused, a padlock means read-only, `+` means a new attribute that is not saved yet. **+ new attribute** adds one; it is created by its first save.
- **Right**: the code editor for the selected attribute, with highlighting, bracket matching and a problems list. Every attribute you visit keeps its unsaved text and its undo history while you switch.
- **Bottom strip**: the number of bracket problems, the object's owner, type and flags, whether you control it, and the game's last reply.

## Permissions

When you open an object the client asks the game whether you control it.

- **You do not control it**: the object opens read-only with a notice. You can read, copy and compare, but Save is off and the editor will not accept typing.
- **The game could not say**: you can edit, and a notice says the game will decide when you save.
- **A protected attribute** (locked or safe) shows a padlock and opens read-only when the game reports it as protected. Otherwise the game's reply on save decides.

## Saving safely

Press **Save**, Cmd-S (Ctrl-S), or Cmd-Shift-S to save every changed attribute of the object. Before it writes, the client reads the attribute again.

1. **Someone changed it meanwhile**: nothing is saved, and a dialog shows the game's version and yours side by side. Choose **Overwrite** (store yours), **Reload theirs** (drop your changes) or **Keep editing** (your next save then overwrites).
2. **The game refuses**: your text stays exactly as you typed it, a red notice shows the game's own words (for example `Permission denied.`), and Save stays available.
3. **After a successful save** the value is read back. You see **Saved**, or a warning if the game stored something different from what you sent.

Closing a tab with unsaved changes asks whether to save them, discard them, or keep editing. Unsaved text is also kept between sessions: reopen the editor and it comes back marked as a restored draft. If the attribute changed in the game in the meantime, the same conflict dialog appears when you save.

Nothing the editor reads or writes appears in the output pane or in your command history.

## Formatting and what is sent

Long softcode is easier to read indented. **Expand** and **Collapse** (also Cmd-Alt-] and Cmd-Alt-[) change only how it looks: what is sent to the game is always the collapsed single line, exactly as when you send a block from the command window. They never change what the code means.

**%r as line breaks** shows `%r` as real line breaks and `%t` as tabs, which suits descriptions. Saving turns them back into `%r` and `%t`. While it is on, Expand and Collapse are off, because the line breaks are then part of the text. Attributes the game stored with real line breaks open in this view automatically. A `%` right before a line break cannot be saved safely; write `%%` or remove it, and the client tells you if you try.

**Wrap** wraps long lines. **Compare** shows the game's current value next to yours.

## Moving around

| Key                       | Action                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Cmd-P, Ctrl-P             | go to an attribute of the current object by typing part of its name                                        |
| Cmd-1 to Cmd-9            | switch to the first to ninth object tab                                                                    |
| Cmd-T, Ctrl-T             | open another object (the **+** prompt)                                                                     |
| Cmd-W, Ctrl-W             | close the current object tab                                                                               |
| Cmd-click, F12            | go to the attribute named by `u(#12/ATTR)`, `get(...)`, `xget(...)`, `v(...)` and similar under the cursor |
| Cmd-Shift-F, Ctrl-Shift-F | search the values of every attribute of the object                                                         |
| Escape                    | back to the terminal (when nothing is selected and no dialog is open)                                      |

Go to definition opens the object in a new tab when it is not open yet. References built at run time, such as `u(%0/ATTR)`, cannot be followed.

Searching all attributes reads every attribute of the object once, so a big object takes a moment; results appear as they come in and the values are kept for the next search. **Refresh** reads the object again.

See also [Keyboard shortcuts](help:keys#the-object-editor) and [Commands](help:commands).
