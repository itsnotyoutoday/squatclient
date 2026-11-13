---
title: Settings reference
order: 6
keywords: settings, preferences, font, theme, scrollback, contrast, timestamps, notifications, screen reader, encoding, linkify
aliases: settings, preferences, options, config
---

Open settings with Ctrl-, (Cmd-, on macOS), the menu (Session, Settings) or the gear button. Changes apply immediately.

| Setting                       | Meaning                                                                       | Default                                             |
| ----------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| Theme                         | Dark, Light, High contrast, or an imported theme                              | Dark                                                |
| Import theme (JSON)           | add your own theme from JSON text                                             | none                                                |
| Font family                   | font stack for the output and input                                           | JetBrains Mono, SF Mono, Menlo, Consolas, monospace |
| Font size (px)                | size of text in the output                                                    | 14                                                  |
| Scrollback lines in memory    | how many lines per tab are kept in memory; older history is fetched on demand | 20000                                               |
| Minimum contrast              | 0 turns it off; 4.5 meets WCAG AA; colours are adjusted to reach it           | 0                                                   |
| Default encoding              | UTF-8 or Latin-1 for new connections; a world can override it                 | UTF-8                                               |
| Show timestamps               | prefix each line with its time                                                | off                                                 |
| Bold text uses bright colours | bold basic colours become bright colours                                      | off                                                 |
| Make bare URLs clickable      | turn `http://` and `https://` text into links                                 | on                                                  |
| Pause output when scrolled up | freeze live output while you read older text                                  | on                                                  |
| Desktop notifications         | notify about activity in background tabs                                      | on                                                  |
| Screen-reader mode            | announce new lines to assistive technology                                    | off                                                 |

The scrollback size is applied when the app starts. Truecolour is always on.

Other places that hold settings: worlds ([Connecting and worlds](help:connecting)), squatters ([Squatter](help:squatter)) and scripts ([the scripting language](help:scripting)).
