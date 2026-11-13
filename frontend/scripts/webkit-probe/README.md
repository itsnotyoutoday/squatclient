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
