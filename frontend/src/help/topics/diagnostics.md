---
title: Diagnostics
order: 15
keywords: diagnostics, report, platform, system information, support, bug report, webview, wrapping, wrap, copy, save, debug, version, os version, recent problems, redacted
aliases: diagnostics, diagnostic, system info, system information, bug report, support report
---

**Help > Diagnostics** shows a plain-text report about your computer and this copy of SquatClient. If something looks wrong, for example lines in the output that do not wrap, copy the report and send it to whoever is helping you. It lets them see what your machine does without asking you a string of questions.

## Using it

- **Copy** puts the whole report on the clipboard.
- **Save as file...** asks where to save it as a `.txt` file, for when you want to attach it to a message.
- **Refresh** collects it again, for example after you resize the window or open a connection.
- **Include hostnames** is off. Turn it on only if the person helping you needs to know which servers you use.

The report holds no passwords, keys, tokens, pairing codes or fingerprints. You can read all of it before you send it.

## What is in the report

| Section                  | What it shows                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| App                      | SquatClient version, the source commit and build date if known, the engine version, and the squatter protocol version this build speaks.       |
| Platform                 | Operating system and its version (Windows build number, macOS version and build, Linux distribution and kernel), CPU architecture, number of CPUs, locale, time zone. Notes say if it runs under Wine, WSL, Rosetta or in a Flatpak. |
| Web view                 | The browser engine inside the window (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux), its version where it can be read, and the browser identification string. |
| Display                  | Window and screen size, pixel ratio, light or dark preference, reduced-motion preference, and the output font: whether any font in the list is really installed on this machine. |
| Rendering checks         | Which CSS features the web view supports, the computed layout style of the output rows, how many characters fit on a line, and the **live wrap test**. |
| Settings                 | Your settings. Anything that looks like a secret is replaced by `[redacted]`.                                                                  |
| Squatters and sessions   | Counts, connection states, kinds, versions-related flags, and game types. No names, users, passwords or keys; hostnames only if you ticked the box. |
| Recent problems          | The last 200 errors and warnings seen since the window opened, with anything secret-looking removed. Kept in memory only.                       |
| Paths                    | The settings, data and log folders, with your home folder shown as `~`.                                                                        |

## The live wrap test

The test draws a 300-character word with no spaces, and a long sentence, out of sight, in a row styled exactly like a row of the output pane and as wide as the pane. It reports how many lines each took. A line of `WRAPPED` means long lines wrap on your machine. A **control** line, which uses a style that never wraps, should say `DID NOT WRAP`: it shows the test can tell the difference.

## Limits on each system

- **Windows**: the version comes from the system itself, so it is correct even on Windows 11. The WebView2 version is read from the runtime or the registry; it is empty if no runtime is found.
- **macOS**: the web view is the system WebKit, so its version follows the macOS version; the browser identification string shows it.
- **Linux**: the WebKitGTK version is found with `pkg-config` when that is installed, otherwise from the name of the library file, which shows the major series only.
- Open the dialog with a connection open if you want the live output row styles; without one they read `not mounted`, but the wrap test still runs.

See also [Troubleshooting](help:troubleshooting).
