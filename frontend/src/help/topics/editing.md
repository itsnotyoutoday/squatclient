---
title: Editing objects and attributes
order: 5
keywords: object details, flags, powers, locks, lock editor, move, examine, attribute menu, right-click, edit, /edit, Object Editor, editor view, attribute, attributes, dbref, softcode, save, conflict, permission, read-only, tabs, quick open, search, go to definition, expand, collapse, %r
aliases: edit, /edit, Object Editor, editor view, attributes, editing objects
---

The Object Editor lets you work on objects and their attributes in a game as if they were files: a list of attributes on the left, a full code editor on the right, and tabs for every object you have open. It needs a connected world, because it reads and writes through the game itself.

## Which games it is for

The Object Editor is the module for MU* games: PennMUSH, CobraMUSH, TinyMUX, TinyMUSH, TinyMUSE and RhostMUSH. Other kinds of game do not get it: there is no button, Cmd-E does nothing, and `/edit` answers "no such command".

SquatClient finds out what kind of game a world is by itself: it recognises the server's name (or, for Diku-style games, the classic "By what name do you wish to be known?" prompt) in the first lines the game prints, and after you log in it quietly asks the game for its version (nothing appears in the output). A game that is not logged in yet is not detected yet, so the editor shows up a moment after you connect. If detection gets it wrong, or the game hides its version, set it yourself:

- in the world's settings (Worlds, then **Game type**), which is remembered, or
- with `/gametype pennmush` (or `cobramush`, `tinymux`, `tinymush`, `rhostmush`, `tinymuse`, `mush` for any other MU*) for the current connection. Other kinds of game have types too (`circlemud`, `rom`, `smaug`, `diku`, `lpmud`, `lambdamoo`, `evennia`, `muck`, `coldmud`, `coffeemud`, `ironrealms`, `custom`), and `other` means none of these. They never get the Object Editor. `/gametype` alone shows the current type and `/gametype auto` detects it again.

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

## Object overview header

Across the top of the editor, above whatever you are editing, a compact header always shows the selected object: its name, number, type, owner and location (click the owner or location to open it), then its **Flags**, **Powers** and **Locks** as small chips with their counts (a lock chip reads like `Basic: =#45 | flag^WIZARD`; hover for the full key and the lock's flags). Long groups end in **+N more**, which expands them. Click a chip or a group name to jump to that section of Object details; the **+** next to a group starts adding one. A padlock badge marks an object you cannot change. **Refresh** reads the object again, and the arrow collapses the header to one line (remembered for each world). The header shares one quiet read with Object details and updates after any change you make.

## Object details

The first entry of the left list, **Object details**, shows everything about the object itself instead of one attribute (Cmd-Shift-D). The **Overview** tab has these sections:

- **Identity**: the name (type a new one and press Enter or **Rename**), the number, the type, the owner (**Chown...** gives it to someone else), pennies, created and modified times, the attribute count and, for players, alias, channels and quota when the game tells.
- **Location**: where the object is, with a **Move...** button. For an exit it shows where the exit starts and where it leads.
- **Relations**: parent (with the parents above it), zone and home, each with **Change...** and **Clear**.
- **Flags** and **Powers**: each one set is a chip; the **x** on a chip turns it off. **Add flag** is a box that lists the flags the game offers with a short description; type to narrow the list, use the arrow keys and Enter, or type any name. Hover a chip for its letter and description. Powers work the same way and usually need a wizard.
- **Locks**: every lock the object has (Basic, Enter, Use, Zone, Page, Teleport and more, plus your own `user:name` locks), each with its key, its flags as buttons you can switch on and off (visual, no_inherit, no_clone, wizard, locked), **Edit** and **Clear**. **New lock...** adds one.
- **Warnings**: the object's warning checks, a box to set them, and **Run @wcheck** to see the game's report.
- **Contents** and **Exits**: click an item to open it in a new tab.

Every change shows a spinner on its control, then the state read back from the game. If the game refuses, you see its exact words next to the control, the old value stays, and nothing is lost. When you do not control the object, a notice says so and the controls are off. **Refresh** reads everything again. All of this happens quietly: nothing appears in the output pane or in your command history, and the game's replies show in the strip at the bottom of the view.

### Raw examine

The **Raw examine** tab runs the game's own `examine` for the object and shows its text with colours, so anything the Overview cannot show is still there. Choose Normal, All or Brief, press **Refresh**, or **Copy** the text.

### The lock editor

**Edit** on a lock (or **New lock...**) opens a dialog with the key in a text box and buttons that insert pieces: a number, `=#` (is exactly), `+#` (carries), `@#` (use another object's lock), `flag^`, `type^`, `power^`, an attribute test, and the combinators `&`, `|`, `!` and brackets. The dialog warns when brackets do not balance. **Test** asks the game whether the stored lock lets a chosen object through (`me`, a number or a name); save first to test a change. **Save** sets the lock and reads it back; **Clear lock** removes it.

### Moving an object

**Move...** opens a dialog. Type part of a room name or a number to search, or pick from **Nearby** (where it is now, where the exits of that room lead, and what is there) or **Recently used**. Clicking a place only looks at it: you see its owner, a short description, and its exits, which you can follow. A sentence such as "Move Widget (#123) to Garden (#11)?" says exactly what will happen; **Move** does it and the details refresh. Some games do not let you search every room; the dialog then says so and shows your own rooms and things nearby. **Set home** and the exit's **Change...** use the same dialog.

## Attribute menu

Right-click an attribute in the list (or press Shift-F10, the Menu key or F while the list has focus, or use the **...** button above the editor) for its menu:

- **Flags** with check marks: no_command, no_inherit, no_clone, mortal_dark, wizard, veiled, case, nearby, locked, safe, visual, regexp. Pick one to switch it; the game's reply shows if it refuses.
- **Lock attribute** / **Unlock attribute** (`@atrlock`); a padlock shows while locked.
- **Change owner...**, **Rename...** (the value is copied to the new name and checked before the old attribute is cleared) and **Delete attribute...** (asks first).
- **Copy name**, **Copy as command** (an `&ATTR #12=value` line you can paste) and **Open in the editor**.

Everything in the menu is checked by reading the attribute again, and it is read-only when you do not control the object.

## Moving around

| Key                       | Action                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Cmd-P, Ctrl-P             | go to an attribute of the current object by typing part of its name                                        |
| Cmd-1 to Cmd-9            | switch to the first to ninth object tab                                                                    |
| Cmd-T, Ctrl-T             | open another object (the **+** prompt)                                                                     |
| Cmd-W, Ctrl-W             | close the current object tab                                                                               |
| Cmd-click, F12            | go to the attribute named by `u(#12/ATTR)`, `get(...)`, `xget(...)`, `v(...)` and similar under the cursor |
| Cmd-Shift-F, Ctrl-Shift-F | search the values of every attribute of the object                                                         |
| Cmd-Shift-D, Ctrl-Shift-D | show the Object details view                                                                               |
| Cmd-Shift-M, Ctrl-Shift-M | Move the object (when Object details is showing)                                                           |
| Shift-F10, Menu key, F    | the attribute menu for the attribute in the list                                                           |
| Escape                    | back to the terminal (when nothing is selected and no dialog is open)                                      |

Go to definition opens the object in a new tab when it is not open yet. References built at run time, such as `u(%0/ATTR)`, cannot be followed.

Searching all attributes reads every attribute of the object once, so a big object takes a moment; results appear as they come in and the values are kept for the next search. **Refresh** reads the object again.

See also [Keyboard shortcuts](help:keys#the-object-editor) and [Commands](help:commands).
