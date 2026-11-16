# Linux desktop integration

SquatClient uses the freedesktop standards, so one code path serves GNOME, KDE Plasma, XFCE, Cinnamon, MATE and tiling-WM setups.
The D-Bus code is `internal/desktop` (plain Go, tested against a fake bus); the GTK window hint is `attention_linux.go`.

| Feature | Mechanism | Needs |
|---|---|---|
| Notifications (click opens the world) | `org.freedesktop.Notifications` Notify + `ActionInvoked`; a world's newer notification replaces its older one; text is escaped when the daemon renders markup; falls back to `notify-send` | any notification daemon (GNOME Shell, Plasma, xfce4-notifyd, dunst, mako, ...) |
| Unread count on the launcher icon | `com.canonical.Unity.LauncherEntry.Update` signal for `application://squatclient.desktop` | a launcher that listens: Plasma task manager, Ubuntu dock, Dash to Dock, Plank. Stock GNOME ignores it |
| Taskbar flash | GTK urgency hint on the window | panel support (KDE, XFCE, i3bar/waybar highlight); GNOME shows its "is ready" notice; GTK3 on Wayland may do nothing |
| Wake and network change | clock-jump and interface-change detection (all platforms) | nothing |

Everything needs the installed `squatclient.desktop` (`build/linux/squatclient.desktop`, installed by `install.sh`): the notification and
the badge are tied to its id, `squatclient`. In a Flatpak, allow `--talk-name=org.freedesktop.Notifications` and
`--talk-name=com.canonical.Unity.LauncherEntry` (the badge is a signal, so it needs `--own-name=com.canonical.Unity.LauncherEntry.*` or the
launcher may not see it); in a Snap use the `desktop` and `unity7` interfaces. With no session bus (headless, plain ssh) all of it is off.

Not tested on a real Linux desktop yet: the GTK urgency call and the whole D-Bus path need a tester on GNOME and KDE.
