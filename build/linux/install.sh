#!/bin/sh
# Installs SquatClient for the current user (no root): the program, its icon and a menu entry.
set -e
here=$(cd "$(dirname "$0")" && pwd)
bin="$HOME/.local/bin"
icons="$HOME/.local/share/icons/hicolor/1024x1024/apps"
apps="$HOME/.local/share/applications"
mkdir -p "$bin" "$icons" "$apps"
install -m 755 "$here/squatclient" "$bin/squatclient"
install -m 644 "$here/squatclient.png" "$icons/squatclient.png"
sed "s|^Exec=.*|Exec=$bin/squatclient|" "$here/squatclient.desktop" > "$apps/squatclient.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$apps" || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" || true
echo "Installed. Start SquatClient from your application menu, or run: $bin/squatclient"
echo "It needs GTK 3 and WebKitGTK (libwebkit2gtk-4.0) installed on the system."
echo "To remove it: rm $bin/squatclient $icons/squatclient.png $apps/squatclient.desktop"
