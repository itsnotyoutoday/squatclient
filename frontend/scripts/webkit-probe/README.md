# WebKit help probe

An earlier bug (a global CSS class `.row` colliding with the help tree) left the help sidebar empty, and no jsdom
test noticed because jsdom does no layout. This probe opens the help in a real `WKWebView`, the web engine Wails
uses on macOS, and measures the layout.

Run it (macOS with Xcode command line tools; elsewhere it prints "skipped" and exits 0):

    npm run help:probe                 # topics: home scripting compat lua keys
    npm run help:probe -- squatter using

It builds the front end with `vite build` into a temporary folder, serves it on a free local port (set `PORT` to choose one), loads it with `?mock=1`, presses F1, then opens each topic by clicking it in the tree. For every topic it checks
that the sidebar has many tree items inside its rectangle, the page text is non-empty and inside its pane, the content
does not overlap the sidebar or leave the window, and nothing overflows horizontally. Exit code 0 means all topics
passed.

## Object Editor probe

`npm run editor:probe` (same requirements; prints "skipped" off macOS) opens the Object Editor in mock mode with real
key and mouse events (`NSEvent` through `NSApp.sendEvent`): types `/edit #12`, clicks **Object details**, checks that
every section is inside the scroll pane with non-zero size and no horizontal overflow at 1000, 900 and 600 px, opens the
**Move** dialog (search, results and the Nearby list inside the dialog, confirmation sentence, 600 px, Escape), opens the
lock editor and presses **Test**, then right-clicks an attribute and checks that the context menu appears inside the window,
is not covered, and that an item can be clicked. Exit code 0 = all passed.
