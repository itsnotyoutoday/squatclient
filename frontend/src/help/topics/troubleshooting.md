---
title: Troubleshooting
order: 13
keywords: problem, error, cannot connect, colours, colors, squatter, password, history, ctrl-b, ctrl-f, garbled, accents, not working
aliases: troubleshooting, problems, problem, trouble, faq, errors
---

Find the symptom, try the steps in order.

## Cannot connect

1. Check the **Host** and **Port** in the world. A typing mistake is the usual cause.
2. Try the other setting for **Use TLS**. A game that offers encryption on one port and plain text on another gives an error or silence on the wrong one.
3. If you see a certificate error and you trust the game, tick **Skip certificate verification** for that world. See [Connecting and worlds](help:connecting#encryption-tls).
4. If the world is set to connect through a squatter, check that the squatter is reachable; see [Lost squatter connection](help:troubleshooting#lost-squatter-connection). Setting **Connect via** to **Direct** shows whether the squatter is the problem.
5. If a world that needs a password fails at once, your operating system keychain may be locked. Unlock it and try again.
6. A tab that says **ended** shows why the game closed the connection. Choose **Connect again** to retry.

## Colours look different

SquatClient shows the colours the game sends, but the 16 basic colours (plain `red`, `green`, `yellow` and so on, plus their bright versions) are not fixed shades. Every terminal and every theme chooses its own, so the same game can look different in different programs. Colours from the 256-colour palette and truecolour are exact everywhere.

- Type `/colortest` to print every colour mode: the 16 basic colours, the full 256-colour grid, truecolour gradients, text styles and UTF-8. Compare it with another program to see what differs.
- The default dark theme uses a classic terminal palette, so games that send basic colours look like they do in TinyFugue.
- If one colour is hard to read, set **Minimum contrast** in [Settings](help:settings), choose another theme, or import a theme of your own. See [Themes](help:using#themes).
- If bold text looks too bright or too dull, try the **Bold text uses bright colours** setting.

## Accents and symbols look garbled

The game is probably sending Latin-1. Set the world's **Encoding** to Latin-1; see [Connecting and worlds](help:connecting#text-encoding).

## Lost squatter connection

If a world routed through a squatter stops responding or the tab shows the squatter link as down:

1. Check that `squatterd` is still running on the server and that the port is open. Try `./squatterd status` on the server.
2. If you reach the server through an ssh tunnel, restart the tunnel. See [Squatters and routing](help:squatter/routing#when-the-port-is-firewalled).
3. If SquatClient refuses the connection because the fingerprint has changed, **do not trust it** until you know why. Compare the new fingerprint with the one printed by `./squatterd pair`. A legitimate change normally happens only if the server's data folder was reset; then pair again.
4. Your game sessions are not lost while the squatter is running; once the link is back, everything you missed is replayed.
5. A session that shows **ended** lost its game connection (not the squatter). Use **Connect again**.

## Password lines

- Lines such as `connect name password`, `create name password` and `@password ...` are recognised automatically. They are shown masked, for example `connect name ********`, and are never saved in history or in a squatter's record.
- When a game asks for a password and turns echo off, the input line becomes a masked field with a lock icon. History is switched off while you type.
- For anything else that must stay private, type `/secret text`. The text is sent to the game but never shown, saved or logged.
- A password you typed on the input line **before** these protections existed may still be in old history. Open the history browser (Ctrl-R) and delete the entry, or choose **Clear history**.

## History

- Up and Down step through what you sent earlier. If you typed some text first, only lines starting with it are offered.
- Ctrl-R opens the history browser with search. See [Using the client](help:using#history-browser).
- History is kept per world, so a world you never connected from this computer starts empty.
- The **Command history size** setting limits how many entries are kept. Older entries are dropped first.
- A line you sent while the game had echo off, and password lines, are deliberately never saved.

## Ctrl-B and Ctrl-F do not scroll

On the input line these are Emacs editing keys, as in TinyFugue: Ctrl-B moves the cursor back one character and Ctrl-F forward one. To scroll the output use PageUp and PageDown. To search the output use Cmd-F (Ctrl-Shift-F elsewhere). All keys are in [Keyboard shortcuts](help:keys).

## The output stopped moving

You scrolled up, so SquatClient paused the output to let you read. The status bar shows **--More--** and a count of lines that arrived meanwhile. Press End or use the jump button to go back to live output. You can turn this off with **Pause output when scrolled up** in [Settings](help:settings).

## Still stuck

Search this help (press `/` inside it), or report the problem in the repository linked in [About and credits](help:about#source-code).

## Sending a report

If a problem will not go away and you are asking someone for help, open **Help > Diagnostics**, choose **Copy** or **Save as file...** and send them the report. See [Diagnostics](help:diagnostics).
