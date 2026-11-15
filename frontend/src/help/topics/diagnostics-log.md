---
title: Sending a diagnostics log
order: 16
keywords: diagnostics log, send log, bug report, github issue, zip, logging, privacy, redacted, secrets, turn off logging, clear logs, view log, alpha
aliases: send diagnostics log, diagnostics log, log file, report a bug, bug report log
---

SquatClient keeps a **diagnostics log** of what it does: connections, what the game's console protocol sent, sounds and why one did not play, packs, settings you changed, errors. If something goes wrong, the log lets a maintainer see what happened instead of guessing. It stays on your computer. **The app never uploads it.**

Open **Help > Send Diagnostics Log...** (also reachable from **Help > Diagnostics**).

## What the dialog shows

- Whether logging is **on or off**, and the size of the log of this session and of the previous session. Only those two are kept, within about 100 MB together; older logs are deleted when SquatClient starts.
- How many secrets were removed from the log as it was written.
- **View log**: the end of this session's log, with a search box.
- **Turn diagnostics off / on**: stops or resumes recording. Your choice is remembered.
- **Snapshot now**: writes the state of every connection (tabs, ship, console, sound, mute) to the log.
- **Clear logs...**: deletes every log, after you confirm.
- **Send...**: the walkthrough below.

In an alpha build logging is on from the first start; you can turn it off here. A build can also be made opt-in (off until you turn it on) or without any logging.

## Privacy

Before a line is written, passwords, pairing codes, keys, tokens, `connect name password` and `create name password` commands, authorization headers and login blocks are replaced by `[redacted]`. They are removed again when the zip is built.

**Text that games sent you can still appear in the log**: room descriptions, chat, mail, what other players said. Read the zip before you share it.

## Send...: four steps

1. **What's included.** The sessions and their sizes, how many secrets were removed, a warning that game text can appear, an optional note, and **Current session only** if you do not want the previous session in the zip.
2. **Save the file.** SquatClient builds `squatclient-diagnostics-<build>-<date>.zip` on your computer, in your Downloads folder or where you choose with **Save as...**, and shows the full path and size. **Show in folder** opens it in Finder or Explorer. No network is used up to this step.
3. **Tell us what happened.** **Open GitHub issue form** opens the project's issue form in your browser with the title, build, system, a short summary of recent errors and your note filled in. The log is not part of the address. Then: describe the problem, drag the zip you saved into the box for the diagnostics log, press Submit new issue.
4. **Done** (optional). Delete the saved zip, or open the issue list.

**A GitHub issue on this project is public**, and so is a file attached to it. If the log may hold anything private, submit the issue without the file and say so, or contact the person named in the dialog at the game shown there (a MUD you can reach with SquatClient itself: the **Connect to...** button opens Quick connect with the address filled in, it does not connect for you) to arrange another private way to deliver it. The issue form also has a checkbox for this.

See also [Diagnostics](help:diagnostics) and [Troubleshooting](help:troubleshooting).
