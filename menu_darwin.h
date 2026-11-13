#ifndef SQUAT_MENU_DARWIN_H
#define SQUAT_MENU_DARWIN_H

// squatFixEditMenu re-wires the Edit menu's Undo and Redo items so they no longer claim Cmd+Z and
// Shift+Cmd+Z: the page (code editor or text field) handles those keys itself. The items stay in the
// menu and, when clicked, call goEditAction (0 = undo, 1 = redo).
void squatFixEditMenu(void);

#endif
